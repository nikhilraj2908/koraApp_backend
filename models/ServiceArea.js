const mongoose = require('mongoose');

const GeometrySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Polygon', 'MultiPolygon'],
      required: true,
    },
    coordinates: {
      type: Array,
      required: true,
    },
  },
  { _id: false }
);

const ServiceAreaSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    boundary: {
      type: GeometrySchema,
      required: true,
    },
    boundaryType: {
      type: String,
      enum: ['Polygon', 'MultiPolygon'],
      required: true,
    },
    originalFileName: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'inactive',
    },
    // Staged boundary for preview/replacement verification before committing
    stagedBoundary: {
      type: GeometrySchema,
      default: null,
    },
    stagedFileName: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual id for API responses
ServiceAreaSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// Geospatial index on boundary for spatial queries
ServiceAreaSchema.index({ boundary: '2dsphere' });

// Partial unique index enforcing AT MOST ONE active service area across the platform.
// Concurrent attempts to activate two areas will trigger a MongoDB duplicate key error.
ServiceAreaSchema.index(
  { status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

module.exports = mongoose.model('ServiceArea', ServiceAreaSchema);
