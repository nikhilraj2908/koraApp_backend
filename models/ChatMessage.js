const mongoose = require('mongoose');

/**
 * A single message inside a Conversation.
 */
const ChatMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },

    // Account._id of the sender.
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },

    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },

    // Account._ids that have marked this message as read.
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
      },
    ],
  },
  { timestamps: true }
);

ChatMessageSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
