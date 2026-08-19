const cron = require('node-cron');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const { getConfig } = require('../repositories/configRepository');
const { runGroupingForSlot } = require('../services/groupingService');
const RideGroup = require('../models/RideGroup');
const { RIDE_GROUP_STATUS } = require('../constants/dispatchConstants');

let started = false;

async function runScheduledDispatch() {
  const config = await getConfig();
  const now = dayjs().tz(config.timezone);
  const currentTime = now.format('HH:mm');
  const pickupDate = now.startOf('day').toDate();

  if (currentTime === config.scheduler.morningTriggerTime) await runGroupingForSlot('MORNING', pickupDate);
  if (currentTime === config.scheduler.eveningTriggerTime) await runGroupingForSlot('EVENING', pickupDate);

  const routedGroups = await RideGroup.find({ status: RIDE_GROUP_STATUS.ROUTED }, { _id: 1 }).lean();
  if (routedGroups.length) {
    const { createOfferForGroup } = require('../services/auctionService');
    await Promise.all(routedGroups.map(({ _id }) => createOfferForGroup(_id)));
  }
}

const startCronJobs = () => {
  if (started) return;
  started = true;
  cron.schedule('* * * * *', () => {
    runScheduledDispatch().catch((err) => console.error('[Dispatch] Scheduled dispatch failed:', err.message));
  });
  console.log('Dispatch scheduler started.');
};

module.exports = { startCronJobs, runScheduledDispatch };
