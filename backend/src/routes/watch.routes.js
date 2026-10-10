const express = require('express');
const router = express.Router();

// Watch queries this to get caretaker location and settings
router.get('/status', (req, res) => {
  res.json({
    safe_mode: false,
    radius_m: 250,
    latest_phone_location: {
      latitude: 28.6024,
      longitude: -81.2001,
      timestamp: new Date().toISOString()
    }
  });
});

module.exports = router;
