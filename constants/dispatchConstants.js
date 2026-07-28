/**
 * constants/dispatchConstants.js
 *
 * Single source of truth for every "magic number" in the pickup dispatch
 * system. Nothing in services/jobs should hardcode a slot time, price, or
 * radius directly — they all read through models/Configuration.js, which
 * is seeded from DEFAULT_CONFIG below on first boot and can be edited by
 * an admin at runtime without a redeploy or code change.
 */

// ── Pickup slots ────────────────────────────────────────────────
// Times are in 24-hour "HH:mm" format, interpreted in SLOT_TIMEZONE.
const PICKUP_SLOTS = {
  MORNING: "MORNING",
  EVENING: "EVENING",
};

const DEFAULT_CONFIG = {
  timezone: "Asia/Kolkata",

  slots: {
    MORNING: { start: "07:00", end: "10:00" },
    EVENING: { start: "18:00", end: "21:00" },
  },

  grouping: {
    maxGroupSize: 3,
    // Radius used when clustering nearby pending orders together, in km.
    clusterRadiusKm: 3,
  },

  riderDiscovery: {
    // Radius used when searching for nearby available riders, in km.
    radiusKm: 5,
  },

  pricing: {
    startingOffer: 50,
    maxOffer: 60,
    increment: 2,
    // Seconds between each price escalation step.
    escalationIntervalSeconds: 15,
    currency: "INR",
  },

  auction: {
    // Seconds each rider effectively has to accept before the price steps
    // up / the offer is considered for the next escalation tick.
    riderResponseWindowSeconds: 60,
  },

  scheduler: {
    // Simple "HH:mm" trigger times, checked every minute against live
    // config (see jobs/slotTriggerJob.js) — NOT raw cron expressions.
    // This matters: a static cron.schedule(expression) bakes the
    // schedule in at boot, so an admin changing it via the config API
    // wouldn't take effect until a restart. Comparing "HH:mm" strings on
    // every tick means a config change takes effect on the very next
    // tick, honoring "configurable without changing source code" fully
    // rather than just for the values, not the timing.
    morningTriggerTime: "07:01",
    eveningTriggerTime: "18:01",
  },

  notificationRetry: {
    maxAttempts: 3,
    backoffSeconds: 10,
  },
};

// ── Ride offer / assignment status enums ───────────────────────
const RIDE_GROUP_STATUS = {
  FORMING: "forming",     // being built by the grouping job
  ROUTED: "routed",       // route optimization complete, ready for offer
  OFFERED: "offered",     // a RideOffer has been created for this group
  ASSIGNED: "assigned",   // a rider has accepted
  EXPIRED: "expired",     // no rider accepted before max payout / retries exhausted
  CANCELLED: "cancelled", // all orders in the group were cancelled
};

const RIDE_OFFER_STATUS = {
  PENDING: "pending",       // actively broadcasting / escalating
  ACCEPTED: "accepted",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
};

const ASSIGNMENT_STATUS = {
  ACTIVE: "active",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

// Order.dispatchStatus — parallel to the existing Order.status field
// (which drives customer-facing tracking). This tracks this order's
// position in the slot/grouping/auction pipeline specifically.
const ORDER_DISPATCH_STATUS = {
  AWAITING_SLOT: "awaiting_slot",   // booked, waiting for its pickup slot to start
  GROUPING: "grouping",             // slot has started, being processed by the scheduler
  GROUPED: "grouped",               // placed into a RideGroup
  OFFER_PENDING: "offer_pending",   // RideGroup's offer is live/auctioning
  ASSIGNED: "assigned",             // a rider accepted the group containing this order
  CANCELLED: "cancelled",
};

const NOTIFICATION_LOG_STATUS = {
  SENT: "sent",
  FAILED: "failed",
  RETRYING: "retrying",
};

// ── Cancellation policy toggle ──────────────────────────────────
// Decision point: once an order enters the dispatch pipeline (past
// "awaiting_slot"), should a customer still be able to self-cancel?
//
// false (current, chosen deliberately): NO — cancelOrder blocks it and
// tells the customer to contact support. Simple and safe: no live
// re-routing, no re-negotiating a rider's already-accepted price, no
// risk of surprising a rider mid-trip. services/dispatchCancellationService.js's
// re-route/re-offer/notify-rider logic is fully built and tested-ready,
// but sits dormant while this is false — controllers/orderController.js's
// cancelOrder returns a 400 before ever reaching it.
//
// true: YES — self-cancellation stays open through GROUPED/OFFER_PENDING
// (re-routes and re-offers the remaining orders in that group) and even
// ASSIGNED (notifies the committed rider, releases them if that was
// their only remaining pickup). Flip this only after you've watched the
// auction system behave correctly under real load — this activates real
// re-optimization and re-broadcast logic, not just a bigger no-op.
const ALLOW_MID_PIPELINE_CANCELLATION = false;

module.exports = {
  ALLOW_MID_PIPELINE_CANCELLATION,
  PICKUP_SLOTS,
  DEFAULT_CONFIG,
  RIDE_GROUP_STATUS,
  RIDE_OFFER_STATUS,
  ASSIGNMENT_STATUS,
  ORDER_DISPATCH_STATUS,
  NOTIFICATION_LOG_STATUS,
};