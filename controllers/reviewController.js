const Review = require("../models/Review");
const Order = require("../models/Order");

// ─────────────────────────────────────────────
// POST /api/reviews
// Submit a review (logged in customer only)
// ─────────────────────────────────────────────s
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
      const order = await Order.findOne({ _id: orderId, customerId });
      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }
    }

    // Check: customer ne already ek review diya hua hai to wo hi return karo
    const existing = await Review.findOne({ customerId });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "You have already submitted a review",
        alreadyReviewed: true,
        data: existing,
      });
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
// Get logged-in customer's own review
// ─────────────────────────────────────────────
exports.getMyReview = async (req, res) => {
  try {
    const customerId = req.user.id;

    const review = await Review.findOne({ customerId })
      .populate("orderId", "orderNumber totalAmount createdAt");

    if (!review) {
      return res.status(200).json({
        success: true,
        data: null,
        hasReviewed: false,
      });
    }

    res.json({
      success: true,
      data: review,
      hasReviewed: true,
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
// ─────────────────────────────────────────────
exports.getAllReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ isVisible: true })
      .sort({ createdAt: -1 })
      .populate("customerId", "name email mobile")
      .populate("orderId", "orderNumber totalAmount createdAt");

    res.json({ success: true, data: reviews });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ─────────────────────────────────────────────
// GET /api/reviews/stats  (Admin)
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

    const distribution = await Review.aggregate([
      { $group: { _id: "$overallRating", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]);

    res.json({ success: true, data: { summary: stats[0] || {}, distribution } });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ─────────────────────────────────────────────
// DELETE /api/reviews/:id  (Admin)
// ─────────────────────────────────────────────
exports.deleteReview = async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ success: false, message: "Review not found" });
    }
    review.isVisible = false;
    await review.save();
    res.json({ success: true, message: "Review hidden successfully" });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
