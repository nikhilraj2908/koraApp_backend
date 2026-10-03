/**
 * controllers/chatController.js
 *
 * Internal Admin ↔ Manager chat.
 * All endpoints run AFTER: protect, restrictTo('admin','subadmin','regional_manager'), loadAdminProfile.
 */

const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const ChatMessage = require('../models/ChatMessage');
const Account = require('../models/Account');
const Admin = require('../models/Admin');

const ok = (res, data, code = 200) => res.status(code).json({ success: true, data });
const fail = (res, message, code = 500) => res.status(code).json({ success: false, message });

const ADMIN_ROLES = ['admin', 'subadmin', 'regional_manager'];

// ── Helper: verify the caller is a participant in a conversation ─────────────
async function assertParticipant(conversationId, accountId) {
  const convo = await Conversation.findById(conversationId);
  if (!convo) return null;
  const participantIds = convo.participants.map((p) => p.toString());
  if (!participantIds.includes(accountId.toString())) return null;
  return convo;
}

/**
 * GET /api/admin/chat/conversations
 * Returns all conversations the caller is a participant in.
 */
exports.listConversations = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const query = { participants: req.user.id };
    const [conversations, total] = await Promise.all([
      Conversation.find(query)
        .populate({ path: 'participants', select: 'email mobile role' })
        .populate({ path: 'serviceAreaId', select: 'name' })
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Conversation.countDocuments(query),
    ]);

    // Enrich each conversation with the other participant's Admin profile (name, level)
    const adminProfiles = await Admin.find({
      accountId: {
        $in: conversations.flatMap((c) => c.participants.map((p) => p._id || p)),
      },
    }).lean();
    const profileMap = new Map(adminProfiles.map((a) => [a.accountId.toString(), a]));

    // For each conversation, count unread messages for the caller
    const convoIds = conversations.map((c) => c._id);
    const unreadAgg = await ChatMessage.aggregate([
      {
        $match: {
          conversationId: { $in: convoIds },
          senderId: { $ne: new mongoose.Types.ObjectId(req.user.id) },
          readBy: { $ne: new mongoose.Types.ObjectId(req.user.id) },
        },
      },
      { $group: { _id: '$conversationId', count: { $sum: 1 } } },
    ]);
    const unreadMap = new Map(unreadAgg.map((u) => [u._id.toString(), u.count]));

    const enriched = conversations.map((c) => {
      const cObj = c.toObject();
      cObj.participants = cObj.participants.map((p) => {
        const profile = profileMap.get((p._id || p).toString());
        return {
          ...p,
          fullName: profile?.fullName || null,
          level: profile?.level || null,
        };
      });
      cObj.unreadCount = unreadMap.get(c._id.toString()) || 0;
      return cObj;
    });

    ok(res, { conversations: enriched, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    fail(res, err.message);
  }
};

/**
 * POST /api/admin/chat/conversations
 * Start or resume a conversation.
 *   - Admin can start a conversation with any sub-admin or regional_manager.
 *   - Manager can start a conversation with an Admin.
 *   - Managers cannot talk to other managers.
 *
 * Body: { participantId: <Account._id of the other party>, serviceAreaId? }
 */
