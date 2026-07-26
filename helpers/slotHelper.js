/**
 * helpers/slotHelper.js
 *
 * Determines which pickup slot (and calendar date) a new booking falls
 * into, per the exact rule given:
 *
 *   - Booking DURING the morning slot window       -> Today's Evening slot
 *       e.g. booked 09:30 AM (morning window 07:00-10:00) -> Today Evening
 *   - Booking AFTER the morning slot window ends    -> Tomorrow's Morning slot
 *       e.g. booked 02:15 PM -> Tomorrow Morning
 *       e.g. booked 08:30 PM -> Tomorrow Morning
 *
 * ASSUMPTION (not explicitly covered by the given examples): a booking
 * placed BEFORE the morning slot opens (e.g. 3:00 AM) is assigned to
 * TODAY's morning slot, since that slot hasn't started/been dispatched
 * yet and there's no reason to delay it further. This is the one branch
 * not literally spelled out in the spec — flag if you intended something
 * different (e.g. always pushing pre-dawn bookings to today's evening
 * instead) and this is a one-line change below.
 */

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const { getConfig } = require("../repositories/configRepository");
const { PICKUP_SLOTS } = require("../constants/dispatchConstants");

/**
 * @param {Date} bookingTime - defaults to now
 * @returns {Promise<{ pickupSlot: "MORNING"|"EVENING", pickupDate: Date }>}
 */
async function resolvePickupSlot(bookingTime = new Date()) {
  const config = await getConfig();
  const tz = config.timezone;

  const booking = dayjs(bookingTime).tz(tz);
  const morningStart = parseTimeOnDay(booking, config.slots.MORNING.start);
  const morningEnd = parseTimeOnDay(booking, config.slots.MORNING.end);

  let pickupSlot;
  let pickupDay;

  if (booking.isBefore(morningStart)) {
    // Before the morning window opens today — see ASSUMPTION above.
    pickupSlot = PICKUP_SLOTS.MORNING;
    pickupDay = booking; // today
  } else if (booking.isBefore(morningEnd)) {
    // Squarely inside the morning window.
    pickupSlot = PICKUP_SLOTS.EVENING;
    pickupDay = booking; // today
  } else {
    // Anytime from morning-end onward — afternoon, the evening window
    // itself, or overnight. All bumped to tomorrow morning per spec.
    pickupSlot = PICKUP_SLOTS.MORNING;
    pickupDay = booking.add(1, "day");
  }

  return {
    pickupSlot,
    pickupDate: pickupDay.startOf("day").toDate(),
  };
}

/**
 * Builds a dayjs instant for "HH:mm" on the same calendar day as `day`.
 */
function parseTimeOnDay(day, hhmm) {
  const [hour, minute] = hhmm.split(":").map(Number);
  return day.hour(hour).minute(minute).second(0).millisecond(0);
}

/**
 * Returns the [start, end] Date range (in the dispatch timezone) for a
 * given slot on a given calendar date — used by the scheduler to query
 * "was this order booked within today's morning window" style checks,
 * and by anything that needs the slot's actual clock boundaries.
 */
async function getSlotWindow(pickupSlot, pickupDate) {
  const config = await getConfig();
  const tz = config.timezone;
  const day = dayjs(pickupDate).tz(tz).startOf("day");

  const slotConfig = config.slots[pickupSlot];
  if (!slotConfig) {
    throw new Error(`Unknown pickup slot: ${pickupSlot}`);
  }

  return {
    start: parseTimeOnDay(day, slotConfig.start).toDate(),
    end: parseTimeOnDay(day, slotConfig.end).toDate(),
  };
}

module.exports = { resolvePickupSlot, getSlotWindow };