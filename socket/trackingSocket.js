// socket/trackingSocket.js


const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const Order = require("../models/Order");

let io;


const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  // Optional-but-verified auth: if a token is provided during the
  // handshake, it MUST be valid (bad token -> connection rejected). No
  // token at all is still allowed, to avoid breaking the existing
  // customer-tracking `join_order` flow, which doesn't currently send
  // one — but this is what lets NEW code (accept_ride_offer below)
  // require socket.riderId to be genuinely verified rather than trusting
  // whatever riderId a client claims in an event payload.
  //
  // NOTE: `join_rider_room` / `join_washer_room` further down still
  // trust a client-supplied id with no verification at all — that's
  // pre-existing behavior this change doesn't touch. Worth hardening
  // those the same way this authenticates accept_ride_offer, but that's
  // a separate, deliberate follow-up rather than bundled silently here.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(); // unauthenticated connection allowed through

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id ?? null;
      socket.riderId = decoded.riderId ?? null;
      socket.role = decoded.role ?? null;
      next();
    } catch (err) {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    // join_order — customer app se aata hai
    socket.on('join_order', async ({ orderNumber }) => {
      console.log(`[Socket] join_order received for: ${orderNumber}`);

      socket.join(`order_${orderNumber}`);
      console.log(`[Socket] Socket ${socket.id} joined room: order_${orderNumber}`);

      try {
        const order = await Order.findOne({ orderNumber })
          .populate('riderPickupId', 'name phone')
          .populate('riderDeliveryId', 'name phone');

        if (!order) {
          socket.emit('error', { message: 'Order not found' });
          return;
        }

        // Initial state bhejo
        socket.emit('order_state', buildOrderPayload(order));
        console.log(`[Socket] order_state emitted for: ${orderNumber}`);
      } catch (err) {
        console.error('[Socket] join_order error:', err);
        socket.emit('error', { message: 'Server error' });
      }
    });
    // washer room — sab washers ek common room mein
    socket.on('join_washer_room', ({ washerId }) => {
      socket.join('washer_room');
      socket.join(`washer_${washerId}`);
      console.log(`[Socket] Washer ${washerId} joined washer_room`);
    });

    // rider room — sab riders ek common room mein
    socket.on('join_rider_room', ({ riderId }) => {
      socket.join('rider_room');
      socket.join(`rider_${riderId}`);
      console.log(`[Socket] Rider ${riderId} joined rider_room`);
    });

    // admin bell — verified admin/subadmin (role decoded from the JWT
    // during the handshake above) auto-joins their own notification room.
    // No client-side join event needed: just connect with the token.
    if (socket.userId && (socket.role === 'admin' || socket.role === 'subadmin')) {
      socket.join(`admin_notifications_${socket.userId}`);
      console.log(`[Socket] Admin ${socket.userId} joined their notification room`);
    }

    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });
  });

  return io;
};

// ── Washer ko new order notify karo ──────────────────────────
function emitNewOrderToWashers(order) {
  if (!io) return;
  console.log('[Socket] Emitting new_washer_order to washer_room:', order.orderNumber);
  io.to('washer_room').emit('new_washer_order', {
    _id: order._id,
    orderNumber: order.orderNumber,
    items: order.items,
    totalAmount: order.totalAmount,
    pickupAddress: order.pickupAddress,
    status: order.status,
    createdAt: order.createdAt,
  });
}

/* ════════════════════════════════════════════════
   EMIT HELPERS  (called from REST controllers)
════════════════════════════════════════════════ */

/**
 * Call this from updateOrderStatus controller after saving:
 *   emitOrderUpdate(order);
 */


/* ── Internal helper: shape the payload ── */
function buildOrderPayload(order) {
  return {
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    status: order.status,
    statusLabel: STATUS_LABEL[order.status] ?? order.status,
    trackingSteps: buildTrackingSteps(order),
    riderPickup: order.riderPickupId
      ? { _id: order.riderPickupId._id, name: order.riderPickupId.fullName || order.riderPickupId.name, phone: order.riderPickupId.phone }
      : null,
    riderDelivery: order.riderDeliveryId
      ? { _id: order.riderDeliveryId._id, name: order.riderDeliveryId.fullName || order.riderDeliveryId.name, phone: order.riderDeliveryId.phone }
      : null,
    estimatedDelivery: order.estimatedDelivery ?? null,
    deliveryAddress: order.deliveryAddress,
  };
}

/* ── Status meta (mirrors trackOrderController) ── */
const STATUS_LABEL = {
  pending_sp:               "Order Placed",
  grouped:                  "Finding Washer",
  washer_offer_pending:     "Finding Washer",
  washer_assigned:          "Washer Assigned",
  sp_assigned:              "SP Assigned",
  sp_accepted:              "SP Accepted",
  rider_pickup_assigned:    "Rider Assigned for Pickup",
  picked_up:                "Order Picked Up",
  delivered_to_washer:      "Delivered to Washer",
  at_sp:                    "At Service Provider",
  cleaned:                  "Cleaned",
  rider_delivery_assigned:  "Out for Delivery",
  delivered:                "Delivered",
  cancelled:                "Cancelled",
};

