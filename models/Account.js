const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true,
    trim: true
  },
  mobile: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true
  },
  password: { 
    type: String, 
    required: true 
  },
  role: { 
    type: String, 
    enum: ['customer', 'rider', 'serviceProvider','admin'], 
    required: true 
  },
  isVerified: { 
    type: Boolean, 
    default: true 
  },
  googleId: { type: String },  // remove if not used
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

module.exports = mongoose.model('Account', AccountSchema);