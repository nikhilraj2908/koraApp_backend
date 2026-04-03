const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
  category: String,    // Men, Women, Child
  subCategory: String, // upper, lower, etc
  productName: String, // Shirt, Saree, etc
  service: { type: String, enum: ['wash', 'iron', 'both'] },
  quantity: Number,
  price: Number
});

const OrderSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  items: [OrderItemSchema],
  totalAmount: Number,
  status: {
    type: String,
    enum: ['pending_sp', 'sp_assigned', 'sp_accepted', 'rider_pickup_assigned', 'picked_up', 'at_sp', 'cleaned', 'rider_delivery_assigned', 'delivered', 'cancelled'],
    default: 'pending_sp'
  },
  pickupAddress: {
    coordinates: [Number],
    address: String
  },
  deliveryAddress: {
    coordinates: [Number],
    address: String
  },
  serviceProviderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceProvider' },
  riderPickupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Rider' },
  riderDeliveryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Rider' },
  spAcceptedAt: Date,
  pickupScheduledAt: Date,
  deliveryScheduledAt: Date,
  paymentMethod: String,
  paymentStatus: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', OrderSchema);