// api/listings.js
const REDIS_URL = process.env.REDIS_URL;

module.exports = async function handler(req, res) {
  try {
    const kvRes = await fetch(`${REDIS_URL}/get/listings`);
    if (!kvRes.ok) return res.status(200).json([]);
    const data = await kvRes.json();
    if (!data.result) return res.status(200).json([]);
    
    // Result may be URL-encoded string or already parsed
    let listings;
    try {
      const decoded = decodeURIComponent(data.result);
      listings = JSON.parse(decoded);
    } catch (_) {
      try {
        listings = JSON.parse(data.result);
      } catch (_) {
        listings = [];
      }
    }
    
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(listings);
  } catch (err) {
    console.error('Listings fetch failed:', err);
    return res.status(200).json([]);
  }
};