exports.createOrGetConversation = async (req, res) => {
  try {
    const { participantId, serviceAreaId } = req.body;
    if (!participantId) {
      return fail(res, 'participantId is required', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(participantId)) {
      return fail(res, 'Invalid participantId', 400);
    }
    if (participantId.toString() === req.user.id.toString()) {
      return fail(res, 'Cannot start a conversation with yourself', 400);
    }

    // Validate the other party exists and is an admin/manager account
    const otherAccount = await Account.findById(participantId).select('role');
    if (!otherAccount || !ADMIN_ROLES.includes(otherAccount.role)) {
      return fail(res, 'Participant must be an admin, sub-admin, or regional manager', 400);
    }

    // Get other party's Admin profile for level check
    const otherProfile = await Admin.findOne({ accountId: participantId }).select('level');

    const myRole = req.admin.level; // 'admin', 'subadmin', 'regional_manager'

    // Managers cannot talk to each other directly
    if (myRole !== 'admin' && otherProfile?.level !== 'admin') {
      return fail(res, 'CHAT_ACCESS_DENIED: Managers cannot start conversations with other managers', 403);
    }
    // A non-admin cannot start a conversation unless talking to an admin
    if (myRole !== 'admin' && otherProfile?.level !== 'admin') {
      return fail(res, 'CHAT_ACCESS_DENIED: You can only message an admin', 403);
    }

    // Find existing conversation between these two
    const participants = [
      new mongoose.Types.ObjectId(req.user.id),
      new mongoose.Types.ObjectId(participantId),
    ];

    let convo = await Conversation.findOne({
      participants: { $all: participants, $size: 2 },
    });

    if (!convo) {
      const createData = { participants };
      if (serviceAreaId && mongoose.Types.ObjectId.isValid(serviceAreaId)) {
        createData.serviceAreaId = serviceAreaId;
      }
      convo = await Conversation.create(createData);
    }

    await convo.populate([
      { path: 'participants', select: 'email mobile role' },
      { path: 'serviceAreaId', select: 'name' },
    ]);

    ok(res, convo, 201);
  } catch (err) {
    fail(res, err.message);
  }
};

/**
 * GET /api/admin/chat/conversations/:id/messages
 * Paginated message history.
 */
exports.getMessages = async (req, res) => {
  try {
    const convo = await assertParticipant(req.params.id, req.user.id);
    if (!convo) return fail(res, 'CHAT_ACCESS_DENIED: Not a participant', 403);

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

    const [messages, total] = await Promise.all([
      ChatMessage.find({ conversationId: convo._id })
        .populate({ path: 'senderId', select: 'email mobile role' })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ChatMessage.countDocuments({ conversationId: convo._id }),
    ]);

    // Enrich senders with their Admin profile name
    const senderIds = [...new Set(messages.map((m) => m.senderId?._id?.toString()).filter(Boolean))];
    const profiles = await Admin.find({ accountId: { $in: senderIds } }).lean();
    const profileMap = new Map(profiles.map((p) => [p.accountId.toString(), p]));

    const enriched = messages.map((m) => {
      const mObj = m.toObject();
      const profile = profileMap.get(mObj.senderId?._id?.toString());
      if (mObj.senderId) mObj.senderId.fullName = profile?.fullName || null;
      return mObj;
    });

    ok(res, {
      messages: enriched.reverse(), // chronological order
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    fail(res, err.message);
  }
};

/**
 * POST /api/admin/chat/conversations/:id/messages
 * Send a message.
 */
exports.sendMessage = async (req, res) => {
  try {
    const convo = await assertParticipant(req.params.id, req.user.id);
    if (!convo) return fail(res, 'CHAT_ACCESS_DENIED: Not a participant', 403);

    const { text } = req.body;
    if (!text || !text.trim()) {
      return fail(res, 'Message text cannot be empty', 400);
    }
    if (text.length > 4000) {
      return fail(res, 'Message text too long (max 4000 chars)', 400);
    }

    // Persist first, then emit
    const message = await ChatMessage.create({
      conversationId: convo._id,
      senderId: req.user.id,
      text: text.trim(),
      readBy: [req.user.id], // sender has read their own message
    });

    // Update conversation metadata
    convo.lastMessageAt = message.createdAt;
    convo.lastMessageText = text.trim().substring(0, 200);
    await convo.save();

    await message.populate({ path: 'senderId', select: 'email mobile role' });

    // Real-time push to conversation room participants
    if (req.io) {
      req.io.to(`chat_${convo._id}`).emit('chat:newMessage', {
        conversationId: convo._id,
        message: message.toObject(),
      });
    }

    ok(res, message, 201);
  } catch (err) {
    fail(res, err.message);
  }
};

/**
 * PATCH /api/admin/chat/conversations/:id/read
 * Mark all unread messages in this conversation as read for the caller.
 */
exports.markRead = async (req, res) => {
  try {
    const convo = await assertParticipant(req.params.id, req.user.id);
    if (!convo) return fail(res, 'CHAT_ACCESS_DENIED: Not a participant', 403);

    const result = await ChatMessage.updateMany(
      {
        conversationId: convo._id,
        senderId: { $ne: req.user.id },
        readBy: { $ne: req.user.id },
      },
      { $addToSet: { readBy: req.user.id } }
    );

    // Notify other participants via socket
    if (req.io) {
      req.io.to(`chat_${convo._id}`).emit('chat:read', {
        conversationId: convo._id,
        readBy: req.user.id,
      });
    }

    ok(res, { markedRead: result.modifiedCount });
  } catch (err) {
    fail(res, err.message);
  }
};

/**
 * GET /api/admin/chat/unread
 * Total unread message count for the authenticated user.
 */
exports.getUnreadCount = async (req, res) => {
  try {
    const myConvos = await Conversation.find(
      { participants: req.user.id },
      '_id'
    );
    const convoIds = myConvos.map((c) => c._id);

    const count = await ChatMessage.countDocuments({
      conversationId: { $in: convoIds },
      senderId: { $ne: new mongoose.Types.ObjectId(req.user.id) },
      readBy: { $ne: new mongoose.Types.ObjectId(req.user.id) },
    });

    ok(res, { unreadCount: count });
  } catch (err) {
    fail(res, err.message);
  }
};
