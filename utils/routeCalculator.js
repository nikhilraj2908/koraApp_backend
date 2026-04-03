const axios = require('axios');

const getDistanceAndDuration = async (origin, destination) => {
  const [lon1, lat1] = origin.coordinates;
  const [lon2, lat2] = destination.coordinates;
  const url = `${process.env.OSRM_URL}/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
  const res = await axios.get(url);
  const data = res.data.routes[0];
  return { distance: data.distance, duration: data.duration }; // meters, seconds
};

module.exports = { getDistanceAndDuration };