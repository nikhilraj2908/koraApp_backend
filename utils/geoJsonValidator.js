/**
 * utils/geoJsonValidator.js
 *
 * GeoJSON boundary validation and spatial query helpers for Service Areas.
 * Strictly enforces WGS84 coordinates, ring closure, ring length >= 4,
 * and accepts ONLY Polygon or MultiPolygon boundaries (or Feature/FeatureCollection
 * wrapping them). Rejects LineString, Point, etc. without auto-closing or mutating.
 */

const booleanPointInPolygon = require('@turf/boolean-point-in-polygon').default || require('@turf/boolean-point-in-polygon');
const { point } = require('@turf/helpers');

/**
 * Validates a single position [lng, lat] against WGS84 bounds.
 */
function validatePosition(pos, pathStr = 'position') {
  if (!Array.isArray(pos) || pos.length < 2) {
    return {
      valid: false,
      error: `Invalid position at ${pathStr}: expected [longitude, latitude] array with at least 2 numbers.`,
    };
  }

  const [lng, lat] = pos;
  if (typeof lng !== 'number' || !Number.isFinite(lng) || typeof lat !== 'number' || !Number.isFinite(lat)) {
    return {
      valid: false,
      error: `Non-finite coordinate found at ${pathStr}: [${lng}, ${lat}]. Both longitude and latitude must be valid numbers.`,
    };
  }

  if (lng < -180 || lng > 180) {
    return {
      valid: false,
      error: `Longitude ${lng} at ${pathStr} is out of WGS84 range [-180, 180]. Coordinates must be in [longitude, latitude] order.`,
    };
  }

  if (lat < -90 || lat > 90) {
    return {
      valid: false,
      error: `Latitude ${lat} at ${pathStr} is out of WGS84 range [-90, 90]. Coordinates must be in [longitude, latitude] order.`,
    };
  }

  return { valid: true };
}

/**
 * Validates a single linear ring for a Polygon:
 * - Must be an array of positions
 * - Must have at least 4 positions (minimum 3 distinct vertices + closing vertex)
 * - Must be closed (first position strictly equals last position)
 * - Must NOT be silently auto-closed
 */
function validateLinearRing(ring, ringIndex = 0) {
  if (!Array.isArray(ring)) {
    return {
      valid: false,
      error: `Linear ring #${ringIndex} must be an array of coordinate positions.`,
    };
  }

  if (ring.length < 4) {
    return {
      valid: false,
      error: `Linear ring #${ringIndex} must contain at least 4 coordinate positions (got ${ring.length}). Polygons require at least 3 distinct vertices plus a closing vertex.`,
    };
  }

  const first = ring[0];
  const last = ring[ring.length - 1];

  if (!Array.isArray(first) || !Array.isArray(last) || first.length < 2 || last.length < 2) {
    return {
      valid: false,
      error: `Linear ring #${ringIndex} has malformed endpoint positions.`,
    };
  }

  // Check closure without auto-closing
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return {
      valid: false,
      error: `Linear ring #${ringIndex} is not closed: first position [${first[0]}, ${first[1]}] does not match last position [${last[0]}, ${last[1]}]. Boundaries must not be silently auto-closed.`,
    };
  }

  // Validate all coordinates in the ring
  for (let i = 0; i < ring.length; i++) {
    const posValidation = validatePosition(ring[i], `ring #${ringIndex}, position #${i}`);
    if (!posValidation.valid) {
      return posValidation;
    }
  }

  return { valid: true };
}

/**
 * Validates Polygon coordinates: array of linear rings.
 */
function validatePolygonCoordinates(coordinates, polyLabel = 'Polygon') {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return {
      valid: false,
      error: `${polyLabel} coordinates must be a non-empty array of linear rings.`,
    };
  }

  for (let r = 0; r < coordinates.length; r++) {
    const ringResult = validateLinearRing(coordinates[r], r);
    if (!ringResult.valid) {
      return ringResult;
    }
  }

  return { valid: true };
}

/**
 * Validates MultiPolygon coordinates: array of polygon coordinates.
 */
function validateMultiPolygonCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return {
      valid: false,
      error: `MultiPolygon coordinates must be a non-empty array of polygon coordinates.`,
    };
  }

  for (let p = 0; p < coordinates.length; p++) {
    const polyResult = validatePolygonCoordinates(coordinates[p], `MultiPolygon polygon #${p}`);
    if (!polyResult.valid) {
      return polyResult;
    }
  }

  return { valid: true };
}

/**
 * Validates and extracts a Polygon or MultiPolygon geometry from GeoJSON input.
 * Accepts:
 *  - Raw JSON string or Buffer
 *  - GeoJSON Geometry ({ type: 'Polygon' | 'MultiPolygon', coordinates: [...] })
 *  - GeoJSON Feature ({ type: 'Feature', geometry: ... })
 *  - GeoJSON FeatureCollection ({ type: 'FeatureCollection', features: [...] })
 *
 * Rejects LineString, Point, MultiPoint, GeometryCollection and invalid/unclosed rings.
 * Returns { valid: true, geometry, boundaryType } or { valid: false, error, statusCode: 400 | 422 }.
 */
