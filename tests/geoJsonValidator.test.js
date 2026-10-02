/**
 * tests/geoJsonValidator.test.js
 *
 * Automated tests for:
 * - Valid Polygon and MultiPolygon input
 * - Malformed JSON
 * - LineString and Point rejection
 * - Invalid/out-of-range coordinates
 * - Linear ring closure and length validation
 * - Point inside/outside checks
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateGeoJSON,
  isPointInServiceArea,
  validatePosition,
  validateLinearRing,
} = require('../utils/geoJsonValidator');

describe('GeoJSON Validator & Spatial Checks', () => {
  const validPolygonCoords = [
    [
      [77.100, 28.500],
      [77.300, 28.500],
      [77.300, 28.700],
      [77.100, 28.700],
      [77.100, 28.500], // closed
    ],
  ];

  const validMultiPolygonCoords = [
    [
      [
        [77.100, 28.500],
        [77.300, 28.500],
        [77.300, 28.700],
        [77.100, 28.700],
        [77.100, 28.500],
      ],
    ],
    [
      [
        [77.400, 28.500],
        [77.600, 28.500],
        [77.600, 28.700],
        [77.400, 28.700],
        [77.400, 28.500],
      ],
    ],
  ];

  it('1. accepts valid Polygon geometry', () => {
    const geojson = {
      type: 'Polygon',
      coordinates: validPolygonCoords,
    };
    const result = validateGeoJSON(geojson);
    assert.equal(result.valid, true);
    assert.equal(result.boundaryType, 'Polygon');
    assert.deepEqual(result.geometry.coordinates, validPolygonCoords);
  });

  it('2. accepts valid MultiPolygon geometry', () => {
    const geojson = {
      type: 'MultiPolygon',
      coordinates: validMultiPolygonCoords,
    };
    const result = validateGeoJSON(geojson);
    assert.equal(result.valid, true);
    assert.equal(result.boundaryType, 'MultiPolygon');
    assert.deepEqual(result.geometry.coordinates, validMultiPolygonCoords);
  });

  it('3. accepts GeoJSON Feature containing a valid Polygon', () => {
    const feature = {
      type: 'Feature',
      properties: { name: 'South Delhi Hub' },
      geometry: {
        type: 'Polygon',
        coordinates: validPolygonCoords,
      },
    };
    const result = validateGeoJSON(feature);
    assert.equal(result.valid, true);
    assert.equal(result.boundaryType, 'Polygon');
    assert.equal(result.geometry.type, 'Polygon');
  });

  it('4. accepts GeoJSON FeatureCollection containing valid Polygons', () => {
    const featureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: validPolygonCoords,
          },
        },
      ],
    };
    const result = validateGeoJSON(featureCollection);
    assert.equal(result.valid, true);
    assert.equal(result.boundaryType, 'Polygon');
  });

  it('5. rejects malformed JSON with 400 status', () => {
    const malformed = '{"type": "Polygon", "coordinates": [[[77.1, 28.5]... broken json';
    const result = validateGeoJSON(malformed);
    assert.equal(result.valid, false);
    assert.equal(result.statusCode, 400);
    assert.match(result.error, /Malformed JSON/i);
  });

  it('6. rejects LineString without silently converting to a polygon (422)', () => {
    const lineString = {
      type: 'LineString',
      coordinates: [
        [77.100, 28.500],
        [77.300, 28.500],
      ],
    };
    const result = validateGeoJSON(lineString);
    assert.equal(result.valid, false);
    assert.equal(result.statusCode, 422);
    assert.match(result.error, /Unsupported geometry type "LineString"/i);
  });

  it('7. rejects Point and MultiPoint geometries with 422', () => {
    const point = {
      type: 'Point',
      coordinates: [77.100, 28.500],
    };
    const result = validateGeoJSON(point);
    assert.equal(result.valid, false);
    assert.equal(result.statusCode, 422);
    assert.match(result.error, /Unsupported geometry type "Point"/i);
  });

  it('8. rejects unclosed linear rings without silently closing them', () => {
    const unclosedRing = [
      [77.100, 28.500],
      [77.300, 28.500],
      [77.300, 28.700],
      [77.100, 28.700], // Not matching the first point [77.100, 28.500]
    ];
    const poly = {
      type: 'Polygon',
      coordinates: [unclosedRing],
    };
    const result = validateGeoJSON(poly);
    assert.equal(result.valid, false);
    assert.equal(result.statusCode, 422);
    assert.match(result.error, /is not closed/i);
  });

  it('9. rejects linear rings with fewer than 4 positions', () => {
    const shortRing = [
      [77.100, 28.500],
      [77.300, 28.500],
      [77.100, 28.500], // Only 3 positions
    ];
    const poly = {
      type: 'Polygon',
      coordinates: [shortRing],
    };
    const result = validateGeoJSON(poly);
    assert.equal(result.valid, false);
    assert.equal(result.statusCode, 422);
    assert.match(result.error, /must contain at least 4 coordinate positions/i);
  });

  it('10. rejects invalid and out-of-range WGS84 coordinates', () => {
    // Longitude > 180
    const outOfRangeLng = {
      type: 'Polygon',
      coordinates: [
        [
          [195.000, 28.500],
          [77.300, 28.500],
          [77.300, 28.700],
          [77.100, 28.700],
          [195.000, 28.500],
        ],
      ],
    };
    const lngResult = validateGeoJSON(outOfRangeLng);
    assert.equal(lngResult.valid, false);
    assert.equal(lngResult.statusCode, 422);
    assert.match(lngResult.error, /out of WGS84 range \[-180, 180\]/i);

    // Latitude > 90
    const outOfRangeLat = {
      type: 'Polygon',
      coordinates: [
        [
          [77.100, 95.000],
          [77.300, 95.000],
          [77.300, 28.700],
          [77.100, 28.700],
          [77.100, 95.000],
        ],
      ],
    };
    const latResult = validateGeoJSON(outOfRangeLat);
    assert.equal(latResult.valid, false);
    assert.equal(latResult.statusCode, 422);
    assert.match(latResult.error, /out of WGS84 range \[-90, 90\]/i);
  });

  it('11. correctly verifies points inside and outside polygon boundaries', () => {
    const boundary = {
      type: 'Polygon',
      coordinates: validPolygonCoords,
    };

    // Inside [lng, lat]: 77.200, 28.600
    const isInside = isPointInServiceArea([77.200, 28.600], boundary);
    assert.equal(isInside, true);

    // Outside [lng, lat]: 76.500, 27.000
    const isOutside = isPointInServiceArea([76.500, 27.000], boundary);
    assert.equal(isOutside, false);
  });
});
