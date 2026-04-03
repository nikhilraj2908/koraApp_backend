const express = require('express');
const { enrollRider, getProfile, updateProfile, uploadDocuments } = require('../controllers/riderController');
const { protect, restrictTo } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

router.post('/enroll', upload.fields([
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'drivingLicense', maxCount: 1 },
  { name: 'rc', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 }
]), enrollRider);

router.get('/profile', protect, restrictTo('rider'), getProfile);
router.put('/profile', protect, restrictTo('rider'), updateProfile);

module.exports = router;