// api/scrape.js
// Runs on Vercel serverless — triggered by cron every 4 hours

const SERP_API_KEY = process.env.SERP_API_KEY;
const LISTINGS_PATH = './public/listings.json';
const fs = require('fs');
const path = require('path');

const SEARCHES = [
  { query: 'skid steer for sale site:ksl.com', type: 'skid_steer', hasHours: true },
  { query: 'mini excavator for sale site:ksl.com', type: 'mini_excavator', hasHours: true },
  { query: 'trailer for sale site:ksl.com', type: 'trailer', hasHours: false },
];

// Extract year, make, model, hours, price from snippet text
function parseSnippet(snippet, title, type) {
  const text = `${title} ${snippet}`;

  // Year: 4-digit number starting with 19 or 20
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : null;

  // Price: $X,XXX or $XX,XXX
  const priceMatch = text.match(/\$[\d,]+/);
  const price = priceMatch ? parseInt(priceMatch[0].replace(/[$,]/g, '')) : null;

  // Hours: number followed by "hours", "hrs", "hr"
  const hoursMatch = type !== 'trailer'
    ? text.match(/(\d[\d,]*)\s*(hours?|hrs?)\b/i)
    : null;
  const hours = hoursMatch ? parseInt(hoursMatch[1].replace(/,/g, '')) : null;

  // Make/model: common brands
  const makes = [
    'Caterpillar', 'CAT', 'John Deere', 'Deere', 'Bobcat', 'Kubota',
    'Case', 'Takeuchi', 'Yanmar', 'Komatsu', 'Volvo', 'Hitachi',
    'Doosan', 'Hyundai', 'New Holland', 'Gehl', 'Mustang', 'JCB',
    'Wacker Neuson', 'LiuGong', 'Big Tex', 'PJ', 'Load Trail',
    'Maxx-D', 'Diamond C', 'Sure-Trac', 'Kaufman'
  ];
  let make = null;
  for (const m of makes) {
    if (text.toLowerCase().includes(m.toLowerCase())) {
      make = m;
      break;
    }
  }

  // Model: word after make, or first all-caps/number combo
  let model = null;
  if (make) {
    const makeIdx = text.toLowerCase().indexOf(make.toLowerCase());
    const afterMake = text.slice(makeIdx + make.length).trim();
    const modelMatch = afterMake.match(/^[\s-]*([A-Z0-9][\w-]{1,12})/);
    if (modelMatch) model = modelMatch[1];
  }

  return { year, price, hours, make, model };
}

async function fetchListings(searchObj) {
  const { query, type, hasHours } = searchObj;
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}&num=20&gl=us&hl=en`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpAPI error: ${res.status}`);
  const data = await res.json();

  const results = data.organic_results || [];
  return results.map(r => {
    const parsed = parseSnippet(r.snippet || '', r.title || '', type);
    return {
      id: r.link,
      type,
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      source: 'ksl',
      ...parsed,
      scrapedAt: new Date().toISOString(),
    };
  }).filter(r => r.url && r.url.includes('ksl.com'));
}

module.exports = async function handler(req, res) {
  // Allow cron and manual trigger
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const allListings = [];
    for (const search of SEARCHES) {
      try {
        const listings = await fetchListings(search);
        allListings.push(...listings);
        console.log(`Fetched ${listings.length} results for: ${search.query}`);
      } catch (err) {
        console.error(`Failed search: ${search.query}`, err.message);
      }
    }

    // Deduplicate by URL
    const seen = new Set();
    const deduped = allListings.filter(l => {
      if (seen.has(l.url)) return false;
      seen.add(l.url);
      return true;
    });

    // Load existing listings to merge/preserve history
    const listingsPath = path.join(process.cwd(), 'public', 'listings.json');
    let existing = [];
    try {
      existing = JSON.parse(fs.readFileSync(listingsPath, 'utf8'));
    } catch (_) {}

    // Merge: new listings take precedence, keep up to 500 total
    const existingMap = new Map(existing.map(l => [l.url, l]));
    for (const l of deduped) existingMap.set(l.url, l);
    const merged = Array.from(existingMap.values())
      .sort((a, b) => new Date(b.scrapedAt) - new Date(a.scrapedAt))
      .slice(0, 500);

    fs.writeFileSync(listingsPath, JSON.stringify(merged, null, 2));

    return res.status(200).json({
      success: true,
      fetched: deduped.length,
      total: merged.length,
      lastRun: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Scrape failed:', err);
    return res.status(500).json({ error: err.message });
  }
};