function validateGeoJSON(input) {
  if (!input) {
    return {
      valid: false,
      statusCode: 400,
      error: 'GeoJSON payload is required.',
    };
  }

  let parsed = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try {
      parsed = JSON.parse(input.toString('utf-8'));
    } catch (err) {
      return {
        valid: false,
        statusCode: 400,
        error: `Malformed JSON: ${err.message}`,
      };
    }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      valid: false,
      statusCode: 400,
      error: 'Invalid GeoJSON: input must be a JSON object.',
    };
  }

  // 1. Extract the raw geometry
  let geometry = null;

  if (parsed.type === 'FeatureCollection') {
    if (!Array.isArray(parsed.features) || parsed.features.length === 0) {
      return {
        valid: false,
        statusCode: 422,
        error: 'FeatureCollection must contain at least one feature.',
      };
    }

    const geometries = parsed.features.map((f) => f && f.geometry).filter(Boolean);
    if (geometries.length === 0) {
      return {
        valid: false,
        statusCode: 422,
        error: 'FeatureCollection contains no valid feature geometries.',
      };
    }

    if (geometries.length === 1) {
      geometry = geometries[0];
    } else {
      // Multiple features: check if all are Polygon or MultiPolygon
      const invalidTypes = geometries.filter((g) => g.type !== 'Polygon' && g.type !== 'MultiPolygon');
      if (invalidTypes.length > 0) {
        return {
          valid: false,
          statusCode: 422,
          error: `Unsupported geometry type "${invalidTypes[0].type}" in FeatureCollection. Only Polygon and MultiPolygon boundaries are accepted.`,
        };
      }

      // Merge into a single MultiPolygon
      const mergedCoordinates = [];
      for (const g of geometries) {
        if (g.type === 'Polygon') {
          mergedCoordinates.push(g.coordinates);
        } else if (g.type === 'MultiPolygon') {
          mergedCoordinates.push(...g.coordinates);
        }
      }

      geometry = {
        type: 'MultiPolygon',
        coordinates: mergedCoordinates,
      };
    }
  } else if (parsed.type === 'Feature') {
    if (!parsed.geometry) {
      return {
        valid: false,
        statusCode: 422,
        error: 'Feature object is missing a "geometry" property.',
      };
    }
    geometry = parsed.geometry;
  } else if (parsed.type) {
    // Direct geometry object
    geometry = parsed;
  } else {
    return {
      valid: false,
      statusCode: 422,
      error: 'Missing GeoJSON "type" field.',
    };
  }

  // 2. Reject unsupported geometry types explicitly
  const unsupportedTypes = ['LineString', 'MultiLineString', 'Point', 'MultiPoint', 'GeometryCollection'];
  if (unsupportedTypes.includes(geometry.type)) {
    return {
      valid: false,
      statusCode: 422,
      error: `Unsupported geometry type "${geometry.type}". Only Polygon and MultiPolygon boundaries are accepted. LineString and other types cannot be converted into a service area.`,
    };
  }

  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
    return {
      valid: false,
      statusCode: 422,
      error: `Invalid geometry type "${geometry.type}". Expected Polygon or MultiPolygon.`,
    };
  }

  // 3. Deep coordinate & linear ring validation
  if (geometry.type === 'Polygon') {
    const polyCheck = validatePolygonCoordinates(geometry.coordinates);
    if (!polyCheck.valid) {
      return {
        valid: false,
        statusCode: 422,
        error: polyCheck.error,
      };
    }
  } else if (geometry.type === 'MultiPolygon') {
    const multiCheck = validateMultiPolygonCoordinates(geometry.coordinates);
    if (!multiCheck.valid) {
      return {
        valid: false,
        statusCode: 422,
        error: multiCheck.error,
      };
    }
  }

  return {
    valid: true,
    geometry: {
      type: geometry.type,
      coordinates: geometry.coordinates,
    },
    boundaryType: geometry.type,
  };
}

/**
 * Checks whether a given [longitude, latitude] point is within the provided GeoJSON boundary geometry.
 *
 * @param {[number, number]} pointCoords - [longitude, latitude]
 * @param {object} boundaryGeometry - GeoJSON Polygon or MultiPolygon geometry
 * @returns {boolean}
 */
function isPointInServiceArea(pointCoords, boundaryGeometry) {
  if (!pointCoords || !Array.isArray(pointCoords) || pointCoords.length < 2) {
    return false;
  }
  if (!boundaryGeometry || !boundaryGeometry.type || !boundaryGeometry.coordinates) {
    return false;
  }

  const [lng, lat] = pointCoords;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return false;
  }

  try {
    const pt = point([lng, lat]);
    return booleanPointInPolygon(pt, boundaryGeometry);
  } catch (err) {
    console.error('[GeoJSONValidator] Error checking point in polygon:', err);
    return false;
  }
}

module.exports = {
  validateGeoJSON,
  isPointInServiceArea,
  validatePosition,
  validateLinearRing,
};
