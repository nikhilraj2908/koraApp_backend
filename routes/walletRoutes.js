const express = require("express");
const router = express.Router();

const { getWallet } = require("../controllers/walletController");
const { protect, restrictTo } = require("../middleware/auth");

// GET /api/wallet — balance + transaction history (customer only)
router.get("/", protect, restrictTo("customer"), getWallet);

module.exports = router;