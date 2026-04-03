const express = require('express');
const router = express.Router();

router.get('/profile', (req, res) => {
  res.json({ message: 'Service Provider profile endpoint' });
});

module.exports = router;