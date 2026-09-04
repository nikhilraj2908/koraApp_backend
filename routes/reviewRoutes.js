const express = require("express");
const router = express.Router();
const { protect, restrictTo } = require("../middleware/auth");

const {
  submitReview,
  getMyReview,
  updateReview,
  getAllReviews,
  getReviewStats,
  deleteReview,
} = require("../controllers/reviewController");

// Customer routes
router.post("/", protect, submitReview);
router.get("/my", protect, getMyReview);
router.patch("/my", protect, updateReview);

// Admin routes
router.get("/all", protect, restrictTo("admin", "subadmin"), getAllReviews);
router.get("/stats", protect, restrictTo("admin", "subadmin"), getReviewStats);
router.delete("/:id", protect, restrictTo("admin"), deleteReview);

module.exports = router;