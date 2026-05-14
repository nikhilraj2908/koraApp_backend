const express = require('express');
const {
  getAllServices,
  getServiceById,
  getServiceBySlug,
  createService,
  updateService,
  toggleServiceStatus,
  deleteService,
  seedServices
} = require('../controllers/serviceController');

const router = express.Router();


router.get('/', getAllServices);
router.get('/slug/:slug', getServiceBySlug);
router.get('/:id', getServiceById);

router.post('/seed', seedServices);
router.post('/', createService);
router.put('/:id', updateService);
router.patch('/:id/toggle', toggleServiceStatus);
router.delete('/:id', deleteService);


module.exports = router;