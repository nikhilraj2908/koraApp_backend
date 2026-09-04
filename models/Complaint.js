const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
    index: true,
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
  photoUrls: {
    type: [String],
    default: [],
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
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual populate for resolving the customer profile (Customer.accountId -> Complaint.user)
complaintSchema.virtual('customer', {
  ref: 'Customer',
  localField: 'user',
  foreignField: 'accountId',
  justOne: true,
});

module.exports = mongoose.model('Complaint', complaintSchema);