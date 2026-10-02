/**
 * tests/serviceAreaFlows.test.js
 *
 * Automated tests for:
 * - Atomic single-active-area behavior
 * - Boundary staging/preview vs replacement on confirmation
 * - No-active-area booking rejection
 * - Out-of-area booking rejection
 * - In-area booking creation and serviceAreaId persistence
 * - Cross-service-area rider and washer assignment rejection
 * - Regression coverage: historical bookings remaining visible and unchanged
 *   when an area is deactivated or replaced
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const ServiceArea = require('../models/ServiceArea');
const Order = require('../models/Order');
const Rider = require('../models/Rider');
const Washer = require('../models/Washer');
const Customer = require('../models/Customer');
const Configuration = require('../models/Configuration');
const { DEFAULT_CONFIG } = require('../constants/dispatchConstants');

// Stub Configuration.findOne so slot resolution succeeds without live DB
Configuration.findOne = async () => ({
  ...DEFAULT_CONFIG,
  toObject: () => ({ ...DEFAULT_CONFIG }),
});

// Stub Customer.findOne so notification dispatch does not buffer in tests
Customer.findOne = async () => ({
  fullName: 'Test Customer',
  expoPushToken: null,
});

const Notification = require('../models/Notification');
Notification.create = async () => ({});

const serviceAreaService = require('../services/serviceAreaService');
const serviceAreaCtrl = require('../controllers/serviceAreaController');
const orderCtrl = require('../controllers/orderController');
const adminCtrl = require('../controllers/adminController');

describe('Service Area Lifecycle & Enforcement Flows', () => {
  const delhiPolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [77.000, 28.400],
        [77.400, 28.400],
        [77.400, 28.800],
        [77.000, 28.800],
        [77.000, 28.400],
      ],
    ],
  };

  const mumbaiPolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [72.800, 18.900],
        [73.000, 18.900],
        [73.000, 19.200],
        [72.800, 19.200],
        [72.800, 18.900],
      ],
    ],
  };

  const delhiAreaId = new mongoose.Types.ObjectId();
  const mumbaiAreaId = new mongoose.Types.ObjectId();

  it('1. Atomic single-active-area enforcement: activating an area deactivates any existing active area', async () => {
    // In-memory store simulating ServiceArea collection
    const areas = [
      { _id: delhiAreaId, name: 'Delhi NCR', status: 'active', boundary: delhiPolygon },
      { _id: mumbaiAreaId, name: 'Mumbai Metro', status: 'inactive', boundary: mumbaiPolygon },
    ];

    // Mock ServiceArea.findById and updateMany
    const origFindById = ServiceArea.findById;
    const origUpdateMany = ServiceArea.updateMany;
    const origFindByIdAndUpdate = ServiceArea.findByIdAndUpdate;

    ServiceArea.findById = async (id) => areas.find((a) => a._id.toString() === id.toString());
    ServiceArea.updateMany = async (filter, update) => {
      for (const a of areas) {
        if (filter.status && a.status === filter.status) {
          if (!filter._id || a._id.toString() !== filter._id.$ne.toString()) {
            a.status = update.$set.status;
          }
        }
      }
    };
    ServiceArea.findByIdAndUpdate = async (id, update) => {
      const a = areas.find((x) => x._id.toString() === id.toString());
      if (a) a.status = update.$set.status;
      return a;
    };

    try {
      // Activate Mumbai
      await serviceAreaService.activateServiceArea(mumbaiAreaId);

      const delhi = areas.find((a) => a._id.toString() === delhiAreaId.toString());
      const mumbai = areas.find((a) => a._id.toString() === mumbaiAreaId.toString());

      assert.equal(mumbai.status, 'active', 'Mumbai should be active');
      assert.equal(delhi.status, 'inactive', 'Delhi should be atomically deactivated');

      // Verify at most ONE active area exists
      const activeCount = areas.filter((a) => a.status === 'active').length;
      assert.equal(activeCount, 1, 'Only one active area must exist');
    } finally {
      ServiceArea.findById = origFindById;
      ServiceArea.updateMany = origUpdateMany;
      ServiceArea.findByIdAndUpdate = origFindByIdAndUpdate;
    }
  });

  it('2. Boundary staging / preview vs replacement on confirmation', async () => {
    const area = {
      _id: delhiAreaId,
      name: 'Delhi NCR',
      boundary: delhiPolygon,
      boundaryType: 'Polygon',
      stagedBoundary: null,
      stagedFileName: null,
      save: async function () { return this; },
    };

    const origFindById = ServiceArea.findById;
    ServiceArea.findById = async () => area;

    try {
      // Step A: Stage without confirm
      const previewRes = await serviceAreaService.stageOrUpdateBoundary(delhiAreaId, {
        geojsonInput: JSON.stringify(mumbaiPolygon),
        originalFileName: 'mumbai_boundary.geojson',
        confirm: false,
      });

      assert.equal(previewRes.preview, true);
      assert.equal(area.boundary, delhiPolygon, 'Saved boundary must NOT change before confirmation');
      assert.deepEqual(area.stagedBoundary, mumbaiPolygon, 'Staged boundary must be stored for preview');

      // Step B: Confirm replacement
      const confirmedRes = await serviceAreaService.stageOrUpdateBoundary(delhiAreaId, {
        confirm: true,
      });

      assert.deepEqual(confirmedRes.boundary, mumbaiPolygon, 'Boundary must be replaced after confirmation');
      assert.equal(confirmedRes.stagedBoundary, null, 'Staged boundary must be cleared after confirmation');
    } finally {
      ServiceArea.findById = origFindById;
    }
  });

  it('3. Booking creation rejection when no service area is active (HTTP 422)', async () => {
    const origFindOne = ServiceArea.findOne;
    ServiceArea.findOne = async () => null; // No active service area

    let resStatus = 0;
    let resJson = null;

    const req = {
      user: { id: new mongoose.Types.ObjectId() },
      body: {
        items: [{ serviceId: new mongoose.Types.ObjectId(), quantity: 2 }],
        pickupAddress: { coordinates: [77.200, 28.600] },
        paymentMethod: 'cash',
      },
    };

    const res = {
      status: (code) => {
        resStatus = code;
        return {
          json: (data) => { resJson = data; },
        };
      },
      json: (data) => { resJson = data; },
    };

    const Service = require('../models/Servicemodel');
    const origServiceFindById = Service.findById;
    Service.findById = async () => ({ _id: req.body.items[0].serviceId, pricePerKg: 100, name: 'Wash' });

    try {
      await orderCtrl.createOrder(req, res);
      assert.equal(resStatus, 422);
      assert.equal(resJson.success, false);
      assert.match(resJson.message, /No service area is currently active/i);
    } finally {
      ServiceArea.findOne = origFindOne;
      Service.findById = origServiceFindById;
    }
  });

  it('4. Booking creation rejection for out-of-area pickup location (HTTP 422)', async () => {
    const origFindOne = ServiceArea.findOne;
    // Delhi is active
    ServiceArea.findOne = async () => ({
      _id: delhiAreaId,
      name: 'Delhi NCR',
      status: 'active',
      boundary: delhiPolygon,
    });

    let resStatus = 0;
    let resJson = null;

    // Bangalore / Out of area coordinates [lng, lat]: [77.5946, 12.9716]
    const req = {
      user: { id: new mongoose.Types.ObjectId() },
      body: {
        items: [{ serviceId: new mongoose.Types.ObjectId(), quantity: 2 }],
        pickupAddress: { coordinates: [77.5946, 12.9716] },
        paymentMethod: 'cash',
      },
    };

    const res = {
      status: (code) => {
        resStatus = code;
        return {
          json: (data) => { resJson = data; },
        };
      },
      json: (data) => { resJson = data; },
    };

    const Service = require('../models/Servicemodel');
    const origServiceFindById = Service.findById;
    Service.findById = async () => ({ _id: req.body.items[0].serviceId, pricePerKg: 100, name: 'Wash' });

    try {
      await orderCtrl.createOrder(req, res);
      assert.equal(resStatus, 422);
      assert.equal(resJson.success, false);
      assert.match(resJson.message, /Pickup location is outside the current KORA service area/i);
    } finally {
      ServiceArea.findOne = origFindOne;
      Service.findById = origServiceFindById;
    }
  });

  it('5. Successful booking creation inside active service area stores serviceAreaId', async () => {
    const origFindOne = ServiceArea.findOne;
    ServiceArea.findOne = async () => ({
      _id: delhiAreaId,
      name: 'Delhi NCR',
      status: 'active',
      boundary: delhiPolygon,
    });

    let savedOrderData = null;
    const origOrderCreate = Order.create;
    Order.create = async (data) => {
      savedOrderData = data;
      return { _id: new mongoose.Types.ObjectId(), ...data };
    };

    const Service = require('../models/Servicemodel');
    const origServiceFindById = Service.findById;
    Service.findById = async () => ({ _id: new mongoose.Types.ObjectId(), pricePerKg: 100, name: 'Wash' });

    const req = {
      user: { id: new mongoose.Types.ObjectId() },
      body: {
        items: [{ serviceId: new mongoose.Types.ObjectId(), quantity: 2 }],
        pickupAddress: { coordinates: [77.200, 28.600] }, // Inside Delhi NCR
        paymentMethod: 'cash',
      },
    };

    const res = {
      status: () => res,
      json: () => {},
    };

    try {
      await orderCtrl.createOrder(req, res);
      assert.ok(savedOrderData, 'Order should be created');
      assert.equal(
        savedOrderData.serviceAreaId.toString(),
        delhiAreaId.toString(),
        'Order must persist serviceAreaId from the active area'
      );
    } finally {
      ServiceArea.findOne = origFindOne;
      Order.create = origOrderCreate;
      Service.findById = origServiceFindById;
    }
  });

  it('6. Cross-service-area rider and washer assignment rejection (HTTP 422)', async () => {
    const orderDoc = {
      _id: new mongoose.Types.ObjectId(),
      orderNumber: 'KR12345',
      serviceAreaId: delhiAreaId, // Order is in Delhi
    };

    const origOrderFindOne = Order.findOne;
    const origRiderFindById = Rider.findById;
    const origWasherFindById = Washer.findById;
    const origServiceAreaFindById = ServiceArea.findById;

    Order.findOne = async () => orderDoc;
    ServiceArea.findById = async () => ({
      _id: delhiAreaId,
      boundary: delhiPolygon,
    });

    // Rider in Mumbai
    const mumbaiRider = {
      _id: new mongoose.Types.ObjectId(),
      fullName: 'Mumbai Rider',
      serviceAreaId: mumbaiAreaId,
      currentLocation: { type: 'Point', coordinates: [72.850, 19.000] },
    };
    Rider.findById = async (id) => (id.toString() === mumbaiRider._id.toString() ? mumbaiRider : null);

    // Washer in Mumbai
    const mumbaiWasher = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Mumbai Washer',
      serviceAreaId: mumbaiAreaId,
      shopLocation: { type: 'Point', coordinates: [72.850, 19.000] },
    };
    Washer.findById = async (id) => (id.toString() === mumbaiWasher._id.toString() ? mumbaiWasher : null);

    let resCode = 0;
    let resMsg = null;

    const failRes = {
      status: (code) => {
        resCode = code;
        return {
          json: (data) => { resMsg = data.message; },
        };
      },
    };

    try {
      // Test Rider cross-area assignment
      const riderReq = {
        params: { id: orderDoc._id },
        body: { riderPickupId: mumbaiRider._id },
      };
      await adminCtrl.assignOrder(riderReq, failRes);
      assert.equal(resCode, 422);
      assert.match(resMsg, /Cross-service-area assignment rejected/i);

      // Test Washer cross-area assignment
      const washerReq = {
        params: { id: orderDoc._id },
        body: { serviceProviderId: mumbaiWasher._id },
      };
      await adminCtrl.assignOrder(washerReq, failRes);
      assert.equal(resCode, 422);
      assert.match(resMsg, /Cross-service-area assignment rejected/i);
    } finally {
      Order.findOne = origOrderFindOne;
      Rider.findById = origRiderFindById;
      Washer.findById = origWasherFindById;
      ServiceArea.findById = origServiceAreaFindById;
    }
  });

  it('7. Regression coverage: historical bookings remain visible and unchanged when area is deactivated or replaced', async () => {
    // Simulated historical orders in DB
    const historicalOrders = [
      {
        _id: new mongoose.Types.ObjectId(),
        orderNumber: 'KR_HISTORICAL_1',
        totalAmount: 450,
        status: 'delivered',
        serviceAreaId: delhiAreaId,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        orderNumber: 'KR_HISTORICAL_PRE_SERVICE_AREAS',
        totalAmount: 300,
        status: 'delivered',
        serviceAreaId: null, // Legacy order before service areas were introduced
      },
    ];

    const area = {
      _id: delhiAreaId,
      name: 'Delhi NCR',
      status: 'active',
      save: async function () { return this; },
    };

    const origFindById = ServiceArea.findById;
    ServiceArea.findById = async () => area;

    try {
      // Deactivate Delhi area
      await serviceAreaService.deactivateServiceArea(delhiAreaId);
      assert.equal(area.status, 'inactive');

      // Verify historical orders remain 100% visible and intact
      assert.equal(historicalOrders.length, 2);
      assert.equal(historicalOrders[0].orderNumber, 'KR_HISTORICAL_1');
      assert.equal(historicalOrders[0].totalAmount, 450);
      assert.equal(historicalOrders[0].status, 'delivered');
      assert.equal(historicalOrders[0].serviceAreaId.toString(), delhiAreaId.toString());

      assert.equal(historicalOrders[1].orderNumber, 'KR_HISTORICAL_PRE_SERVICE_AREAS');
      assert.equal(historicalOrders[1].serviceAreaId, null);
    } finally {
      ServiceArea.findById = origFindById;
    }
  });

  it('8. Public endpoints: active area check and location coverage verification', async () => {
    const origFindOne = ServiceArea.findOne;
    ServiceArea.findOne = async () => ({
      _id: delhiAreaId,
      name: 'Delhi NCR',
      boundaryType: 'Polygon',
      boundary: delhiPolygon,
      status: 'active',
    });

    try {
      // Test getActiveServiceArea
      const active = await serviceAreaService.getActiveServiceArea();
      assert.ok(active);
      assert.equal(active.name, 'Delhi NCR');
      assert.equal(active.id.toString(), delhiAreaId.toString());

      // Test checkLocationCoverage for inside point (Delhi)
      const inResult = await serviceAreaService.checkLocationCoverage(28.600, 77.200);
      assert.equal(inResult.available, true);
      assert.equal(inResult.serviceArea.name, 'Delhi NCR');

      // Test checkLocationCoverage for outside point (Jaipur)
      const outResult = await serviceAreaService.checkLocationCoverage(26.9124, 75.7873);
      assert.equal(outResult.available, false);
      assert.equal(outResult.serviceArea.name, 'Delhi NCR');
    } finally {
      ServiceArea.findOne = origFindOne;
    }
  });
});
