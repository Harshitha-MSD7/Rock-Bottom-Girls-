const express = require('express');
const cors = require('cors');

const deviceRoutes = require('./routes/device.routes');
const watchRoutes = require('./routes/watch.routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Mount the routers
app.use('/api/device', deviceRoutes);
app.use('/api/watch', watchRoutes);

// Root route
app.get('/', (req, res) => {
  res.send('Wearable Emergency Audio System API is running');
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});