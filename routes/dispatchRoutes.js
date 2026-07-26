const express = require("express");
const router = express.Router();

const { protect, restrictTo } = require("../middleware/auth");
const { triggerGrouping, previewSlot } = require("../controllers/dispatchController");

router.get("/group/preview", protect, restrictTo("admin"), previewSlot);
router.post("/group/trigger", protect, restrictTo("admin"), triggerGrouping);

module.exports = router;