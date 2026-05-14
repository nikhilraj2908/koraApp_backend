const dns = require('dns');
// Force Node.js to use Google's reliable public DNS servers
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const riderRoutes = require('./routes/riderRoutes');
const spRoutes = require('./routes/serviceProviderRoutes');
const orderRoutes = require('./routes/orderRoutes');
const locationRoutes = require('./routes/locationRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const { startCronJobs } = require('./utils/cronJobs');
const mongoose = require('mongoose'); // at top
const { apiLimiter } = require('./middleware/rateLimiter'); 

 
connectDB();
startCronJobs();

const app = express();
app.use(cors());
app.use(helmet());
app.use(express.json());
app.set('trust proxy', 1);  // ← ADD THIS (real IP behind nginx/cloud proxy)
app.use(apiLimiter);   
app.get('/db-status', async (req, res) => {
  const state = mongoose.connection.readyState;
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  const status = ['disconnected', 'connected', 'connecting', 'disconnecting'][state];
  res.json({ mongooseState: status });
});
app.get('/ping', (req, res) => res.send('pong'));
app.post('/echo', (req, res) => res.json(req.body));
app.use('/uploads', express.static('uploads'));

app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/riders', riderRoutes);
app.use('/api/sp', spRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/services', serviceRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));