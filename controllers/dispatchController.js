const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const { runGroupingForSlot } = require("../services/groupingService");
const { getConfig } = require("../repositories/configRepository");
const { getSlotWindow } = require("../helpers/slotHelper");

/**
 * POST /api/dispatch/group/trigger
 * Body: { pickupSlot: "MORNING" | "EVENING", pickupDate?: "YYYY-MM-DD" }
 *
 * Admin-only manual trigger — lets you test the grouping pipeline
 * end-to-end right now, without waiting for Phase 4's automatic cron
 * scheduler to exist. The scheduler job (Phase 4) will call
 * runGroupingForSlot() directly rather than going through this HTTP
 * endpoint; this route stays afterward too, as a genuinely useful "force
 * re-run this slot's grouping" admin tool (e.g. if a scheduler run
 * crashed partway and left orders claimed-but-ungrouped).
 */
exports.triggerGrouping = async (req, res) => {
  try {
    const { pickupSlot, pickupDate } = req.body;

    if (!["MORNING", "EVENING"].includes(pickupSlot)) {
      return res.status(400).json({
        success: false,
        message: 'pickupSlot must be "MORNING" or "EVENING"',
      });
    }

    const config = await getConfig();
    const targetDate = pickupDate
      ? dayjs.tz(pickupDate, config.timezone).startOf("day").toDate()
      : dayjs().tz(config.timezone).startOf("day").toDate();

    const groups = await runGroupingForSlot(pickupSlot, targetDate);

    res.json({
      success: true,
      message: `Grouping run complete: ${groups.length} group(s) created.`,
      data: groups,
    });
  } catch (err) {
    console.error("[Dispatch] Manual grouping trigger failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/dispatch/group/preview?pickupSlot=MORNING&pickupDate=YYYY-MM-DD
 * Read-only — shows the current slot window and how many orders are
 * currently pending for it, without claiming/grouping anything. Useful
 * for sanity-checking before firing the real trigger above.
 */
exports.previewSlot = async (req, res) => {
  try {
    const { pickupSlot, pickupDate } = req.query;

    if (!["MORNING", "EVENING"].includes(pickupSlot)) {
      return res.status(400).json({
        success: false,
        message: 'pickupSlot must be "MORNING" or "EVENING"',
      });
    }

    const config = await getConfig();
    const targetDate = pickupDate
      ? dayjs.tz(pickupDate, config.timezone).startOf("day").toDate()
      : dayjs().tz(config.timezone).startOf("day").toDate();

    const window = await getSlotWindow(pickupSlot, targetDate);
    const orderRepository = require("../repositories/orderRepository");
    const pending = await orderRepository.findPendingOrdersForSlot(pickupSlot, targetDate);

    res.json({
      success: true,
      data: {
        pickupSlot,
        pickupDate: targetDate,
        window,
        pendingOrderCount: pending.length,
        groupable: pending.filter((o) => o.pickupLocation?.coordinates?.length === 2).length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};