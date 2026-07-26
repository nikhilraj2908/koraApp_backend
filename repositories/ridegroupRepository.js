const RideGroup = require("../models/RideGroup");

async function createRideGroup({ pickupSlot, pickupDate, orderIds, totalClothQuantity }) {
  return RideGroup.create({
    pickupSlot,
    pickupDate,
    orderIds,
    totalClothQuantity,
  });
}

module.exports = { createRideGroup };