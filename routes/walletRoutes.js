const express = require("express");
const router = express.Router();

const { getWallet } = require("../controllers/walletController");
const { protect } = require("../middleware/auth");

// GET /api/wallet — balance + transaction history
router.get("/", protect, getWallet);

module.exports = router;