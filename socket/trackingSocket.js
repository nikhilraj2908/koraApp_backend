// socket/trackingSocket.js
// Attach this to your existing Express server.
// Usage in app.js:
//   const { createServer } = require("http");
//   const { initSocket }   = require("./socket/trackingSocket");
//   const httpServer = createServer(app);
//   initSocket(httpServer);
//   httpServer.listen(PORT);

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const Order = require("../models/Order");

let io;

/* ════════════════════════════════════════════════
   INIT — call once at server start
════════════════════════════════════════════════ */
function initSocket(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: "*",           // tighten in production
            methods: ["GET", "POST"],
        },
    });

    /* ── JWT auth middleware ── */
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error("No token"));
        try {
            socket.user = jwt.verify(token, process.env.JWT_SECRET);
            next();
        } catch {
            next(new Error("Invalid token"));
        }
    });

    io.on("connection", (socket) => {
        console.log(`[Socket] connected: ${socket.id} | user: ${socket.user.id}`);

        /* ─────────────────────────────────────────
           Customer joins an order room
           Client emits: join_order { orderNumber }
        ───────────────────────────────────────── */
        socket.on('join_order', async ({ orderNumber }) => {
            const order = await Order.findOne({ orderNumber });  // ← query by orderNumber, not _id
            if (!order) return socket.emit('error', { message: 'Order not found' });
            socket.join(`order_${orderNumber}`);
            socket.emit('order_state', buildOrderPayload(order));

        });

        /* ─────────────────────────────────────────
           Rider sends location update
           Client emits: rider_location { orderNumber, lat, lng }
           (called from rider app every ~5 sec)
        ───────────────────────────────────────── */
        socket.on("rider_location", ({ orderNumber, lat, lng }) => {
            if (!orderNumber || lat == null || lng == null) return;

            // Broadcast to all customers watching this order
            io.to(`order_${orderNumber}`).emit("rider_location", { lat, lng });
        });

        socket.on("disconnect", () => {
            console.log(`[Socket] disconnected: ${socket.id}`);
        });
    });

    return io;
}

/* ════════════════════════════════════════════════
   EMIT HELPERS  (called from REST controllers)
════════════════════════════════════════════════ */

/**
 * Call this from updateOrderStatus controller after saving:
 *   emitOrderUpdate(order);
 */
function emitOrderUpdate(order) {
    if (!io) return;
    io.to(`order_${orderNumber}`).emit("order_update", buildOrderPayload(order));
}

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
                hour: "2-digit", minute: "2-digit", hour12: true,
            });
        } else if (s === "rider_delivery_assigned" && !completed &&
            !["delivered", "cancelled"].includes(order.status)) {
            const base = history.find((h) => h.status === "cleaned")?.updatedAt || order.createdAt;
            const est = new Date(new Date(base).getTime() + 2 * 60 * 60 * 1000);
            time = `Est. ${est.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
        }

        return { status: s, label: STATUS_LABEL[s], icon: STATUS_ICON[s], time, completed, isEst: s === "rider_delivery_assigned" && !completed };
    });

    const currentIdx = allSteps.indexOf(order.status);
    return order.status === "cancelled"
        ? steps.filter((s) => s.status === "cancelled" || s.completed)
        : steps.slice(0, currentIdx + 2);
}

module.exports = { initSocket, emitOrderUpdate };