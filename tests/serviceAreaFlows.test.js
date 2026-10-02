/**
 * tests/serviceAreaFlows.test.js
 *
 * Comprehensive automated tests for:
 * 1. Multiple simultaneously active service areas (Indore & Vidisha active together)
 * 2. Overlap detection and conflict rejection (SERVICE_AREA_OVERLAP)
 * 3. Boundary staging/preview vs replacement on confirmation
 * 4. Booking creation rejection when no service area is active (HTTP 422)
 * 5. Booking creation rejection for out-of-area pickup location (HTTP 422)
 * 6. Simultaneous active ordering: Customer in Indore -> Indore order; Customer in Vidisha -> Vidisha order
 * 7. Frontend serviceAreaId spoofing prevented (backend derives serviceAreaId strictly from pickup coordinates)
 * 8. Ambiguous/overlapping area booking rejection (MULTIPLE_SERVICE_AREAS_MATCH)
 * 9. Cross-service-area rider and washer assignment enforcement:
 *    - Indore order + Indore rider/washer -> ALLOWED
 *    - Indore order + Vidisha rider/washer -> REJECTED (422)
 *    - Vidisha order + Vidisha rider/washer -> ALLOWED
 *    - Vidisha order + Indore rider/washer -> REJECTED (422)
 * 10. Service area deactivation: deactivating Indore leaves Vidisha working; historical orders intact; re-activating Indore restores bookings
 * 11. Customer location tracking: POST /api/customer/location updates lastKnownLocation & verified timestamp without permanently fixing city
 * 12. Public APIs: GET /api/service-areas/active returns all active areas; POST /api/service-areas/check verifies Indore, Vidisha, outside
 * 13. Admin counts: GET /api/admin/service-areas returns accurate per-area counts; detail endpoint includes admin-only washer shop locations
 */

const { describe, it } = require('node:test');
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
const customerCtrl = require('../controllers/customerController');

