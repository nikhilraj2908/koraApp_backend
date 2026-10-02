/**
 * services/serviceAreaService.js
 *
 * Core service logic for managing Service Areas, spatial coverage checks,
 * multiple simultaneous active service areas, boundary staging/preview,
 * overlap conflict detection, and database-driven administrative counts.
 */

const mongoose = require('mongoose');
const ServiceArea = require('../models/ServiceArea');
const Customer = require('../models/Customer');
const Rider = require('../models/Rider');
const Washer = require('../models/Washer');
const Order = require('../models/Order');
const { validateGeoJSON, isPointInServiceArea } = require('../utils/geoJsonValidator');

// Configurable activity windows for customer counting (in days and minutes)
const CUSTOMER_AREA_ACTIVITY_DAYS = Number(process.env.CUSTOMER_AREA_ACTIVITY_DAYS) || 30;
const CUSTOMER_LIVE_LOCATION_MINUTES = Number(process.env.CUSTOMER_LIVE_LOCATION_MINUTES) || 10;

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
 * Helper to extract sample coordinate vertices from a GeoJSON geometry.
 */
function extractVertices(geometry) {
  const vertices = [];
  if (!geometry || !geometry.coordinates) return vertices;

  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) {
      if (Array.isArray(ring)) {
        for (const coord of ring) {
          if (Array.isArray(coord) && coord.length >= 2) {
            vertices.push(coord);
          }
        }
      }
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) {
      if (Array.isArray(poly)) {
        for (const ring of poly) {
          if (Array.isArray(ring)) {
            for (const coord of ring) {
              if (Array.isArray(coord) && coord.length >= 2) {
                vertices.push(coord);
              }
            }
          }
        }
      }
    }
  }
  return vertices;
}

/**
 * Checks whether a given geometry overlaps with any OTHER active service area.
 * Uses vertex cross-checks and MongoDB $geoIntersects.
 */
async function checkBoundaryOverlap(targetGeometry, excludeId = null) {
  if (!targetGeometry) return;

  const query = { status: 'active' };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  // Find all other active service areas
  let otherActiveAreas = [];
  try {
    const rawResult = await ServiceArea.find(query);
    otherActiveAreas = Array.isArray(rawResult) ? rawResult : (await rawResult.exec?.() || []);
  } catch (err) {
    otherActiveAreas = [];
  }

  if (!otherActiveAreas || otherActiveAreas.length === 0) {
    return;
  }

  // Check actual polygon overlap via vertex containment
  const targetVertices = extractVertices(targetGeometry);
  for (const otherArea of otherActiveAreas) {
    if (!otherArea.boundary) continue;

    // Check if any target vertex is inside otherArea
    for (const pt of targetVertices) {
      if (isPointInServiceArea(pt, otherArea.boundary)) {
        const error = new Error(
          `This service area overlaps another active service area (${otherArea.name}).`
        );
        error.statusCode = 409;
        error.code = 'SERVICE_AREA_OVERLAP';
        error.conflictingArea = {
          id: otherArea._id,
          name: otherArea.name,
        };
        throw error;
      }
    }

    // Check if any otherArea vertex is inside targetGeometry
    const otherVertices = extractVertices(otherArea.boundary);
    for (const pt of otherVertices) {
      if (isPointInServiceArea(pt, targetGeometry)) {
        const error = new Error(
          `This service area overlaps another active service area (${otherArea.name}).`
        );
        error.statusCode = 409;
        error.code = 'SERVICE_AREA_OVERLAP';
        error.conflictingArea = {
          id: otherArea._id,
          name: otherArea.name,
        };
        throw error;
      }
    }
  }

  // MongoDB $geoIntersects check
  try {
    const intersectingArea = await ServiceArea.findOne({
      ...query,
      boundary: {
        $geoIntersects: {
          $geometry: targetGeometry,
        },
      },
    });

    if (intersectingArea && intersectingArea.boundary) {
      const iVertices = extractVertices(intersectingArea.boundary);
      const isOverlap =
        targetVertices.some((pt) => isPointInServiceArea(pt, intersectingArea.boundary)) ||
        iVertices.some((pt) => isPointInServiceArea(pt, targetGeometry));

      if (isOverlap) {
        const error = new Error(
          `This service area overlaps another active service area (${intersectingArea.name}).`
        );
        error.statusCode = 409;
        error.code = 'SERVICE_AREA_OVERLAP';
        error.conflictingArea = {
          id: intersectingArea._id,
          name: intersectingArea.name,
        };
        throw error;
      }
    }
  } catch (dbErr) {
    if (dbErr.code === 'SERVICE_AREA_OVERLAP') {
      throw dbErr;
    }
  }
}

