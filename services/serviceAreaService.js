/**
 * services/serviceAreaService.js
 *
 * Core service logic for managing Service Areas, spatial coverage checks,
 * atomic single-active enforcement, boundary staging/preview, and database counts.
 */

const mongoose = require('mongoose');
const ServiceArea = require('../models/ServiceArea');
const Customer = require('../models/Customer');
const Rider = require('../models/Rider');
const Washer = require('../models/Washer');
const Order = require('../models/Order');
const { validateGeoJSON, isPointInServiceArea } = require('../utils/geoJsonValidator');

/**
 * Creates a new service area in inactive status from a name and GeoJSON input.
 */
async function createServiceArea({ name, geojsonInput, originalFileName = null }) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    const error = new Error('Service area name is required.');
    error.statusCode = 400;
    throw error;
  }

  const validation = validateGeoJSON(geojsonInput);
  if (!validation.valid) {
    const error = new Error(validation.error);
    error.statusCode = validation.statusCode || 422;
    throw error;
  }

  const serviceArea = await ServiceArea.create({
    name: name.trim(),
    boundary: validation.geometry,
    boundaryType: validation.boundaryType,
    originalFileName: originalFileName || null,
    status: 'inactive', // Always inactive upon creation
  });

  return serviceArea;
}

/**
 * Lists all service areas with database-backed customer, rider, washer, and order counts.
 */
async function listServiceAreasWithCounts() {
  const areas = await ServiceArea.find().sort({ createdAt: -1 });

  const areasWithCounts = await Promise.all(
    areas.map(async (area) => {
      const [customers, riders, washers, orders] = await Promise.all([
        Customer.countDocuments({ serviceAreaId: area._id }),
        Rider.countDocuments({ serviceAreaId: area._id }),
        Washer.countDocuments({ serviceAreaId: area._id }),
        Order.countDocuments({ serviceAreaId: area._id }),
      ]);

      return {
        id: area._id,
        _id: area._id,
        name: area.name,
        serviceAreaName: area.name,
        status: area.status,
        originalFileName: area.originalFileName,
        boundaryType: area.boundaryType,
        createdAt: area.createdAt,
        updatedAt: area.updatedAt,
        counts: {
          customers,
          riders,
          washers,
          orders,
        },
        customerCount: customers,
        riderCount: riders,
        washerCount: washers,
        orderCount: orders,
        customersCount: customers,
        ridersCount: riders,
        washersCount: washers,
        ordersCount: orders,
        serviceArea: {
          id: area._id,
          name: area.name,
        },
      };
    })
  );

  return areasWithCounts;
}

/**
 * Retrieves a single service area by ID including full boundary geometry and counts.
 */
async function getServiceAreaByIdWithCounts(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error('Invalid service area ID.');
    error.statusCode = 400;
    throw error;
  }

  const area = await ServiceArea.findById(id);
  if (!area) {
    const error = new Error('Service area not found.');
    error.statusCode = 404;
    throw error;
  }

  const [customers, riders, washers, orders] = await Promise.all([
    Customer.countDocuments({ serviceAreaId: area._id }),
    Rider.countDocuments({ serviceAreaId: area._id }),
    Washer.countDocuments({ serviceAreaId: area._id }),
    Order.countDocuments({ serviceAreaId: area._id }),
  ]);

  return {
    id: area._id,
    _id: area._id,
    name: area.name,
    serviceAreaName: area.name,
    status: area.status,
    originalFileName: area.originalFileName,
    boundaryType: area.boundaryType,
    boundary: area.boundary,
    stagedBoundary: area.stagedBoundary,
    stagedFileName: area.stagedFileName,
    createdAt: area.createdAt,
    updatedAt: area.updatedAt,
    counts: {
      customers,
      riders,
      washers,
      orders,
    },
    customerCount: customers,
    riderCount: riders,
    washerCount: washers,
    orderCount: orders,
    customersCount: customers,
    ridersCount: riders,
    washersCount: washers,
    ordersCount: orders,
    serviceArea: {
      id: area._id,
      name: area.name,
    },
  };
}

/**
 * Atomically activates a service area and deactivates any other active area.
 * Guaranteed to enforce at most one active service area at any time.
 */
async function activateServiceArea(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error('Invalid service area ID.');
    error.statusCode = 400;
    throw error;
  }

  const targetArea = await ServiceArea.findById(id);
  if (!targetArea) {
    const error = new Error('Service area not found.');
    error.statusCode = 404;
    throw error;
  }

  // Attempt transaction if MongoDB deployment supports replica set sessions
  let session = null;
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      session = await mongoose.startSession();
    } catch {
      session = null;
    }
  }

  const isReplicaSet =
    session &&
    session.client?.topology?.description?.type &&
    !session.client.topology.description.type.includes('Single') &&
    !session.client.topology.description.type.includes('Unknown');

  if (session && isReplicaSet) {
    try {
      let activated;
      await session.withTransaction(async () => {
        // Step 1: Deactivate all other active service areas
        await ServiceArea.updateMany(
          { status: 'active', _id: { $ne: targetArea._id } },
          { $set: { status: 'inactive' } },
          { session }
        );

        // Step 2: Activate the requested area
        activated = await ServiceArea.findByIdAndUpdate(
          targetArea._id,
          { $set: { status: 'active' } },
          { new: true, session }
        );
      });
      return activated;
    } finally {
      await session.endSession();
    }
  }

  // Standalone / fallback execution:
  // Step 1: Deactivate any currently active areas
  await ServiceArea.updateMany(
    { status: 'active', _id: { $ne: targetArea._id } },
    { $set: { status: 'inactive' } }
  );

  // Step 2: Activate the target area.
  // The partial unique index on status='active' guarantees database-level integrity.
  const activated = await ServiceArea.findByIdAndUpdate(
    targetArea._id,
    { $set: { status: 'active' } },
    { new: true }
  );

  return activated;
}

