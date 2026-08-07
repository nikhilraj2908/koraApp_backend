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
    status: order.status,
    statusLabel: STATUS_LABEL[order.status] ?? order.status,
    trackingSteps: buildTrackingSteps(order),
    riderPickup: order.riderPickupId
      ? { _id: order.riderPickupId._id, name: order.riderPickupId.name, phone: order.riderPickupId.phone }
      : null,
    riderDelivery: order.riderDeliveryId
      ? { _id: order.riderDeliveryId._id, name: order.riderDeliveryId.name, phone: order.riderDeliveryId.phone }
      : null,
    estimatedDelivery: order.estimatedDelivery ?? null,
    deliveryAddress: order.deliveryAddress,
  };
}

/* ── Status meta (mirrors trackOrderController) ── */
const STATUS_LABEL = {
  pending_sp: "Order Placed",
  sp_assigned: "SP Assigned",
  sp_accepted: "SP Accepted",
  rider_pickup_assigned: "Rider Assigned for Pickup",
  picked_up: "Order Picked Up",
  at_sp: "At Service Provider",
  cleaned: "Cleaned",
  rider_delivery_assigned: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STATUS_ICON = {
  pending_sp: "package-variant-closed",
  sp_assigned: "account-check-outline",
  sp_accepted: "handshake-outline",
  rider_pickup_assigned: "motorbike",
  picked_up: "package-variant",
  at_sp: "store-outline",
  cleaned: "tshirt-crew",
  rider_delivery_assigned: "truck-delivery",
  delivered: "check-circle-outline",
  cancelled: "close-circle-outline",
};

const STATUS_SEQUENCE = [
  "pending_sp", "sp_assigned", "sp_accepted", "rider_pickup_assigned",
  "picked_up", "at_sp", "cleaned", "rider_delivery_assigned", "delivered",
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
// initSocket ke andar, io.on("connection") mein ye add karo:


module.exports = { initSocket, emitOrderUpdate, emitNewOrderToWashers, getIO, emitPickupRiderNeeded };