/**
 * Finds which active service area(s) contain a coordinate point [longitude, latitude].
 * Returns single match, 0 match, or detects multiple overlapping matches safely.
 */
async function findServiceAreaForPoint(longitude, latitude) {
  const lng = Number(longitude);
  const lat = Number(latitude);

  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    const error = new Error('Valid latitude (-90 to 90) and longitude (-180 to 180) are required.');
    error.statusCode = 400;
    throw error;
  }

  let candidates = [];
  try {
    candidates = await ServiceArea.find({
      status: 'active',
      boundary: {
        $geoIntersects: {
          $geometry: {
            type: 'Point',
            coordinates: [lng, lat],
          },
        },
      },
    });
  } catch (err) {
    // Fallback if geospatial index is unavailable in test environment
    candidates = await ServiceArea.find({ status: 'active' });
  }

  // Strictly verify point-in-polygon with Turf
  const matchedAreas = candidates.filter((area) =>
    isPointInServiceArea([lng, lat], area.boundary)
  );

  if (matchedAreas.length === 0) {
    return {
      matched: false,
      count: 0,
      serviceArea: null,
    };
  }

  if (matchedAreas.length === 1) {
    return {
      matched: true,
      count: 1,
      serviceArea: matchedAreas[0],
    };
  }

  // Ambiguous: multiple active service areas matched the point
  return {
    matched: false,
    count: matchedAreas.length,
    conflict: true,
    code: 'MULTIPLE_SERVICE_AREAS_MATCH',
    message: 'This location falls inside multiple active service areas.',
    serviceAreas: matchedAreas,
  };
}

/**
 * Computes database counts for a given service area.
 */
async function computeServiceAreaCounts(areaId) {
  const now = Date.now();
  const recentActivityDate = new Date(now - CUSTOMER_AREA_ACTIVITY_DAYS * 24 * 60 * 60 * 1000);
  const liveLocationDate = new Date(now - CUSTOMER_LIVE_LOCATION_MINUTES * 60 * 1000);

  const [
    customers,
    customersCurrentlySharingLocation,
    riders,
    ridersOnline,
    washers,
    activeWashers,
    orders,
    activeOrders,
  ] = await Promise.all([
    // Active recent customers in this service area
    Customer.countDocuments({
      $or: [
        {
          lastKnownServiceAreaId: areaId,
          lastLocationVerifiedAt: { $gte: recentActivityDate },
        },
        {
          serviceAreaId: areaId,
        },
      ],
    }),

    // Currently sharing location (within CUSTOMER_LIVE_LOCATION_MINUTES)
    Customer.countDocuments({
      lastKnownServiceAreaId: areaId,
      lastLocationVerifiedAt: { $gte: liveLocationDate },
    }),

    // Total riders belonging to this service area
    Rider.countDocuments({ serviceAreaId: areaId }),

    // Riders in this service area who are currently online
    Rider.countDocuments({ serviceAreaId: areaId, isOnline: true }),

    // Total washers in this service area
    Washer.countDocuments({ serviceAreaId: areaId }),

    // Active washers available in this service area
    Washer.countDocuments({ serviceAreaId: areaId, isAvailable: true }),

    // Total orders ever placed in this service area
    Order.countDocuments({ serviceAreaId: areaId }),

    // Ongoing / active orders in this service area
    Order.countDocuments({
      serviceAreaId: areaId,
      status: { $nin: ['completed', 'delivered', 'cancelled'] },
    }),
  ]);

  return {
    customers,
    customersCurrentlySharingLocation,
    riders,
    ridersOnline,
    washers,
    activeWashers,
    orders,
    activeOrders,
  };
}

/**
 * Lists all service areas with database-backed customer, rider, washer, and order counts.
 */
async function listServiceAreasWithCounts() {
  const areas = await ServiceArea.find().sort({ createdAt: -1 });

  const areasWithCounts = await Promise.all(
    areas.map(async (area) => {
      const counts = await computeServiceAreaCounts(area._id);

      return {
        id: area._id.toString(),
        _id: area._id,
        name: area.name,
        serviceAreaName: area.name,
        status: area.status,
        boundaryType: area.boundaryType,
        sourceFileName: area.originalFileName,
        originalFileName: area.originalFileName,
        createdAt: area.createdAt,
        updatedAt: area.updatedAt,
        counts,
        customerCount: counts.customers,
        riderCount: counts.riders,
        washerCount: counts.washers,
        orderCount: counts.orders,
        customersCount: counts.customers,
        ridersCount: counts.riders,
        washersCount: counts.washers,
        ordersCount: counts.orders,
        serviceArea: {
          id: area._id.toString(),
          name: area.name,
        },
      };
    })
  );

  return areasWithCounts;
}

