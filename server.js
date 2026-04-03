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
const { startCronJobs } = require('./utils/cronJobs');

connectDB();
startCronJobs();

const app = express();
app.use(cors());
app.use(helmet());
app.use(express.json());

app.get('/ping', (req, res) => res.send('pong'));
app.post('/echo', (req, res) => res.json(req.body));
app.use('/uploads', express.static('uploads'));

app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/riders', riderRoutes);
app.use('/api/sp', spRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/location', locationRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));