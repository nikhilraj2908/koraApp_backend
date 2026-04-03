const axios = require('axios');

const geocode = async (address) => {
  const response = await axios.get(`${process.env.NOMINATIM_URL}/search`, {
    params: { q: address, format: 'json', limit: 1 }
  });
  if (response.data.length) {
    const { lat, lon } = response.data[0];
    return { coordinates: [parseFloat(lon), parseFloat(lat)], address: response.data[0].display_name };
  }
  throw new Error('Location not found');
};

module.exports = geocode;