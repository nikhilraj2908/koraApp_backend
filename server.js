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
const notificationRoutes = require('./routes/notificationRoutes');
const configRoutes = require('./routes/configRoutes');
const dispatchRoutes = require('./routes/dispatchRoutes');
const rideOfferRoutes = require('./routes/rideOfferRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { getConfig } = require('./repositories/configRepository');
const mongoose = require('mongoose');

connectDB();
startCronJobs();

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(helmet());
app.use(express.json());
app.set('trust proxy', 1);

// Initialize Socket.IO
initSocket(httpServer);

// Wire the dispatch/auction system's socket broadcasting — must happen
// after initSocket() so getIO() has an instance to attach to, and before
// any RideOffer can be created (auctionService silently no-ops broadcasts
// otherwise, which would mean offers get created but riders never see
// them — see auctionService.js's attachSocketBroadcaster comment).
const rideOfferSocket = require('./socket/rideOfferSocket');
const { attachSocketBroadcaster } = require('./services/auctionService');
attachSocketBroadcaster(rideOfferSocket);
rideOfferSocket.registerRideOfferSocketHandlers();

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
app.use('/api/notifications', notificationRoutes);
app.use('/api/dispatch/config', configRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/ride-offers', rideOfferRoutes);
app.use('/api/admin', adminRoutes);

// Ensure the dispatch Configuration document exists before any request
// (grouping/pricing/scheduler) needs to read it.
getConfig()
  .then(() => console.log('[Dispatch] Configuration ready.'))
  .catch((err) => console.error('[Dispatch] Failed to seed configuration:', err.message));

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});