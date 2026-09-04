const mongoose = require("mongoose");
const Order = require("../models/Order");
const Service = require("../models/Servicemodel");
const Customer = require("../models/Customer");
const Wallet = require("../models/WalletCustomer");

const {
  emitNewOrderToWashers,
  emitOrderUpdate,
} = require("../socket/trackingSocket");

const {
  notifyCustomer,
} = require("../utils/notification");

const {
  resolvePickupSlot,
} = require("../helpers/slotHelper");

const {
  handleOrderCancellation,
} = require("../services/dispatchCancellationService");

const {
  ALLOW_MID_PIPELINE_CANCELLATION,
} = require("../constants/dispatchConstants");

const formatOrderDisplayDateTime = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

// ─────────────────────────────────────────────────────────────────────────────
// Cancellation and refund policy
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CANCELLATION_WINDOW_MS =
  2 * 60 * 60 * 1000; // Strictly 2 hours maximum cancellation window

const PICKUP_STARTED_STATUSES = [
  "picked_up",
  "at_sp",
  "cleaned",
  "rider_delivery_assigned",
  "delivered",
];

// ─────────────────────────────────────────────────────────────────────────────
// Create order
// ─────────────────────────────────────────────────────────────────────────────

exports.createOrder = async (req, res) => {
  try {
    const customerId = req.user.id;

    let {
      items,
      pickupAddress,
      deliveryAddress,
      paymentMethod,
      paymentStatus,
      pickupDay,
      timeSlot,
    } = req.body;

    // When cloth photos are attached, the request arrives as
    // multipart/form-data instead of application/json — multer parses the
    // files into req.files, but every other field (including these) comes
    // through as a plain string, not a parsed object/array. A pure-JSON
    // request (no photos) is unaffected since these are already
    // objects/arrays in that case.
    if (typeof items === "string") {
      try {
        items = JSON.parse(items);
      } catch {
        return res.status(400).json({ success: false, message: "Invalid items payload" });
      }
    }
    if (typeof pickupAddress === "string") {
      try {
        pickupAddress = JSON.parse(pickupAddress);
      } catch {
        return res.status(400).json({ success: false, message: "Invalid pickupAddress payload" });
      }
    }
    if (typeof deliveryAddress === "string") {
      try {
        deliveryAddress = JSON.parse(deliveryAddress);
      } catch {
        return res.status(400).json({ success: false, message: "Invalid deliveryAddress payload" });
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Cart empty",
      });
    }

    const validPaymentMethods = ["cash", "upi", "card"];
    const normalizedPaymentMethod = paymentMethod
      ? String(paymentMethod).toLowerCase().trim()
      : null;

    if (!normalizedPaymentMethod || !validPaymentMethods.includes(normalizedPaymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing paymentMethod. Allowed methods: cash, upi, card",
      });
    }

    const finalItems = [];
    let subtotal = 0;

    for (const item of items) {
      const service = await Service.findById(
        item.serviceId
      );

      if (!service) {
        return res.status(400).json({
          success: false,
          message: "Invalid service",
        });
      }

      const quantity = Number(item.quantity);

      if (!quantity || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid item quantity",
        });
      }

      const unitPrice = Number(
        service.pricePerKg
      );

      const totalPrice =
        unitPrice * quantity;

      subtotal += totalPrice;

      finalItems.push({
        serviceId: service._id,
        serviceName: service.name,
        categoryName: item.categoryName,
        subCategoryName:
          item.subCategoryName,
        quantity,
        unitPrice,
        totalPrice,
      });
    }

    // Prices are GST-inclusive.
    const discount = 0;
    const totalAmount =
      subtotal - discount;

    const tax = +(
      subtotal -
      subtotal / 1.05
    ).toFixed(2);

    const orderNumber =
      `KR${Date.now()}`;

    // ─────────────────────────────────────────────────────────────────────────
    // Dispatch system fields
    // ─────────────────────────────────────────────────────────────────────────

    const bookingTime = new Date();

    const {
      pickupSlot,
      pickupDate,
    } = await resolvePickupSlot(
      bookingTime
    );

    const clothQuantity =
      finalItems.reduce(
        (sum, item) =>
          sum + item.quantity,
        0
      );

    const coordinates =
      pickupAddress?.coordinates;

    const hasValidCoordinates =
      Array.isArray(coordinates) &&
      coordinates.length === 2 &&
      coordinates.every(
        (coordinate) =>
          typeof coordinate ===
            "number" &&
          Number.isFinite(coordinate)
      );

    const pickupLocation =
      hasValidCoordinates
        ? {
            type: "Point",
            coordinates,
          }
        : undefined;

    if (!pickupLocation) {
      console.error(
        `[Dispatch] Order ${orderNumber} created without valid pickup coordinates. It will not be eligible for automatic pickup grouping.`
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Customer-selected pickup time
    // ─────────────────────────────────────────────────────────────────────────

    let pickupScheduledAt = null;

    if (pickupDay && timeSlot) {
      const match = String(
        timeSlot
      ).match(
        /(\d+):(\d+)\s*(AM|PM)/i
      );

      if (match) {
        let hour = parseInt(
          match[1],
          10
        );

        const minute = parseInt(
          match[2],
          10
        );

        const period =
          match[3].toUpperCase();

        if (
          period === "PM" &&
          hour !== 12
        ) {
          hour += 12;
        }

        if (
          period === "AM" &&
          hour === 12
        ) {
          hour = 0;
        }

        const formattedHour =
          String(hour).padStart(
            2,
            "0"
          );

        const formattedMinute =
          String(minute).padStart(
            2,
            "0"
          );

        pickupScheduledAt =
          new Date(
            `${pickupDay}T${formattedHour}:${formattedMinute}:00`
          );

        if (
          Number.isNaN(
            pickupScheduledAt.getTime()
          )
        ) {
          pickupScheduledAt = null;
        }
      }
    }

    // Cash-on-Delivery orders must ALWAYS initialize as "pending".
    // Cash is physically collected at pickup/delivery, never at booking time.
    let normalizedPaymentStatus = "pending";
    if (normalizedPaymentMethod !== "cash") {
      if (paymentStatus === "paid" || paymentStatus === "success") {
        normalizedPaymentStatus = "paid";
      } else if (paymentStatus === "failed") {
        normalizedPaymentStatus = "failed";
      }
    }

    const orderData = {
      customerId,
      orderNumber,
      items: finalItems,
      subtotal,
      tax,
      discount,
      totalAmount,
      pickupAddress,
      deliveryAddress,
      paymentMethod: normalizedPaymentMethod,
      paymentStatus:
        normalizedPaymentStatus,
      pickupScheduledAt,

      // Dispatch fields
      clothQuantity,
      bookingTime,
      pickupDate,
      pickupSlot,
      dispatchStatus:
        "awaiting_slot",

      status: "pending_sp",

      statusHistory: [
        {
          status: "pending_sp",
          note: "Order placed successfully",
        },
      ],
    };

    // Optional cloth photos, grouped by service type — only present when
    // the request was multipart/form-data with washPhotos/ironPhotos
    // file fields attached. Purely optional, matches the "Optional" label
    // shown in the app: an order with zero photos in either group is
    // completely normal and unaffected.
    if (req.files && (req.files.washPhotos?.length || req.files.ironPhotos?.length)) {
      orderData.clothPhotos = {
        wash: (req.files.washPhotos || []).map((f) => `/uploads/${f.filename}`),
        iron: (req.files.ironPhotos || []).map((f) => `/uploads/${f.filename}`),
      };
    }

    // Avoid storing incomplete GeoJSON.
    if (pickupLocation) {
      orderData.pickupLocation =
        pickupLocation;
    }

    const order =
      await Order.create(
        orderData
      );

    console.log(
      `[CreateOrder] Order created: ${order.orderNumber}`
    );

    // Notify washers/service providers.
    try {
      emitNewOrderToWashers(order);
    } catch (socketError) {
      console.error(
        `[CreateOrder] Washer socket notification failed for ${order.orderNumber}:`,
        socketError
      );
    }

    // Create in-app history and send push notification to customer.
    try {
      await notifyCustomer(
        customerId,
        {
          title:
            "Order Placed! 🎉",

          body:
            `Your order ${order.orderNumber} has been placed successfully.`,

          type: "order_placed",

          orderId:
            order._id,

          orderNumber:
            order.orderNumber,
        }
      );

      console.log(
        `[CreateOrder] Customer notification sent for ${order.orderNumber}`
      );
    } catch (
      notificationError
    ) {
      // Notification failure should never fail an otherwise successful order.
      console.error(
        `[CreateOrder] Customer notification failed for ${order.orderNumber}:`,
        notificationError
      );
    }

    return res
      .status(201)
      .json({
        success: true,
        message:
          "Order created",
        data: order,
      });
  } catch (error) {
    console.error(
      "[CreateOrder] Error:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          error.message,
      });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Recent orders
// ─────────────────────────────────────────────────────────────────────────────

exports.getRecentOrders =
  async (req, res) => {
    try {
      const customerId =
        req.user.id;

      const orders =
        await Order.find({
          customerId,
        })
          .sort({
            createdAt: -1,
          })
          .limit(10);

      return res.json({
        success: true,
        data: orders,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          success: false,
          message:
            error.message,
        });
    }
  };

// ─────────────────────────────────────────────────────────────────────────────
// Order details
// ─────────────────────────────────────────────────────────────────────────────

exports.getOrderDetails = async (req, res) => {
  try {
    const rawId = req.params.id;
    const isObjectId = mongoose.Types.ObjectId.isValid(rawId);
    let query = Order.findOne({
      $or: [
        { orderNumber: rawId },
        ...(isObjectId ? [{ _id: rawId }] : []),
      ],
    });

    if (query && typeof query.populate === 'function') {
      query = query
        .populate({ path: "riderPickupId", select: "fullName phone vehicleType vehicleRegNo" })
        .populate({ path: "riderDeliveryId", select: "fullName phone vehicleType vehicleRegNo" })
        .populate({ path: "serviceProviderId", select: "name phone shopAddress" });
    }

    const order = await query;

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Customer users should not be able to access another customer's order.
    // Admin and subadmin staff are authorized to inspect order details.
    const isOwner =
      order.customerId &&
      order.customerId.toString() === req.user.id;
    const isAdminStaff = ["admin", "subadmin"].includes(req.user.role);

    if (!isOwner && !isAdminStaff) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view this order",
      });
    }

    return res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Update status
