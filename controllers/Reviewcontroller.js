const Review = require("../models/Review");
const Order = require("../models/Order");

// ─────────────────────────────────────────────
// POST /api/reviews
// Submit a review
// ─────────────────────────────────────────────
exports.submitReview = async (req, res) => {
  try {
    const customerId = req.user.id;

    const {
      orderId,
      overallRating,
      categoryRatings,
      tags,
      review,
    } = req.body;

    // Validate overall rating
    if (!overallRating || overallRating < 1 || overallRating > 5) {
      return res.status(400).json({
        success: false,
        message: "Overall rating is required and must be between 1 and 5",
      });
    }

    // If orderId provided, verify it belongs to this customer
    if (orderId) {
      const order = await Order.findOne({
        _id: orderId,
        customerId,
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      // Prevent duplicate review for same order
      const existing = await Review.findOne({ customerId, orderId });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: "You have already reviewed this order",
        });
      }
    }

    const newReview = await Review.create({
      customerId,
      orderId: orderId || null,
      overallRating,
      categoryRatings: categoryRatings || {},
      tags: tags || [],
      review: review || "",
    });

    res.status(201).json({
      success: true,
      message: "Review submitted successfully",
      data: newReview,
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


// ─────────────────────────────────────────────
// GET /api/reviews/my
// Get all reviews by logged-in customer
// ─────────────────────────────────────────────
exports.getMyReviews = async (req, res) => {
  try {
    const customerId = req.user.id;

    const reviews = await Review.find({ customerId })
      .sort({ createdAt: -1 })
      .populate("orderId", "orderNumber totalAmount createdAt");

    res.json({
      success: true,
      data: reviews,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


// ─────────────────────────────────────────────
// GET /api/reviews/all  (Admin)
// Get all reviews with customer info
// ─────────────────────────────────────────────
exports.getAllReviews = async (req, res) => {
  try {
    const reviews = await Review.find()
      .sort({ createdAt: -1 })
      .populate("customerId", "name email mobile")
      .populate("orderId", "orderNumber totalAmount createdAt");

    res.json({
      success: true,
      data: reviews,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


// ─────────────────────────────────────────────
// GET /api/reviews/stats  (Admin)
// Get overall rating stats
// ─────────────────────────────────────────────
exports.getReviewStats = async (req, res) => {
  try {
    const stats = await Review.aggregate([
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          avgOverall: { $avg: "$overallRating" },
          avgPickup: { $avg: "$categoryRatings.pickup" },
          avgQuality: { $avg: "$categoryRatings.quality" },
          avgDelivery: { $avg: "$categoryRatings.delivery" },
          avgPackaging: { $avg: "$categoryRatings.packaging" },
        },
      },
      {
        $project: {
          _id: 0,
          totalReviews: 1,
          avgOverall: { $round: ["$avgOverall", 1] },
          avgPickup: { $round: ["$avgPickup", 1] },
          avgQuality: { $round: ["$avgQuality", 1] },
          avgDelivery: { $round: ["$avgDelivery", 1] },
          avgPackaging: { $round: ["$avgPackaging", 1] },
        },
      },
    ]);

    // Rating distribution (1★ to 5★)
    const distribution = await Review.aggregate([
      {
        $group: {
          _id: "$overallRating",
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
    ]);

    res.json({
      success: true,
      data: {
        summary: stats[0] || {},
        distribution,
      },
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


// ─────────────────────────────────────────────
// DELETE /api/reviews/:id  (Admin)
// Hide/delete a review
// ─────────────────────────────────────────────
exports.deleteReview = async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    review.isVisible = false;
    await review.save();

    res.json({
      success: true,
      message: "Review hidden successfully",
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};