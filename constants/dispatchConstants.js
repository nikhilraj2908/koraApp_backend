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
    // Cron expressions (node-cron syntax). Should normally match the
    // slot start times above, but kept separate so the trigger job can
    // run slightly after slot start without changing the slot window
    // customers see.
    morningTriggerCron: "1 7 * * *",  // 07:01 every day
    eveningTriggerCron: "1 18 * * *", // 18:01 every day
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

module.exports = {
  PICKUP_SLOTS,
  DEFAULT_CONFIG,
  RIDE_GROUP_STATUS,
  RIDE_OFFER_STATUS,
  ASSIGNMENT_STATUS,
  ORDER_DISPATCH_STATUS,
  NOTIFICATION_LOG_STATUS,
};