// ─────────────────────────────────────────────────────────────────────────────

exports.updateStatus = async (req, res) => {
  try {
    const { status, note } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const rawId = req.params.id;
    const isObjectId = mongoose.Types.ObjectId.isValid(rawId);
    const order = await Order.findOne({
      $or: [
        { orderNumber: rawId },
        ...(isObjectId ? [{ _id: rawId }] : []),
      ],
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    order.status = status;
    order.statusHistory.push({
      status,
      note: note || `Status updated to ${status}`,
      updatedAt: new Date(),
    });

    await order.save();
    emitOrderUpdate(order);

    return res.json({
      success: true,
      message: "Status updated",
      data: order,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Cancel order
// ─────────────────────────────────────────────────────────────────────────────

exports.cancelOrder = async (req, res) => {
  try {
    const rawId = req.params.id;
    let existingOrder = await Order.findOne({ orderNumber: rawId });
    if (!existingOrder && mongoose.Types.ObjectId.isValid(rawId)) {
      existingOrder = await Order.findById(rawId);
    }

    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (existingOrder.customerId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to cancel this order",
      });
    }

    if (existingOrder.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "This order has already been cancelled",
      });
    }

    if (existingOrder.status === "delivered") {
      return res.status(400).json({
        success: false,
        message: "Delivered orders cannot be cancelled",
      });
    }

    if (PICKUP_STARTED_STATUSES.includes(existingOrder.status)) {
      return res.status(400).json({
        success: false,
        message:
          "This order is already picked up or in process. Please contact support to cancel it.",
      });
    }

    // Stop self-cancellation once dispatch grouping has started.
    if (
      !ALLOW_MID_PIPELINE_CANCELLATION &&
      existingOrder.dispatchStatus &&
      existingOrder.dispatchStatus !== "awaiting_slot"
    ) {
      return res.status(400).json({
        success: false,
        message:
          existingOrder.dispatchStatus === "assigned"
            ? "A rider has already been assigned to pick up this order. Please contact support to cancel it."
            : "This order is currently being matched with a rider. Please contact support to cancel it.",
      });
    }

    // Strict 2-hour cancellation policy: No cancellation allowed after 2 hours
    const placedAt = new Date(existingOrder.createdAt).getTime();
    const timeSincePlacement = Date.now() - placedAt;
    if (timeSincePlacement > MAX_CANCELLATION_WINDOW_MS) {
      return res.status(400).json({
        success: false,
        message:
          "Orders cannot be cancelled after 2 hours of placement. Please contact customer support.",
      });
    }

    // A refund is only applicable if the order was genuinely paid online.
    // Cash-on-delivery orders have not had digital funds collected and must never issue wallet credit.
    const wasPaid =
      existingOrder.paymentStatus === "paid" &&
      existingOrder.paymentMethod !== "cash";
    const refundAmount = wasPaid ? existingOrder.totalAmount : 0;
    const refundMode = refundAmount > 0 ? "wallet_credit" : "none";

    // Atomic State Transition: Guards against concurrent duplicate cancellation calls
    const order = await Order.findOneAndUpdate(
      {
        _id: existingOrder._id,
        customerId: req.user.id,
        status: { $ne: "cancelled" },
      },
      {
        $set: {
          status: "cancelled",
          cancellation: {
            cancelledAt: new Date(),
            cancelledBy: "customer",
            isFreeCancellation: true,
            cancellationFee: 0,
            refundAmount,
            refundMode,
            refundStatus: refundAmount > 0 ? "processing" : "not_applicable",
          },
        },
        $push: {
          statusHistory: {
            status: "cancelled",
            note: "Cancelled by customer within 2-hour cancellation window",
            updatedAt: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!order) {
      return res.status(400).json({
        success: false,
        message: "This order has already been cancelled",
      });
    }

    // Clean up dispatch data
    try {
      await handleOrderCancellation(order);
    } catch (dispatchError) {
      console.error(
        `[CancelOrder] Dispatch cleanup failed for ${order.orderNumber}. The order remains cancelled:`,
        dispatchError
      );
    }

    // Process wallet refund if payment was already made
    let walletBalance = null;
    let walletCreditFailed = false;

    if (refundAmount > 0) {
      try {
        const customer = await Customer.findOne({
          accountId: order.customerId,
        });

        if (!customer) {
          walletCreditFailed = true;
          console.error(
            `[CancelOrder] Customer profile not found for account ${order.customerId}`
          );
        } else {
          // Idempotency check: Ensure wallet transaction for this order does not already exist
          const existingTxn = await Wallet.findOne({
            customerId: customer._id,
            "transactions.orderId": order._id,
            "transactions.type": "refund",
          });

          if (existingTxn) {
            console.warn(
              `[CancelOrder] Wallet refund already exists for order ${order.orderNumber}`
            );
            walletBalance = existingTxn.balance;
          } else {
            const wallet = await Wallet.findOneAndUpdate(
              {
                customerId: customer._id,
              },
              {
                $setOnInsert: {
                  customerId: customer._id,
                },
                $inc: {
                  balance: refundAmount,
                },
                $push: {
                  transactions: {
                    type: "refund",
                    amount: refundAmount,
                    reason: `Refund for cancelled order ${order.orderNumber}`,
                    orderId: order._id,
                    orderNumber: order.orderNumber,
                  },
                },
              },
              {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true,
              }
            );

            walletBalance = wallet.balance;
          }
        }
      } catch (walletError) {
        console.error(
          `[CancelOrder] Wallet credit failed for ${order.orderNumber}:`,
          walletError
        );
        walletCreditFailed = true;
      }
    }

    // Finalize refundStatus on order
    const finalRefundStatus =
      refundAmount > 0
        ? walletCreditFailed
          ? "failed"
          : "completed"
        : "not_applicable";

    await Order.findByIdAndUpdate(order._id, {
      $set: { "cancellation.refundStatus": finalRefundStatus },
    });
    order.cancellation.refundStatus = finalRefundStatus;

    // Customer cancellation push notification
    try {
      await notifyCustomer(order.customerId, {
        title: "Order Cancelled",
        body: `Your order #${order.orderNumber} was cancelled free of charge.`,
        type: "order_cancelled",
        orderId: order._id,
        orderNumber: order.orderNumber,
      });

      console.log(
        `[CancelOrder] Customer notification sent for ${order.orderNumber}`
      );
    } catch (notificationError) {
      console.error(
        `[CancelOrder] Customer notification failed for ${order.orderNumber}:`,
        notificationError
      );
    }

    // Real-time tracking socket emission
    emitOrderUpdate(order);

    return res.json({
      success: true,
      message: "Order cancelled free of charge",
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        isFreeCancellation: true,
        cancellationFee: 0,
        refundAmount,
        refundMode,
        refundStatus: order.cancellation.refundStatus,
        walletBalance,
        walletCreditFailed,
      },
    });
  } catch (error) {
    console.error("[CancelOrder] Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Tracking helpers
// ─────────────────────────────────────────────────────────────────────────────

const getStepLabel = (
  status
) => {
  const map = {
    pending_sp:
      "Order Placed",

    sp_assigned:
      "SP Assigned",

    sp_accepted:
      "SP Accepted",

    rider_pickup_assigned:
      "Rider Assigned for Pickup",

    picked_up:
      "Order Picked Up",

    at_sp:
      "At Service Provider",

    cleaned:
      "Cleaned",

    rider_delivery_assigned:
      "Out for Delivery",

    delivered:
      "Delivered",

    cancelled:
      "Cancelled",
  };

  return map[status] || status;
};

const buildTrackingSteps = (
  order
) => {
  const steps = [];

  const history =
    order.statusHistory || [];

  const stepOrder = [
    "pending_sp",
    "sp_assigned",
    "sp_accepted",
    "rider_pickup_assigned",
    "picked_up",
    "at_sp",
    "cleaned",
    "rider_delivery_assigned",
    "delivered",
    "cancelled",
  ];

  for (const stepStatus of stepOrder) {
    const entry =
      history.find(
        (historyItem) =>
          historyItem.status ===
          stepStatus
      );

    const completed =
      Boolean(entry);

    const isEstimate =
      !completed &&
      stepStatus ===
        "rider_delivery_assigned";

    let time = "";

    if (
      completed &&
      entry?.updatedAt
    ) {
      time = new Date(
        entry.updatedAt
      ).toLocaleString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      });
    } else if (
      isEstimate &&
      order.status !==
        "delivered" &&
      order.status !==
        "cancelled"
    ) {
      const cleanedEntry =
        history.find(
          (historyItem) =>
            historyItem.status ===
            "cleaned"
        );

      const baseTime =
        cleanedEntry?.updatedAt ||
        order.createdAt;

      if (baseTime) {
        const estimatedTime =
          new Date(
            new Date(
              baseTime
            ).getTime() +
              2 *
                60 *
                60 *
                1000
          );

        time =
          `Est. ${estimatedTime.toLocaleTimeString(
            "en-IN",
            {
              hour:
                "2-digit",
              minute:
                "2-digit",
              hour12:
                true,
              timeZone:
                "Asia/Kolkata",
            }
          )}`;
      }
    }

    steps.push({
      label:
        getStepLabel(
          stepStatus
        ),

      time,

      completed,

      isEstimate:
        isEstimate &&
        !completed,
    });
  }

  if (
    order.status ===
    "cancelled"
  ) {
    const cancelIndex =
      steps.findIndex(
        (step) =>
          step.label ===
          "Cancelled"
      );

    return steps.slice(
      0,
      cancelIndex + 1
    );
  }

  const currentIndex =
    steps.findIndex(
      (step) =>
        step.label ===
        getStepLabel(
          order.status
        )
    );

  if (currentIndex < 0) {
    return steps.slice(0, 1);
  }

  return steps.slice(
    0,
    currentIndex + 2
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Active orders
// ─────────────────────────────────────────────────────────────────────────────

exports.getActiveOrder =
  async (req, res) => {
    try {
      const activeStatuses = [
        "pending_sp",
        "sp_assigned",
        "sp_accepted",
        "rider_pickup_assigned",
        "picked_up",
        "at_sp",
        "cleaned",
        "rider_delivery_assigned",
      ];

      const orders =
        await Order.find({
          customerId:
            req.user.id,

          status: {
            $in: activeStatuses,
          },
        }).sort({
          createdAt: -1,
        });

      if (
        !orders ||
        orders.length === 0
      ) {
        return res
          .status(200)
          .json({
            success: true,
            data: [],
          });
      }

      const formattedOrders =
        orders.map(
          (order) => {
            const orderSummary = {
              id:
                order.orderNumber,

              service:
                order.items[0]
                  ?.serviceName ||
                "Laundry",

              items:
                order.items.reduce(
                  (
                    sum,
                    item
                  ) =>
                    sum +
                    item.quantity,
                  0
                ),

              date:
                formatOrderDisplayDateTime(
                  order.createdAt
                ),

              price:
                order.totalAmount,

              status:
                order.status,

              iconName:
                "package-variant",
            };

            const trackingSteps =
              buildTrackingSteps(
                order
              );

            let cancellationDeadline =
              null;

            if (
              order.createdAt &&
              order.status ===
                "pending_sp"
            ) {
              cancellationDeadline =
                new Date(
                  new Date(
                    order.createdAt
                  ).getTime() +
                    FREE_CANCELLATION_WINDOW_MS
                );
            }

            return {
              order:
                orderSummary,

              tracking:
                trackingSteps,

              cancellationDeadline,
            };
          }
        );

      return res.json({
        success: true,
        data:
          formattedOrders,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          success: false,
          message:
            error.message,
        });
    }
  };

// ─────────────────────────────────────────────────────────────────────────────
// Order history
// ─────────────────────────────────────────────────────────────────────────────

exports.getOrderHistory =
  async (req, res) => {
    try {
      console.log(
        "[OrderHistory] User ID:",
        req.user.id
      );

      const historyOrders =
        await Order.find({
          customerId:
            req.user.id,

          status: {
            $in: [
              "delivered",
              "cancelled",
            ],
          },
        }).sort({
          createdAt: -1,
        });

      console.log(
        "[OrderHistory] Orders found:",
        historyOrders.length
      );

      const formatted =
        historyOrders.map(
          (order) => ({
            id:
              order.orderNumber,

            service:
              order.items[0]
                ?.serviceName ||
              "Laundry",

            items:
              order.items.reduce(
                (
                  sum,
                  item
                ) =>
                  sum +
                  item.quantity,
                0
              ),

            date:
              formatOrderDisplayDateTime(
                order.createdAt
              ),

            price:
              order.totalAmount,

            status:
              order.status ===
              "delivered"
                ? "Delivered"
                : "Cancelled",

            iconName:
              "package-variant",
          })
        );

      return res.json({
        success: true,
        data: formatted,
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          success: false,
          message:
            error.message,
        });
    }
  };