const STATUS_ICON = {
  pending_sp:               "package-variant-closed",
  grouped:                  "account-search",
  washer_offer_pending:     "account-search",
  washer_assigned:          "store-check-outline",
  sp_assigned:              "account-check-outline",
  sp_accepted:              "handshake-outline",
  rider_pickup_assigned:    "motorbike",
  picked_up:                "package-variant",
  delivered_to_washer:      "store-plus",
  at_sp:                    "store-outline",
  cleaned:                  "tshirt-crew",
  rider_delivery_assigned:  "truck-delivery",
  delivered:                "check-circle-outline",
  cancelled:                "close-circle-outline",
};

const STATUS_SEQUENCE = [
  "pending_sp", "grouped", "washer_offer_pending", "washer_assigned",
  "rider_pickup_assigned", "picked_up", "delivered_to_washer",
  "at_sp", "cleaned", "rider_delivery_assigned", "delivered",
];
function emitPickupRiderNeeded(order) {
  if (!io) return;
  console.log('[Socket] Emitting pickup_rider_needed to rider_room:', order.orderNumber);
  console.log('[Socket] Total connected clients:', io.engine.clientsCount);
  io.to('rider_room').emit('pickup_rider_needed', {
    _id: order._id,
    orderNumber: order.orderNumber,
    pickupAddress: order.pickupAddress,
    deliveryAddress: order.deliveryAddress,
    totalAmount: order.totalAmount,
    status: order.status,
    type: 'Pickup',
    createdAt: order.createdAt,
  });
}

// ── Order update emit ─────────────────────────────────────────
function emitOrderUpdate(order) {
  if (!io) return;
  io.to(`order_${order.orderNumber}`).emit("order_update", buildOrderPayload(order));
}


function buildTrackingSteps(order) {
  const history = order.statusHistory || [];
  const allSteps = order.status === "cancelled"
    ? [...STATUS_SEQUENCE, "cancelled"]
    : STATUS_SEQUENCE;

  const steps = allSteps.map((s) => {
    const entry = history.find((h) => h.status === s);
    const completed = !!entry;
    let time = "";

    if (completed && entry?.updatedAt) {
      time = new Date(entry.updatedAt).toLocaleTimeString("en-IN", {
        hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
      });
    } else if (s === "rider_delivery_assigned" && !completed &&
      !["delivered", "cancelled"].includes(order.status)) {
      const base = history.find((h) => h.status === "cleaned")?.updatedAt || order.createdAt;
      const est = new Date(new Date(base).getTime() + 2 * 60 * 60 * 1000);
      time = `Est. ${est.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })}`;
    }

    return { status: s, label: STATUS_LABEL[s], icon: STATUS_ICON[s], time, completed, isEst: s === "rider_delivery_assigned" && !completed };
  });

  const currentIdx = allSteps.indexOf(order.status);
  return order.status === "cancelled"
    ? steps.filter((s) => s.status === "cancelled" || s.completed)
    : steps.slice(0, currentIdx + 2);
}
const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

// Real-time push for the admin dashboard's bell icon. Best-effort only —
// GET /api/notifications is always the source of truth; this just saves a
// page refresh when it works. Silently no-ops if io isn't initialized yet
// or the emit fails for any reason.
function emitAdminNotification(accountId, notification) {
  try {
    if (!io) return;
    io.to(`admin_notifications_${accountId}`).emit('new_notification', notification);
  } catch (err) {
    console.log('[Socket] emitAdminNotification failed:', err.message);
  }
}

// ── Washer Group Offer socket helpers ──────────────────────────

/**
 * Emit a new group offer to a specific washer's personal room.
 * washerId → room name: washer_<washerId>
 */
function emitWasherGroupOffer(washerId, offerPayload) {
  if (!io) return;
  io.to(`washer_${washerId}`).emit("washer_group_offer_created", offerPayload);
  console.log(`[Socket] washer_group_offer_created → washer_${washerId}`);
}

/**
 * Broadcast that a washer group offer has been accepted (stop ringing).
 * Sends to the specific washer's personal room.
 */
function emitWasherGroupOfferResolved(washerId, payload) {
  if (!io) return;
  io.to(`washer_${washerId}`).emit("washer_group_offer_resolved", payload);
}

/**
 * Broadcast that a washer group offer has expired with no acceptance.
 */
function emitWasherGroupOfferExpired(washerId, payload) {
  if (!io) return;
  io.to(`washer_${washerId}`).emit("washer_group_offer_expired", payload);
}

/**
 * Emits a real-time verification update to washer or rider personal room.
 * @param {'washer'|'rider'} role
 * @param {string|ObjectId} id
 * @param {object} payload - { verificationStatus, isVerified, verificationNote }
 */
function emitVerificationStatusUpdated(role, id, payload) {
  if (!io) return;
  const room = role === "washer" ? `washer_${id}` : `rider_${id}`;
  io.to(room).emit("verification_status_updated", payload);
  console.log(`[Socket] verification_status_updated → ${room}:`, payload);
}

module.exports = {
  initSocket,
  emitOrderUpdate,
  emitNewOrderToWashers,
  getIO,
  emitPickupRiderNeeded,
  emitAdminNotification,
  emitWasherGroupOffer,
  emitWasherGroupOfferResolved,
  emitWasherGroupOfferExpired,
  emitVerificationStatusUpdated,
};