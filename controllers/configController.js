const { getConfig, updateConfig } = require("../repositories/configRepository");

// GET /api/dispatch/config
exports.getDispatchConfig = async (req, res) => {
  try {
    const config = await getConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/dispatch/config — admin only.
// Accepts a partial update, e.g. { pricing: { maxOffer: 70 } }.
// NOTE: nested objects are replaced wholesale by Mongoose's $set on a
// sub-path, not deep-merged — send the full nested object you want for
// any top-level key you're touching (e.g. the whole `pricing` object,
// not just `{ maxOffer: 70 }` alone at the root).
exports.updateDispatchConfig = async (req, res) => {
  try {
    const allowedKeys = [
      "timezone", "slots", "grouping", "riderDiscovery",
      "pricing", "auction", "scheduler", "notificationRetry",
    ];

    const partialUpdate = {};
    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) partialUpdate[key] = req.body[key];
    }

    if (Object.keys(partialUpdate).length === 0) {
      return res.status(400).json({
        success: false,
        message: `No valid fields provided. Allowed: ${allowedKeys.join(", ")}`,
      });
    }

    const config = await updateConfig(partialUpdate, req.user.id);
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};