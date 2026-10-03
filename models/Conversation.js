const mongoose = require('mongoose');

/**
 * Internal operational chat conversation between Admin and a Sub-admin/Regional Manager.
 *
 * participants: array of Account._id values.
 *   - Always includes at least one admin (level==='admin') Account ID.
 *   - Plus exactly one manager (subadmin/regional_manager) Account ID.
 *
 * Managers cannot create conversations with other managers.
 */
const ConversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
        required: true,
      },
    ],

    // Optional: tie a conversation to a service area (for context display).
    serviceAreaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceArea',
      default: null,
    },

    // Denormalized for fast sorting / display.
    lastMessageAt: { type: Date, default: null },
    lastMessageText: { type: String, default: null, maxlength: 200 },
  },
  { timestamps: true }
);

// Each pair of participants has only one conversation.
ConversationSchema.index({ participants: 1 });

module.exports = mongoose.model('Conversation', ConversationSchema);
