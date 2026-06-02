const express = require("express");
const router = express.Router();

const {
  submitReview,
  getMyReviews,
  getAllReviews,
  getReviewStats,
  deleteReview,
} = require("../controllers/reviewController");

const { protect } = require("../middleware/auth");


router.post("/", protect, submitReview);

router.get("/my", protect, getMyReviews);


router.get("/all", protect, getAllReviews);

router.get("/stats", protect, getReviewStats);

router.delete("/:id", protect, deleteReview);

module.exports = router;