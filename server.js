const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();

const express = require('express');
const { createServer } = require('http');
const { initSocket, getIO } = require('./socket/trackingSocket');
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
const savedAddressRoutes = require('./routes/savedAddresses');
const reviewRoutes = require('./routes/reviewRoutes');
const trackOrderRoutes = require('./routes/trackOrderRoutes');
const washerRoutes = require('./routes/washerRoutes');
const complaintRoutes = require('./routes/complaintRoutes');
const complaintCategoryRoutes = require('./routes/complaintCategoryRoutes');
const walletRoutes = require('./routes/walletRoutes');
const mongoose = require('mongoose');
const { apiLimiter } = require('./middleware/rateLimiter');

connectDB();
startCronJobs();

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(helmet());
app.use(express.json());
app.set('trust proxy', 1);
app.use(apiLimiter);

// Initialize Socket.IO
initSocket(httpServer);

// Make io available in every request
app.use((req, res, next) => {
  req.io = getIO();
  next();
});

app.get('/db-status', async (req, res) => {
  const state = mongoose.connection.readyState;
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
app.use('/api/saved-addresses', savedAddressRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/track', trackOrderRoutes);
app.use('/api/washer', washerRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/complaint-categories', complaintCategoryRoutes);
app.use('/api/wallet', walletRoutes);

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});