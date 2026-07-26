const RideOffer = require("../models/RideOffer");
const { acceptOffer } = require("../services/auctionService");
const { RIDE_OFFER_STATUS } = require("../constants/dispatchConstants");

/**
 * GET /api/ride-offers/mine
 * Poll-based alternative to the `ride_offer_created` socket event — for
 * a rider whose app just (re)connected, or as a periodic safety-net poll
 * in case a socket event was missed during a brief disconnect.
 */
exports.getMyOffers = async (req, res) => {
  try {
    const riderId = req.rider._id;

    const offers = await RideOffer.find({
      notifiedRiderIds: riderId,
      status: RIDE_OFFER_STATUS.PENDING,
    }).sort({ createdAt: -1 });

    res.json({ success: true, data: offers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/ride-offers/:id/accept
 * REST fallback for accepting an offer — goes through the exact same
 * acceptOffer() service as the socket path, so "only one rider wins"
 * holds regardless of which transport a given rider's client used.
 */
exports.accept = async (req, res) => {
  try {
    const riderId = req.rider._id;
    const { id: rideOfferId } = req.params;

    const result = await acceptOffer(rideOfferId, riderId);

    if (!result.success) {
      return res.status(409).json({ success: false, message: "This offer is no longer available." });
    }

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};