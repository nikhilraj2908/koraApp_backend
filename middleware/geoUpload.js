/**
 * middleware/geoUpload.js
 *
 * Multer middleware specifically configured for GeoJSON / JSON boundary file uploads.
 * Uses memoryStorage to keep file buffers in memory for immediate validation.
 */

const multer = require('multer');
const path = require('path');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.geojson', '.json'];

  if (allowedExtensions.includes(ext) || file.mimetype.includes('json')) {
    cb(null, true);
  } else {
    const error = new Error('Invalid file type. Only .geojson and .json files are accepted.');
    error.statusCode = 400;
    cb(error, false);
  }
};

const geoUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for rich polygon boundary definitions
  fileFilter,
});

module.exports = geoUpload;
