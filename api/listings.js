// api/listings.js
const REDIS_URL = process.env.REDIS_URL;

module.exports = async function handler(req, res) {
  try {
    const kvRes = await fetch(`${REDIS_URL}/get/listings`);
    if (!kvRes.ok) return res.status(200).json([]);
    const data = await kvRes.json();
    const listings = data.result ? JSON.parse(data.result) : [];
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(listings);
  } catch (err) {
    console.error('Listings fetch failed:', err);
    return res.status(200).json([]);
  }
};
