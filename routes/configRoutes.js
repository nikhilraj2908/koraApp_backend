const express = require("express");
const router = express.Router();

const { protect, restrictTo } = require("../middleware/auth");
const { getDispatchConfig, updateDispatchConfig } = require("../controllers/configController");

router.get("/", protect, restrictTo("admin"), getDispatchConfig);
router.patch("/", protect, restrictTo("admin"), updateDispatchConfig);

module.exports = router;