/**
 * Deactivates a service area.
 * Preserves historical bookings and orders without modification or deletion.
 */
async function deactivateServiceArea(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error('Invalid service area ID.');
    error.statusCode = 400;
    throw error;
  }

  const area = await ServiceArea.findById(id);
  if (!area) {
    const error = new Error('Service area not found.');
    error.statusCode = 404;
    throw error;
  }

  area.status = 'inactive';
  await area.save();

  return area;
}

/**
 * Validates, stages, or updates the boundary of a service area.
 * If confirm !== true, saves the new boundary into stagedBoundary for preview.
 * If confirm === true, replaces the saved boundary with the validated / staged boundary.
 */
async function stageOrUpdateBoundary(id, { geojsonInput, originalFileName = null, confirm = false }) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error('Invalid service area ID.');
    error.statusCode = 400;
    throw error;
  }

  const area = await ServiceArea.findById(id);
  if (!area) {
    const error = new Error('Service area not found.');
    error.statusCode = 404;
    throw error;
  }

  const isConfirmed = confirm === true || confirm === 'true';

  if (!isConfirmed) {
    // Stage / preview mode
    if (!geojsonInput) {
      const error = new Error('GeoJSON boundary file or payload is required to stage a boundary.');
      error.statusCode = 400;
      throw error;
    }

    const validation = validateGeoJSON(geojsonInput);
    if (!validation.valid) {
      const error = new Error(validation.error);
      error.statusCode = validation.statusCode || 422;
      throw error;
    }

    area.stagedBoundary = validation.geometry;
    area.stagedFileName = originalFileName || null;
    await area.save();

    return {
      success: true,
      preview: true,
      message: 'New boundary validated and staged for preview. Send confirm=true to apply.',
      serviceAreaId: area._id,
      boundaryType: validation.boundaryType,
      stagedBoundary: validation.geometry,
      originalFileName: area.stagedFileName,
    };
  }

  // Confirmed replacement mode
  let finalGeometry = null;
  let finalBoundaryType = null;
  let finalFileName = originalFileName || null;

  if (geojsonInput) {
    const validation = validateGeoJSON(geojsonInput);
    if (!validation.valid) {
      const error = new Error(validation.error);
      error.statusCode = validation.statusCode || 422;
      throw error;
    }
    finalGeometry = validation.geometry;
    finalBoundaryType = validation.boundaryType;
  } else if (area.stagedBoundary) {
    finalGeometry = area.stagedBoundary;
    finalBoundaryType = area.stagedBoundary.type;
    finalFileName = area.stagedFileName || area.originalFileName;
  } else {
    const error = new Error('No new boundary provided or staged to apply. Please upload or stage a boundary first.');
    error.statusCode = 400;
    throw error;
  }

  area.boundary = finalGeometry;
  area.boundaryType = finalBoundaryType;
  if (finalFileName) {
    area.originalFileName = finalFileName;
  }
  area.stagedBoundary = null;
  area.stagedFileName = null;
  await area.save();

  return area;
}

/**
 * Returns the currently active service area's public-safe representation.
 */
async function getActiveServiceArea() {
  const activeArea = await ServiceArea.findOne({ status: 'active' });
  if (!activeArea) {
    return null;
  }

  return {
    id: activeArea._id,
    _id: activeArea._id,
    name: activeArea.name,
    serviceAreaName: activeArea.name,
    boundaryType: activeArea.boundaryType,
  };
}

/**
 * Checks whether a given latitude/longitude location falls inside the active service area.
 */
async function checkLocationCoverage(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    const error = new Error('Valid latitude (-90 to 90) and longitude (-180 to 180) are required.');
    error.statusCode = 400;
    throw error;
  }

  const activeArea = await ServiceArea.findOne({ status: 'active' });
  if (!activeArea) {
    return {
      available: false,
      message: 'No active service area available.',
      serviceArea: null,
    };
  }

  const inside = isPointInServiceArea([lng, lat], activeArea.boundary);

  return {
    available: inside,
    message: inside
      ? 'Location is within the active service area.'
      : 'Location is outside the current KORA service area.',
    serviceArea: {
      id: activeArea._id,
      name: activeArea.name,
    },
  };
}

module.exports = {
  createServiceArea,
  listServiceAreasWithCounts,
  getServiceAreaByIdWithCounts,
  activateServiceArea,
  deactivateServiceArea,
  stageOrUpdateBoundary,
  getActiveServiceArea,
  checkLocationCoverage,
};