/**
 * Retrieves a single service area by ID including full boundary geometry, counts,
 * and admin-only washer shop locations.
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

  const counts = await computeServiceAreaCounts(area._id);

  // Admin-only: list washers operating within this service area with shop locations
  const washers = await Washer.find({ serviceAreaId: area._id })
    .select('_id name phone verificationStatus isAvailable shopLocation serviceAreaId');

  const formattedWashers = washers.map((w) => ({
    id: w._id.toString(),
    _id: w._id,
    name: w.name,
    status: w.verificationStatus || (w.isAvailable ? 'active' : 'inactive'),
    isAvailable: w.isAvailable,
    shopLocation: w.shopLocation || null,
    serviceAreaId: w.serviceAreaId,
  }));

  return {
    id: area._id.toString(),
    _id: area._id,
    name: area.name,
    serviceAreaName: area.name,
    status: area.status,
    sourceFileName: area.originalFileName,
    originalFileName: area.originalFileName,
    boundaryType: area.boundaryType,
    boundary: area.boundary,
    stagedBoundary: area.stagedBoundary,
    stagedFileName: area.stagedFileName,
    createdAt: area.createdAt,
    updatedAt: area.updatedAt,
    counts,
    washers: formattedWashers,
    customerCount: counts.customers,
    riderCount: counts.riders,
    washerCount: counts.washers,
    orderCount: counts.orders,
    customersCount: counts.customers,
    ridersCount: counts.riders,
    washersCount: counts.washers,
    ordersCount: counts.orders,
    serviceArea: {
      id: area._id.toString(),
      name: area.name,
    },
  };
}

/**
 * Activates a service area.
 * Multiple service areas can be active simultaneously.
 * Validates that the activating area does NOT overlap any currently active service area.
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

  // Check for boundary overlap against other already-active service areas
  await checkBoundaryOverlap(targetArea.boundary, targetArea._id);

  targetArea.status = 'active';
  await targetArea.save();

  return targetArea;
}

/**
 * Deactivates a single service area.
 * Preserves historical bookings and does NOT affect other active service areas.
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
 * Checks for overlap before committing if the service area is active.
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

  // If this area is currently active, ensure the new boundary doesn't overlap other active areas
  if (area.status === 'active') {
    await checkBoundaryOverlap(finalGeometry, area._id);
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
 * Returns all currently active service areas in public-safe representation.
 */
async function getActiveServiceAreas() {
  const query = ServiceArea.find({ status: 'active' });
  const activeAreas = typeof query?.sort === 'function' ? await query.sort({ name: 1 }) : await query;
  const list = Array.isArray(activeAreas) ? activeAreas : [];

  return list.map((area) => ({
    id: area._id ? area._id.toString() : (area.id || ''),
    _id: area._id || area.id,
    name: area.name,
    serviceAreaName: area.name,
    boundaryType: area.boundaryType,
  }));
}

/**
 * Checks whether a given latitude/longitude location falls inside any active service area.
 * Handles single match, multiple matches (conflict), or out-of-area points.
 */
async function checkLocationCoverage(latitude, longitude) {
  const matchResult = await findServiceAreaForPoint(longitude, latitude);

  if (matchResult.conflict) {
    return {
      success: false,
      code: 'MULTIPLE_SERVICE_AREAS_MATCH',
      message: 'This location falls inside multiple active service areas.',
      available: false,
      serviceArea: null,
      serviceAreas: matchResult.serviceAreas.map((a) => ({
        id: a._id.toString(),
        name: a.name,
      })),
    };
  }

  if (matchResult.matched && matchResult.serviceArea) {
    return {
      success: true,
      available: true,
      message: 'Location is within an active service area.',
      serviceArea: {
        id: matchResult.serviceArea._id.toString(),
        _id: matchResult.serviceArea._id,
        name: matchResult.serviceArea.name,
      },
    };
  }

  return {
    success: true,
    available: false,
    message: 'Pickup location is outside all active KORA service areas.',
    serviceArea: null,
  };
}

module.exports = {
  createServiceArea,
  listServiceAreasWithCounts,
  getServiceAreaByIdWithCounts,
  activateServiceArea,
  deactivateServiceArea,
  stageOrUpdateBoundary,
  getActiveServiceAreas,
  getActiveServiceArea: getActiveServiceAreas, // Backward compatibility
  findServiceAreaForPoint,
  checkBoundaryOverlap,
  checkLocationCoverage,
};
