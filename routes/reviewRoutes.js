const express = require("express");
const router = express.Router();
const { protect, restrictTo } = require("../middleware/auth");

const {
  submitReview,
  getMyReview,
  getAllReviews,
  getReviewStats,
  deleteReview,
} = require("../controllers/reviewController");

// Customer routes
router.post("/", protect, submitReview);
router.get("/my", protect, getMyReview);

// Admin routes
router.get("/all", protect, restrictTo("admin"), getAllReviews);
router.get("/stats", protect, restrictTo("admin"), getReviewStats);
router.delete("/:id", protect, restrictTo("admin"), deleteReview);

module.exports = router;