// api/listings.js
// Returns listings from Vercel KV (Redis) to the frontend

const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

module.exports = async function handler(req, res) {
  try {
    const kvRes = await fetch(`${KV_REST_API_URL}/get/listings`, {
      headers: { 'Authorization': `Bearer ${KV_REST_API_TOKEN}` },
    });
    if (!kvRes.ok) {
      return res.status(200).json([]);
    }
    const data = await kvRes.json();
    const listings = data.result ? JSON.parse(data.result) : [];
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(listings);
  } catch (err) {
    console.error('Listings fetch failed:', err);
    return res.status(200).json([]);
  }
};
