/**
 * controllers/serviceAreaController.js
 *
 * Request handlers for Admin Service Area management and Public coverage queries.
 */

const serviceAreaService = require('../services/serviceAreaService');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, message, status = 500) => res.status(status).json({ success: false, message });

// ── Admin Endpoints ──────────────────────────────────────────

/**
 * GET /api/admin/service-areas
 * Lists all service areas, status, boundary type, created date, and customer/rider/washer counts.
 */
exports.listServiceAreas = async (req, res) => {
  try {
    const areas = await serviceAreaService.listServiceAreasWithCounts();
    ok(res, areas);
  } catch (err) {
    fail(res, err.message, err.statusCode || 500);
  }
};

/**
 * POST /api/admin/service-areas
 * Creates an inactive area from name and uploaded GeoJSON file or body payload.
 */
exports.createServiceArea = async (req, res) => {
  try {
    const name = req.body.name;
    let geojsonInput = null;
    let originalFileName = null;

    const uploadedFile = req.file || (req.files && (req.files.file?.[0] || req.files.geojson?.[0]));
    if (uploadedFile) {
      geojsonInput = uploadedFile.buffer;
      originalFileName = uploadedFile.originalname;
    } else if (req.body.geojson) {
      geojsonInput = req.body.geojson;
    } else if (req.body.boundary) {
      geojsonInput = req.body.boundary;
    }

    if (!geojsonInput) {
      return fail(res, 'GeoJSON file or boundary payload is required.', 400);
    }

    const savedArea = await serviceAreaService.createServiceArea({
      name,
      geojsonInput,
      originalFileName,
    });

    ok(res, savedArea, 201);
  } catch (err) {
    fail(res, err.message, err.statusCode || 500);
  }
};

/**
 * GET /api/admin/service-areas/:id
 * Returns complete service area details including geometry and counts.
 */
exports.getServiceAreaById = async (req, res) => {
  try {
    const area = await serviceAreaService.getServiceAreaByIdWithCounts(req.params.id);
    ok(res, area);
  } catch (err) {
    fail(res, err.message, err.statusCode || 500);
  }
};

/**
 * PATCH /api/admin/service-areas/:id/activate
 * Activates this service area without deactivating other active areas.
 * Checks for boundary overlap with other active areas.
 */
exports.activateServiceArea = async (req, res) => {
  try {
    const activated = await serviceAreaService.activateServiceArea(req.params.id);
    ok(res, activated);
  } catch (err) {
    if (err.code === 'SERVICE_AREA_OVERLAP') {
      return res.status(409).json({
        success: false,
        code: 'SERVICE_AREA_OVERLAP',
        message: err.message,
        conflictingArea: err.conflictingArea || null,
      });
    }
    fail(res, err.message, err.statusCode || 500);
  }
};

/**
 * PATCH /api/admin/service-areas/:id/deactivate
 * Deactivates this service area without altering or deleting historical bookings.
 */
exports.deactivateServiceArea = async (req, res) => {
  try {
    const deactivated = await serviceAreaService.deactivateServiceArea(req.params.id);
    ok(res, deactivated);
  } catch (err) {
    fail(res, err.message, err.statusCode || 500);
  }
};

/**
 * PUT/PATCH /api/admin/service-areas/:id/boundary
 * Validates and stages (preview) or confirms and replaces the service area boundary.
 */
exports.updateBoundary = async (req, res) => {
  try {
    const confirm = req.body.confirm || req.query.confirm;
    let geojsonInput = null;
    let originalFileName = null;

    const uploadedFile = req.file || (req.files && (req.files.file?.[0] || req.files.geojson?.[0]));
    if (uploadedFile) {
      geojsonInput = uploadedFile.buffer;
      originalFileName = uploadedFile.originalname;
    } else if (req.body.geojson) {
      geojsonInput = req.body.geojson;
    } else if (req.body.boundary) {
      geojsonInput = req.body.boundary;
    }

    const result = await serviceAreaService.stageOrUpdateBoundary(req.params.id, {
      geojsonInput,
      originalFileName,
      confirm,
    });

    ok(res, result);
  } catch (err) {
    if (err.code === 'SERVICE_AREA_OVERLAP') {
      return res.status(409).json({
        success: false,
        code: 'SERVICE_AREA_OVERLAP',
        message: err.message,
        conflictingArea: err.conflictingArea || null,
      });
    }
    fail(res, err.message, err.statusCode || 500);
  }
};

// ── Public Customer Endpoints ────────────────────────────────

/**
 * GET /api/service-areas/active
 * Returns public-safe list of ALL currently active service areas.
 */
exports.getActiveServiceArea = async (req, res) => {
  try {
    const activeAreas = await serviceAreaService.getActiveServiceAreas();
    const hasActive = Array.isArray(activeAreas) && activeAreas.length > 0;

    return res.json({
      success: true,
      active: hasActive,
      serviceAreas: activeAreas || [],
      // Backward compatibility with single-area consumers
      data: activeAreas,
    });
  } catch (err) {
    fail(res, err.message, err.statusCode || 500);
  }
};

/**
 * POST /api/service-areas/check
 * Checks if a given coordinate point [lng, lat] is covered by ANY active service area.
 */
exports.checkCoverage = async (req, res) => {
  try {
    const latitude = req.body.latitude !== undefined ? req.body.latitude : req.body.lat;
    const longitude = req.body.longitude !== undefined ? req.body.longitude : req.body.lng;

    const result = await serviceAreaService.checkLocationCoverage(latitude, longitude);

    if (result.conflict) {
      return res.status(409).json({
        success: false,
        code: 'MULTIPLE_SERVICE_AREAS_MATCH',
        message: result.message || 'This location falls inside multiple active service areas.',
      });
    }

    return res.json({
      success: true,
      available: result.available,
      serviceArea: result.serviceArea,
    });
  } catch (err) {
    fail(res, err.message, err.statusCode || 500);
  }
};