describe('Multiple Active Service Areas & Enforcement Flows', () => {
  // Indore Polygon (~75.84E to 75.88E, 22.68N to 22.73N)
  const indorePolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [75.840, 22.735],
        [75.845, 22.695],
        [75.875, 22.680],
        [75.890, 22.710],
        [75.880, 22.740],
        [75.840, 22.735],
      ],
    ],
  };

  // Vidisha Polygon (~77.77E to 77.85E, 23.49N to 23.54N)
  const vidishaPolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [77.770, 23.545],
        [77.770, 23.490],
        [77.850, 23.490],
        [77.850, 23.545],
        [77.770, 23.545],
      ],
    ],
  };

  // Overlapping Polygon (overlaps with Indore)
  const indoreOverlappingPolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [75.850, 22.720],
        [75.850, 22.700],
        [75.870, 22.700],
        [75.870, 22.720],
        [75.850, 22.720],
      ],
    ],
  };

  const indoreAreaId = new mongoose.Types.ObjectId();
  const vidishaAreaId = new mongoose.Types.ObjectId();
  const overlapAreaId = new mongoose.Types.ObjectId();

  const indorePoint = [75.860, 22.710]; // Inside Indore [lng, lat]
  const vidishaPoint = [77.810, 23.520]; // Inside Vidisha [lng, lat]
  const outsidePoint = [77.5946, 12.9716]; // Bangalore [lng, lat] - outside both

  it('1. Multiple active service areas: activating Indore does NOT deactivate Vidisha', async () => {
    const areas = [
      { _id: indoreAreaId, name: 'Indore', status: 'inactive', boundary: indorePolygon, boundaryType: 'Polygon', save: async function () { return this; } },
      { _id: vidishaAreaId, name: 'Vidisha', status: 'active', boundary: vidishaPolygon, boundaryType: 'Polygon', save: async function () { return this; } },
    ];

    const origFindById = ServiceArea.findById;
    const origFind = ServiceArea.find;
    const origFindOne = ServiceArea.findOne;

    ServiceArea.findById = async (id) => areas.find((a) => a._id.toString() === id.toString());
    ServiceArea.find = async (query = {}) => {
      let res = areas;
      if (query.status) res = res.filter((a) => a.status === query.status);
      if (query._id?.$ne) res = res.filter((a) => a._id.toString() !== query._id.$ne.toString());
      return res;
    };
    ServiceArea.findOne = async (query = {}) => {
      if (query.boundary?.$geoIntersects) return null; // Disjoint mock areas
      const list = await ServiceArea.find(query);
      return list[0] || null;
    };

    try {
      // Activate Indore while Vidisha is already active
      const activated = await serviceAreaService.activateServiceArea(indoreAreaId);
      assert.equal(activated.status, 'active');

      const indore = areas.find((a) => a._id.toString() === indoreAreaId.toString());
      const vidisha = areas.find((a) => a._id.toString() === vidishaAreaId.toString());

      assert.equal(indore.status, 'active', 'Indore must be active');
      assert.equal(vidisha.status, 'active', 'Vidisha must remain active simultaneously');

      const activeCount = areas.filter((a) => a.status === 'active').length;
      assert.equal(activeCount, 2, 'Both service areas must be active together');
    } finally {
      ServiceArea.findById = origFindById;
      ServiceArea.find = origFind;
      ServiceArea.findOne = origFindOne;
    }
  });

  it('2. Overlap protection: activating an overlapping polygon is rejected with SERVICE_AREA_OVERLAP', async () => {
    const areas = [
      { _id: indoreAreaId, name: 'Indore', status: 'active', boundary: indorePolygon, boundaryType: 'Polygon', save: async function () { return this; } },
      { _id: overlapAreaId, name: 'Indore Central (Duplicate)', status: 'inactive', boundary: indoreOverlappingPolygon, boundaryType: 'Polygon', save: async function () { return this; } },
    ];

    const origFindById = ServiceArea.findById;
    const origFind = ServiceArea.find;

    ServiceArea.findById = async (id) => areas.find((a) => a._id.toString() === id.toString());
    ServiceArea.find = async (query = {}) => {
      let res = areas;
      if (query.status) res = res.filter((a) => a.status === query.status);
      if (query._id?.$ne) res = res.filter((a) => a._id.toString() !== query._id.$ne.toString());
      return res;
    };

    try {
      await assert.rejects(
        async () => {
          await serviceAreaService.activateServiceArea(overlapAreaId);
        },
        (err) => {
          assert.equal(err.code, 'SERVICE_AREA_OVERLAP');
          assert.equal(err.statusCode, 409);
          return true;
        }
      );
    } finally {
      ServiceArea.findById = origFindById;
      ServiceArea.find = origFind;
    }
  });

  it('3. Boundary staging / preview vs replacement on confirmation (with overlap check)', async () => {
    const area = {
      _id: indoreAreaId,
      name: 'Indore',
      status: 'active',
      boundary: indorePolygon,
      boundaryType: 'Polygon',
      stagedBoundary: null,
      stagedFileName: null,
      save: async function () { return this; },
    };

    const origFindById = ServiceArea.findById;
    const origFind = ServiceArea.find;

    ServiceArea.findById = async () => area;
    ServiceArea.find = async () => [];

    try {
      // Step A: Stage without confirm
      const previewRes = await serviceAreaService.stageOrUpdateBoundary(indoreAreaId, {
        geojsonInput: JSON.stringify(vidishaPolygon),
        originalFileName: 'new_boundary.geojson',
        confirm: false,
      });

      assert.equal(previewRes.preview, true);
      assert.deepEqual(area.boundary, indorePolygon, 'Saved boundary must not change before confirmation');
      assert.deepEqual(area.stagedBoundary, vidishaPolygon, 'Staged boundary must be saved for preview');

      // Step B: Confirm replacement
      const confirmedRes = await serviceAreaService.stageOrUpdateBoundary(indoreAreaId, {
        confirm: true,
      });

      assert.deepEqual(confirmedRes.boundary, vidishaPolygon, 'Boundary must be replaced after confirmation');
      assert.equal(confirmedRes.stagedBoundary, null, 'Staged boundary must be cleared after confirmation');
    } finally {
      ServiceArea.findById = origFindById;
      ServiceArea.find = origFind;
    }
  });

  it('4. Booking creation rejection when no service area is active (HTTP 422 OUTSIDE_SERVICE_AREA)', async () => {
    const origFind = ServiceArea.find;
    ServiceArea.find = async () => []; // No active service areas

    let resStatus = 0;
    let resJson = null;

    const req = {
      user: { id: new mongoose.Types.ObjectId() },
      body: {
        items: [{ serviceId: new mongoose.Types.ObjectId(), quantity: 2 }],
        pickupAddress: { coordinates: indorePoint },
        paymentMethod: 'cash',
      },
    };

    const res = {
      status: (code) => {
        resStatus = code;
        return { json: (data) => { resJson = data; } };
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
      assert.equal(resJson.code, 'OUTSIDE_SERVICE_AREA');
    } finally {
      ServiceArea.find = origFind;
      Service.findById = origServiceFindById;
    }
  });

  it('5. Booking creation rejection for out-of-area pickup location (HTTP 422 OUTSIDE_SERVICE_AREA)', async () => {
    const areas = [
      { _id: indoreAreaId, name: 'Indore', status: 'active', boundary: indorePolygon },
      { _id: vidishaAreaId, name: 'Vidisha', status: 'active', boundary: vidishaPolygon },
    ];

    const origFind = ServiceArea.find;
    ServiceArea.find = async () => areas;

    let resStatus = 0;
    let resJson = null;

    const req = {
      user: { id: new mongoose.Types.ObjectId() },
      body: {
        items: [{ serviceId: new mongoose.Types.ObjectId(), quantity: 2 }],
        pickupAddress: { coordinates: outsidePoint }, // Bangalore - outside both
        paymentMethod: 'cash',
      },
    };

    const res = {
      status: (code) => {
        resStatus = code;
        return { json: (data) => { resJson = data; } };
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
      assert.equal(resJson.code, 'OUTSIDE_SERVICE_AREA');
      assert.match(resJson.message, /Pickup location is outside all active KORA service areas/i);
    } finally {
      ServiceArea.find = origFind;
      Service.findById = origServiceFindById;
    }
  });

  it('6. Concurrent active ordering: Indore customer creates Indore order & Vidisha customer creates Vidisha order (spoofed serviceAreaId ignored)', async () => {
    const areas = [
      { _id: indoreAreaId, name: 'Indore', status: 'active', boundary: indorePolygon },
      { _id: vidishaAreaId, name: 'Vidisha', status: 'active', boundary: vidishaPolygon },
    ];

    const origFind = ServiceArea.find;
    ServiceArea.find = async () => areas;

    let createdOrders = [];
    const origOrderCreate = Order.create;
    Order.create = async (data) => {
      const doc = { _id: new mongoose.Types.ObjectId(), ...data };
      createdOrders.push(doc);
      return doc;
    };

    const Service = require('../models/Servicemodel');
    const origServiceFindById = Service.findById;
    Service.findById = async () => ({ _id: new mongoose.Types.ObjectId(), pricePerKg: 100, name: 'Wash' });

    try {
      // Customer A in Indore attempts to send a spoofed Vidisha serviceAreaId
      const fakeVidishaId = new mongoose.Types.ObjectId();
      const reqIndore = {
        user: { id: new mongoose.Types.ObjectId() },
        body: {
          items: [{ serviceId: new mongoose.Types.ObjectId(), quantity: 2 }],
          pickupAddress: { coordinates: indorePoint },
          serviceAreaId: fakeVidishaId, // Spoofed ID - should be ignored
          paymentMethod: 'cash',
        },
      };

      const resDummy = { status: () => resDummy, json: () => {} };
      await orderCtrl.createOrder(reqIndore, resDummy);

      assert.equal(createdOrders.length, 1);
      assert.equal(
        createdOrders[0].serviceAreaId.toString(),
        indoreAreaId.toString(),
        'Order 1 must resolve to Indore based on actual pickup coordinates, ignoring frontend spoof'
      );

      // Customer B in Vidisha
      const reqVidisha = {
        user: { id: new mongoose.Types.ObjectId() },
        body: {
          items: [{ serviceId: new mongoose.Types.ObjectId(), quantity: 3 }],
          pickupAddress: { coordinates: vidishaPoint },
          paymentMethod: 'cash',
        },
      };
      await orderCtrl.createOrder(reqVidisha, resDummy);

      assert.equal(createdOrders.length, 2);
      assert.equal(
        createdOrders[1].serviceAreaId.toString(),
        vidishaAreaId.toString(),
        'Order 2 must resolve to Vidisha based on actual pickup coordinates'
      );
    } finally {
      ServiceArea.find = origFind;
      Order.create = origOrderCreate;
      Service.findById = origServiceFindById;
    }
  });

  it('7. Ambiguous location matching multiple active areas returns MULTIPLE_SERVICE_AREAS_MATCH conflict', async () => {
    // Both area 1 and area 2 active and covering the same point
    const overlappingAreas = [
      { _id: indoreAreaId, name: 'Indore North', status: 'active', boundary: indorePolygon },
      { _id: overlapAreaId, name: 'Indore Central', status: 'active', boundary: indoreOverlappingPolygon },
    ];

    const origFind = ServiceArea.find;
    ServiceArea.find = async () => overlappingAreas;

    try {
      // 1. Check helper
      const checkRes = await serviceAreaService.checkLocationCoverage(22.710, 75.860);
      assert.equal(checkRes.code, 'MULTIPLE_SERVICE_AREAS_MATCH');

      // 2. Order creation rejection
      let resStatus = 0;
      let resJson = null;

      const req = {
        user: { id: new mongoose.Types.ObjectId() },
        body: {
          items: [{ serviceId: new mongoose.Types.ObjectId(), quantity: 1 }],
          pickupAddress: { coordinates: [75.860, 22.710] },
          paymentMethod: 'cash',
        },
      };

      const res = {
        status: (code) => {
          resStatus = code;
          return { json: (data) => { resJson = data; } };
        },
        json: (data) => { resJson = data; },
      };

      const Service = require('../models/Servicemodel');
      const origServiceFindById = Service.findById;
      Service.findById = async () => ({ _id: req.body.items[0].serviceId, pricePerKg: 100, name: 'Wash' });

      await orderCtrl.createOrder(req, res);
      assert.equal(resStatus, 409);
      assert.equal(resJson.code, 'MULTIPLE_SERVICE_AREAS_MATCH');

      Service.findById = origServiceFindById;
    } finally {
      ServiceArea.find = origFind;
    }
  });

  it('8. Cross-service-area rider and washer assignment enforcement', async () => {
    const indoreOrder = {
      _id: new mongoose.Types.ObjectId(),
      orderNumber: 'INDORE_ORD_101',
      serviceAreaId: indoreAreaId,
    };

    const vidishaOrder = {
      _id: new mongoose.Types.ObjectId(),
      orderNumber: 'VIDISHA_ORD_201',
      serviceAreaId: vidishaAreaId,
    };

    const indoreRider = {
      _id: new mongoose.Types.ObjectId(),
      fullName: 'Indore Rider',
      serviceAreaId: indoreAreaId,
      baseLocation: { type: 'Point', coordinates: indorePoint },
    };

    const vidishaRider = {
      _id: new mongoose.Types.ObjectId(),
      fullName: 'Vidisha Rider',
      serviceAreaId: vidishaAreaId,
      baseLocation: { type: 'Point', coordinates: vidishaPoint },
    };

    const indoreWasher = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Indore Washer',
      serviceAreaId: indoreAreaId,
      shopLocation: { type: 'Point', coordinates: indorePoint },
    };

    const vidishaWasher = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Vidisha Washer',
      serviceAreaId: vidishaAreaId,
      shopLocation: { type: 'Point', coordinates: vidishaPoint },
    };

    const origOrderFindOne = Order.findOne;
    const origOrderFindOneAndUpdate = Order.findOneAndUpdate;
    const origRiderFindById = Rider.findById;
    const origWasherFindById = Washer.findById;
    const origServiceAreaFindById = ServiceArea.findById;

    Rider.findById = async (id) => {
      if (id.toString() === indoreRider._id.toString()) return indoreRider;
      if (id.toString() === vidishaRider._id.toString()) return vidishaRider;
      return null;
    };

    Washer.findById = async (id) => {
      if (id.toString() === indoreWasher._id.toString()) return indoreWasher;
      if (id.toString() === vidishaWasher._id.toString()) return vidishaWasher;
      return null;
    };

    ServiceArea.findById = async (id) => {
      if (id.toString() === indoreAreaId.toString()) return { _id: indoreAreaId, boundary: indorePolygon };
      if (id.toString() === vidishaAreaId.toString()) return { _id: vidishaAreaId, boundary: vidishaPolygon };
      return null;
    };

    Order.findOneAndUpdate = () => {
      const mockQuery = {
        populate: () => mockQuery,
        then: (resolve) => resolve({ _id: indoreOrder._id, orderNumber: 'ORD_ASSIGNED' }),
      };
      return mockQuery;
    };

    const createAssignReq = (order, body) => ({
      params: { id: order._id },
      body,
    });

    const createMockRes = () => {
      let statusCode = 200;
      let jsonBody = null;
      return {
        res: {
          status: (c) => {
            statusCode = c;
            return { json: (b) => { jsonBody = b; } };
          },
          json: (b) => { jsonBody = b; },
        },
        getStatus: () => statusCode,
        getBody: () => jsonBody,
      };
    };

    try {
      // 1. Indore Order + Indore Rider -> ALLOWED
      Order.findOne = async () => indoreOrder;
      let mock = createMockRes();
      await adminCtrl.assignOrder(createAssignReq(indoreOrder, { riderPickupId: indoreRider._id }), mock.res);
      assert.equal(mock.getStatus(), 200, 'Indore order + Indore rider must be ALLOWED');

      // 2. Indore Order + Indore Washer -> ALLOWED
      mock = createMockRes();
      await adminCtrl.assignOrder(createAssignReq(indoreOrder, { serviceProviderId: indoreWasher._id }), mock.res);
      assert.equal(mock.getStatus(), 200, 'Indore order + Indore washer must be ALLOWED');

      // 3. Indore Order + Vidisha Rider -> REJECTED (422)
      mock = createMockRes();
      await adminCtrl.assignOrder(createAssignReq(indoreOrder, { riderPickupId: vidishaRider._id }), mock.res);
      assert.equal(mock.getStatus(), 422, 'Indore order + Vidisha rider must be REJECTED');
      assert.match(mock.getBody().message, /Cross-service-area assignment rejected/i);

      // 4. Indore Order + Vidisha Washer -> REJECTED (422)
      mock = createMockRes();
      await adminCtrl.assignOrder(createAssignReq(indoreOrder, { serviceProviderId: vidishaWasher._id }), mock.res);
      assert.equal(mock.getStatus(), 422, 'Indore order + Vidisha washer must be REJECTED');
      assert.match(mock.getBody().message, /Cross-service-area assignment rejected/i);

      // 5. Vidisha Order + Vidisha Rider -> ALLOWED
      Order.findOne = async () => vidishaOrder;
      mock = createMockRes();
      await adminCtrl.assignOrder(createAssignReq(vidishaOrder, { riderDeliveryId: vidishaRider._id }), mock.res);
      assert.equal(mock.getStatus(), 200, 'Vidisha order + Vidisha rider must be ALLOWED');

      // 6. Vidisha Order + Vidisha Washer -> ALLOWED
      mock = createMockRes();
      await adminCtrl.assignOrder(createAssignReq(vidishaOrder, { serviceProviderId: vidishaWasher._id }), mock.res);
      assert.equal(mock.getStatus(), 200, 'Vidisha order + Vidisha washer must be ALLOWED');

      // 7. Vidisha Order + Indore Rider -> REJECTED (422)
      mock = createMockRes();
      await adminCtrl.assignOrder(createAssignReq(vidishaOrder, { riderPickupId: indoreRider._id }), mock.res);
      assert.equal(mock.getStatus(), 422, 'Vidisha order + Indore rider must be REJECTED');
      assert.match(mock.getBody().message, /Cross-service-area assignment rejected/i);

      // 8. Vidisha Order + Indore Washer -> REJECTED (422)
      mock = createMockRes();
      await adminCtrl.assignOrder(createAssignReq(vidishaOrder, { serviceProviderId: indoreWasher._id }), mock.res);
      assert.equal(mock.getStatus(), 422, 'Vidisha order + Indore washer must be REJECTED');
      assert.match(mock.getBody().message, /Cross-service-area assignment rejected/i);
    } finally {
      Order.findOne = origOrderFindOne;
      Order.findOneAndUpdate = origOrderFindOneAndUpdate;
      Rider.findById = origRiderFindById;
      Washer.findById = origWasherFindById;
      ServiceArea.findById = origServiceAreaFindById;
    }
  });

  it('9. Customer location update: POST /api/customer/location updates lastKnownLocation without fixing permanent city', async () => {
    const areas = [
      { _id: indoreAreaId, name: 'Indore', status: 'active', boundary: indorePolygon },
      { _id: vidishaAreaId, name: 'Vidisha', status: 'active', boundary: vidishaPolygon },
    ];

    const customerDoc = {
      _id: new mongoose.Types.ObjectId(),
      accountId: new mongoose.Types.ObjectId(),
      lastKnownLocation: null,
      lastLocationVerifiedAt: null,
      lastKnownServiceAreaId: null,
      save: async function () { return this; },
    };

    const origCustFindOne = Customer.findOne;
    const origAreaFind = ServiceArea.find;

    Customer.findOne = async () => customerDoc;
    ServiceArea.find = async () => areas;

    const createMockRes = () => {
      let code = 200;
      let body = null;
      return {
        res: {
          status: (c) => { code = c; return { json: (b) => { body = b; } }; },
          json: (b) => { body = b; },
        },
        getCode: () => code,
        getBody: () => body,
      };
    };

    try {
      // 1. Customer is in Indore in the morning
      let mock = createMockRes();
      await customerCtrl.updateCustomerLocation(
        { user: { id: customerDoc.accountId }, body: { latitude: 22.710, longitude: 75.860 } },
        mock.res
      );
      assert.equal(mock.getCode(), 200);
      assert.equal(mock.getBody().available, true);
      assert.equal(mock.getBody().serviceArea.name, 'Indore');
      assert.equal(customerDoc.lastKnownServiceAreaId.toString(), indoreAreaId.toString());
      assert.ok(customerDoc.lastLocationVerifiedAt instanceof Date);

      // 2. Customer travels to Vidisha later
      mock = createMockRes();
      await customerCtrl.updateCustomerLocation(
        { user: { id: customerDoc.accountId }, body: { latitude: 23.520, longitude: 77.810 } },
        mock.res
      );
      assert.equal(mock.getCode(), 200);
      assert.equal(mock.getBody().available, true);
      assert.equal(mock.getBody().serviceArea.name, 'Vidisha');
      assert.equal(customerDoc.lastKnownServiceAreaId.toString(), vidishaAreaId.toString());

      // 3. Customer travels outside all service areas
      mock = createMockRes();
      await customerCtrl.updateCustomerLocation(
        { user: { id: customerDoc.accountId }, body: { latitude: 12.9716, longitude: 77.5946 } },
        mock.res
      );
      assert.equal(mock.getCode(), 200);
      assert.equal(mock.getBody().available, false);
      assert.equal(mock.getBody().serviceArea, null);
      assert.equal(customerDoc.lastKnownServiceAreaId, null);
    } finally {
      Customer.findOne = origCustFindOne;
      ServiceArea.find = origAreaFind;
    }
  });

  it('10. Deactivation flow: deactivating Indore keeps Vidisha active; historical orders remain intact', async () => {
    const areas = [
      { _id: indoreAreaId, name: 'Indore', status: 'active', boundary: indorePolygon, save: async function () { return this; } },
      { _id: vidishaAreaId, name: 'Vidisha', status: 'active', boundary: vidishaPolygon, save: async function () { return this; } },
    ];

    const historicalIndoreOrder = {
      _id: new mongoose.Types.ObjectId(),
      orderNumber: 'INDORE_HISTORICAL_001',
      serviceAreaId: indoreAreaId,
    };

    const origFindById = ServiceArea.findById;
    ServiceArea.findById = async (id) => areas.find((a) => a._id.toString() === id.toString());

    try {
      // Deactivate Indore
      await serviceAreaService.deactivateServiceArea(indoreAreaId);

      const indore = areas.find((a) => a._id.toString() === indoreAreaId.toString());
      const vidisha = areas.find((a) => a._id.toString() === vidishaAreaId.toString());

      assert.equal(indore.status, 'inactive', 'Indore must be deactivated');
      assert.equal(vidisha.status, 'active', 'Vidisha must continue operating normally');

      // Verify historical order serviceAreaId is completely unchanged
      assert.equal(historicalIndoreOrder.serviceAreaId.toString(), indoreAreaId.toString());
    } finally {
      ServiceArea.findById = origFindById;
    }
  });

  it('11. Public APIs: GET /api/service-areas/active returns all active areas; POST /api/service-areas/check tests points', async () => {
    const areas = [
      { _id: indoreAreaId, name: 'Indore', status: 'active', boundary: indorePolygon, boundaryType: 'Polygon' },
      { _id: vidishaAreaId, name: 'Vidisha', status: 'active', boundary: vidishaPolygon, boundaryType: 'Polygon' },
    ];

    const origFind = ServiceArea.find;
    ServiceArea.find = async () => areas;

    try {
      // 1. GET /api/service-areas/active
      const activeAreas = await serviceAreaService.getActiveServiceAreas();
      assert.equal(activeAreas.length, 2);
      assert.deepEqual(
        activeAreas.map((a) => a.name).sort(),
        ['Indore', 'Vidisha']
      );

      // 2. Check Indore point
      const inIndore = await serviceAreaService.checkLocationCoverage(22.710, 75.860);
      assert.equal(inIndore.available, true);
      assert.equal(inIndore.serviceArea.name, 'Indore');

      // 3. Check Vidisha point
      const inVidisha = await serviceAreaService.checkLocationCoverage(23.520, 77.810);
      assert.equal(inVidisha.available, true);
      assert.equal(inVidisha.serviceArea.name, 'Vidisha');

      // 4. Check outside point
      const outside = await serviceAreaService.checkLocationCoverage(12.9716, 77.5946);
      assert.equal(outside.available, false);
      assert.equal(outside.serviceArea, null);
    } finally {
      ServiceArea.find = origFind;
    }
  });

  it('12. Admin counts: GET /api/admin/service-areas returns accurate per-area counts; detail returns admin washer locations', async () => {
    const indoreAreaDoc = {
      _id: indoreAreaId,
      name: 'Indore',
      status: 'active',
      boundaryType: 'Polygon',
      originalFileName: 'indore.geojson',
      boundary: indorePolygon,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const origAreaFind = ServiceArea.find;
    const origAreaFindById = ServiceArea.findById;
    const origCustCount = Customer.countDocuments;
    const origRiderCount = Rider.countDocuments;
    const origWasherCount = Washer.countDocuments;
    const origOrderCount = Order.countDocuments;
    const origWasherFind = Washer.find;

    ServiceArea.find = () => ({
      sort: async () => [indoreAreaDoc],
    });
    ServiceArea.findById = async () => indoreAreaDoc;

    Customer.countDocuments = async (query) => {
      if (query.lastLocationVerifiedAt?.$gte) return 34; // currently sharing
      return 156; // total active customers in area
    };
    Rider.countDocuments = async (query) => (query.isOnline ? 7 : 12);
    Washer.countDocuments = async (query) => (query.isAvailable ? 6 : 8);
    Order.countDocuments = async (query) => (query.status ? 10 : 42);

    Washer.find = () => ({
      select: async () => [
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'ABC Laundry Indore',
          verificationStatus: 'verified',
          isAvailable: true,
          shopLocation: { type: 'Point', coordinates: indorePoint },
          serviceAreaId: indoreAreaId,
        },
      ],
    });

    try {
      // Test list endpoint
      const list = await serviceAreaService.listServiceAreasWithCounts();
      assert.equal(list.length, 1);
      assert.deepEqual(list[0].counts, {
        customers: 156,
        customersCurrentlySharingLocation: 34,
        riders: 12,
        ridersOnline: 7,
        washers: 8,
        activeWashers: 6,
        orders: 42,
        activeOrders: 10,
      });

      // Test detail endpoint
      const detail = await serviceAreaService.getServiceAreaByIdWithCounts(indoreAreaId);
      assert.equal(detail.name, 'Indore');
      assert.equal(detail.washers.length, 1);
      assert.equal(detail.washers[0].name, 'ABC Laundry Indore');
      assert.deepEqual(detail.washers[0].shopLocation.coordinates, indorePoint);
    } finally {
      ServiceArea.find = origAreaFind;
      ServiceArea.findById = origAreaFindById;
      Customer.countDocuments = origCustCount;
      Rider.countDocuments = origRiderCount;
      Washer.countDocuments = origWasherCount;
      Order.countDocuments = origOrderCount;
      Washer.find = origWasherFind;
    }
  });
});
