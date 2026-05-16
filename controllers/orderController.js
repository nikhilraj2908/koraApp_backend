const Order = require("../models/Order");


// Create Order
exports.createOrder = async (req, res) => {
  try {

    const customerId = req.user.id;

    const {
      items,
      pickupAddress,
      deliveryAddress,
      paymentMethod
    } = req.body;

    let subtotal = 0;

    items.forEach(item => {
      subtotal += item.quantity * item.price;
    });

    const tax = subtotal * 0.05;
    const discount = 0;

    const totalAmount =
      subtotal +
      tax -
      discount;

    const orderCount =
      await Order.countDocuments();

    const orderNumber =
      `KR-${1000 + orderCount + 1}`;

    const order =
      await Order.create({

        customerId,
        orderNumber,
        items,
        subtotal,
        tax,
        discount,
        totalAmount,
        pickupAddress,
        deliveryAddress,
        paymentMethod,
        statusHistory: [
          {
            status: "pending_sp"
          }
        ]

      });

    res.status(201).json({

      success: true,
      message: "Order created",
      data: order

    });

  }
  catch (error) {

    res.status(500).json({

      success: false,
      message: error.message

    });

  }
};




// Active order

exports.getActiveOrder = async (
  req,
  res
) => {

  try {

    const customerId = req.user.id;

    const activeOrder =
      await Order.findOne({

        customerId,

        status: {
          $nin: [
            "delivered",
            "cancelled"
          ]
        }

      })
        .sort({
          createdAt: -1
        });

    res.json({

      success: true,
      data: activeOrder

    });

  }
  catch (error) {

    res.status(500).json({

      success: false,
      message: error.message

    });

  }

};




// Recent orders

exports.getRecentOrders =
  async (req, res) => {

    try {

      const customerId =
        req.user.id;

      const orders =
        await Order.find({

          customerId

        })

          .sort({
            createdAt: -1
          })

          .limit(10);

      res.json({

        success: true,
        data: orders

      });

    }
    catch (error) {

      res.status(500).json({

        success: false,
        message: error.message

      });

    }

  };




// Order details

exports.getOrderDetails =
  async (req, res) => {

    try {

      const order =
        await Order.findById(
          req.params.id
        );

      if (!order) {

        return res.status(404)
          .json({

            success: false,
            message:
              "Order not found"

          });

      }

      res.json({

        success: true,
        data: order

      });

    }
    catch (error) {

      res.status(500)
        .json({

          success: false,
          message: error.message

        });

    }

  };




// Update status

exports.updateStatus =
  async (req, res) => {

    try {

      const { status } =
        req.body;

      const order =
        await Order.findById(
          req.params.id
        );

      if (!order) {

        return res.status(404)
          .json({

            success: false,
            message: "Order not found"

          });

      }

      order.status = status;

      order.statusHistory.push({

        status

      });

      await order.save();

      res.json({

        success: true,
        message:
          "Status updated"

      });

    }
    catch (error) {

      res.status(500)
        .json({

          success: false,
          message: error.message

        });

    }

  };