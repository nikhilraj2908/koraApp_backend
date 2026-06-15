const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',        // adjust to your user model (Customer, User, etc.)
    required: true,
  },
  category: {
    type: String,           // e.g. "Order Issue - Damaged Item"
    required: true,
  },
  orderId: {
    type: String,
    default: '',
  },
  subject: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
    maxlength: 1000,
  },
  photoUrl: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['pending', 'in-review', 'resolved', 'rejected'],
    default: 'pending',
  },
  adminRemarks: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Complaint', complaintSchema);