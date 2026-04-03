// models/SPAssignmentQueue.js
const mongoose = require('mongoose');

const SPAssignmentQueueSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  serviceProviderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceProvider' },
  offeredAmount: Number,
  retryCount: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'accepted', 'declined', 'expired'], default: 'pending' },
  notifiedAt: Date,
  nextRetryAt: Date
});

module.exports = mongoose.model('SPAssignmentQueue', SPAssignmentQueueSchema);