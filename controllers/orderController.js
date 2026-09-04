const Order = require("../models/Order");
const Service = require("../models/Servicemodel");
const Customer = require("../models/Customer");
const Wallet = require("../models/WalletCustomer");

const {
  emitNewOrderToWashers,
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

const FREE_CANCELLATION_WINDOW_MS =
  2 * 60 * 60 * 1000;

const LATE_CANCELLATION_FEE = 50;

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

    // Frontend should send "paid".
    // "success" is accepted temporarily for backward compatibility.
    const normalizedPaymentStatus =
      paymentStatus === "paid" ||
      paymentStatus === "success"
        ? "paid"
        : paymentStatus ===
          "failed"
        ? "failed"
        : "pending";

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
      paymentMethod,
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

exports.getOrderDetails =
  async (req, res) => {
    try {
      const order =
        await Order.findOne({
          orderNumber:
            req.params.id,
        });

      if (!order) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Order not found",
          });
      }

      // Optional ownership protection:
      // customer users should not be able to access another customer's order.
      if (
        order.customerId &&
        order.customerId.toString() !==
          req.user.id &&
        req.user.role !== "admin"
      ) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              "You are not authorized to view this order",
          });
      }

      return res.json({
        success: true,
        data: order,
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
// Update status
// ─────────────────────────────────────────────────────────────────────────────

exports.updateStatus =
  async (req, res) => {
    try {
      const { status } =
        req.body;

      if (!status) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Status is required",
          });
      }

      const order =
        await Order.findById(
          req.params.id
        );

      if (!order) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Order not found",
          });
      }

      order.status = status;

      order.statusHistory.push({
        status,
      });

      await order.save();

      return res.json({
        success: true,
        message:
          "Status updated",
        data: order,
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
// Cancel order
// ─────────────────────────────────────────────────────────────────────────────

exports.cancelOrder =
  async (req, res) => {
    try {
      const order =
        await Order.findOne({
          orderNumber:
            req.params.id,
        });

      if (!order) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Order not found",
          });
      }

      if (
        order.customerId.toString() !==
        req.user.id
      ) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              "You are not authorized to cancel this order",
          });
      }

      if (
        order.status ===
        "cancelled"
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "This order has already been cancelled",
          });
      }

      if (
        order.status ===
        "delivered"
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Delivered orders cannot be cancelled",
          });
      }

      if (
        PICKUP_STARTED_STATUSES.includes(
          order.status
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "This order is already picked up or in process. Please contact support to cancel it.",
          });
      }

      // Stop self-cancellation once dispatch grouping has started.
      if (
        !ALLOW_MID_PIPELINE_CANCELLATION &&
        order.dispatchStatus &&
        order.dispatchStatus !==
          "awaiting_slot"
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              order.dispatchStatus ===
              "assigned"
                ? "A rider has already been assigned to pick up this order. Please contact support to cancel it."
                : "This order is currently being matched with a rider. Please contact support to cancel it.",
          });
      }

      const placedAt =
        new Date(
          order.createdAt
        ).getTime();

      const withinFreeWindow =
        Date.now() -
          placedAt <=
        FREE_CANCELLATION_WINDOW_MS;

      const cancellationFee =
        withinFreeWindow
          ? 0
          : Math.min(
              LATE_CANCELLATION_FEE,
              order.totalAmount
            );

      const wasPaid =
        order.paymentStatus ===
        "paid";

      const refundAmount =
        wasPaid
          ? Math.max(
              order.totalAmount -
                cancellationFee,
              0
            )
          : 0;

      const refundMode =
        refundAmount > 0
          ? "wallet_credit"
          : "none";

      order.status =
        "cancelled";

      order.statusHistory.push({
        status: "cancelled",

        note:
          withinFreeWindow
            ? "Cancelled by customer within the free-cancellation window"
            : `Cancelled by customer after the free-cancellation window (₹${cancellationFee} fee applied)`,
      });

      order.cancellation = {
        cancelledAt:
          new Date(),

        cancelledBy:
          "customer",

        isFreeCancellation:
          withinFreeWindow,

        cancellationFee,

        refundAmount,

        refundMode,

        refundStatus:
          refundAmount > 0
            ? "completed"
            : "not_applicable",
      };

      await order.save();

      // Clean up dispatch data.
      try {
        await handleOrderCancellation(
          order
        );
      } catch (
        dispatchError
      ) {
        console.error(
          `[CancelOrder] Dispatch cleanup failed for ${order.orderNumber}. The order remains cancelled:`,
          dispatchError
        );
      }

      let walletBalance =
        null;

      let walletCreditFailed =
        false;

      if (refundAmount > 0) {
        try {
          const customer =
            await Customer.findOne(
              {
                accountId:
                  order.customerId,
              }
            );

          if (!customer) {
            walletCreditFailed =
              true;

            console.error(
              `[CancelOrder] Customer profile not found for account ${order.customerId}`
            );
          } else {
            const wallet =
              await Wallet.findOneAndUpdate(
                {
                  customerId:
                    customer._id,
                },

                {
                  $setOnInsert: {
                    customerId:
                      customer._id,
                  },

                  $inc: {
                    balance:
                      refundAmount,
                  },

                  $push: {
                    transactions: {
                      type: "refund",

                      amount:
                        refundAmount,

                      reason:
                        withinFreeWindow
                          ? `Refund for cancelled order ${order.orderNumber}`
                          : `Refund for cancelled order ${order.orderNumber} after ₹${cancellationFee} cancellation fee`,

                      orderId:
                        order._id,

                      orderNumber:
                        order.orderNumber,
                    },
                  },
                },

                {
                  upsert: true,
                  new: true,
                  setDefaultsOnInsert:
                    true,
                }
              );

            walletBalance =
              wallet.balance;
          }
        } catch (
          walletError
        ) {
          console.error(
            `[CancelOrder] Wallet credit failed for ${order.orderNumber}:`,
            walletError
          );

          walletCreditFailed =
            true;
        }
      }

      // Update refund status if wallet credit failed.
      if (
        refundAmount > 0 &&
        walletCreditFailed
      ) {
        order.cancellation.refundStatus =
          "processing";

        try {
          await order.save();
        } catch (
          saveError
        ) {
          console.error(
            `[CancelOrder] Failed to update refund status for ${order.orderNumber}:`,
            saveError
          );
        }
      }

      // Customer cancellation notification.
      try {
        await notifyCustomer(
          order.customerId,
          {
            title:
              "Order Cancelled",

            body:
              cancellationFee >
              0
                ? `Your order #${order.orderNumber} was cancelled. A ₹${cancellationFee} cancellation fee was applied.`
                : `Your order #${order.orderNumber} was cancelled free of charge.`,

            type:
              "order_cancelled",

            orderId:
              order._id,

            orderNumber:
              order.orderNumber,
          }
        );

        console.log(
          `[CancelOrder] Customer notification sent for ${order.orderNumber}`
        );
      } catch (
        notificationError
      ) {
        console.error(
          `[CancelOrder] Customer notification failed for ${order.orderNumber}:`,
          notificationError
        );
      }

      return res.json({
        success: true,

        message:
          withinFreeWindow
            ? "Order cancelled free of charge"
            : `Order cancelled. A ₹${cancellationFee} late cancellation fee was applied`,

        data: {
          orderNumber:
            order.orderNumber,

          status:
            order.status,

          isFreeCancellation:
            withinFreeWindow,

          cancellationFee,

          refundAmount,

          refundMode,

          refundStatus:
            walletCreditFailed
              ? "processing"
              : order
                  .cancellation
                  .refundStatus,

          walletBalance,

          walletCreditFailed,
        },
      });
    } catch (error) {
      console.error(
        "[CancelOrder] Error:",
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