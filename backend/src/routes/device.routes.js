const express = require('express');
const router = express.Router();

// Health check for device routes
router.get('/ping', (req, res) => {
  res.json({ message: 'Device router is working!' });
});

// Caregiver phone sends its location
router.post('/location', (req, res) => {
  const { latitude, longitude, accuracy_m } = req.body;
  console.log(`[Device] Received location: lat=${latitude}, lon=${longitude}`);
  
  // Later: save into PostgreSQL
  res.status(201).json({ status: 'location received' });
});

module.exports = router;