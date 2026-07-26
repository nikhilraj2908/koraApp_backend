const express = require("express");
const router = express.Router();

const { riderProtect, restrictTo } = require("../middleware/auth");
const { getMyOffers, accept } = require("../controllers/rideOfferController");

router.get("/mine", riderProtect, restrictTo("rider"), getMyOffers);
router.post("/:id/accept", riderProtect, restrictTo("rider"), accept);

module.exports = router;