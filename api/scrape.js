const SERP_API_KEY = process.env.SERP_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'planebiz-a11y/ksl-deal-finder';
const LISTINGS_PATH = 'public/listings.json';

// Surgical queries targeting only individual listing pages
const SEARCHES = [
  { query: 'site:classifieds.ksl.com/listing skid steer used -rent -rental', type: 'skid_steer' },
  { query: 'site:classifieds.ksl.com/listing mini excavator used -rent -rental', type: 'mini_excavator' },
  { query: 'site:classifieds.ksl.com/listing utility trailer used -rent -rental', type: 'trailer' },
];

const MAKES = ['Caterpillar','CAT','John Deere','Deere','Bobcat','Kubota','Case','Takeuchi','Yanmar','Komatsu','Volvo','Hitachi','Doosan','Hyundai','New Holland','Gehl','Mustang','JCB','Wacker Neuson','LiuGong','Big Tex','PJ','Load Trail','Maxx-D','Diamond C','Sure-Trac','Kaufman'];

function parseSnippet(title, snippet, type) {
  const text = `${title} ${snippet}`;
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : null;
  const priceMatch = text.match(/\$([0-9,]+)/);
  const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
  const hoursMatch = type !== 'trailer' ? text.match(/(\d[\d,]*)\s*(hours?|hrs?)\b/i) : null;
  const hours = hoursMatch ? parseInt(hoursMatch[1].replace(/,/g, '')) : null;
  const textLower = text.toLowerCase();
  let make = null;
  for (const m of MAKES) {
    if (textLower.includes(m.toLowerCase())) { make = m; break; }
  }
  return { year, price, hours, make };
}

async function fetchListings(searchObj, params) {
  const { query, type } = searchObj;

  // Build query with optional price/year hints
  let q = query;
  if (params.keyword) q += ` ${params.keyword}`;
  if (params.yearMin || params.yearMax) {
    if (params.yearMin && params.yearMax) q += ` ${params.yearMin}..${params.yearMax}`;
    else if (params.yearMin) q += ` after:${params.yearMin}`;
  }

  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&api_key=${SERP_API_KEY}&num=20&gl=us&hl=en&no_cache=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpAPI error: ${res.status}`);
  const data = await res.json();

  const results = data.organic_results || [];
  const listings = [];

  for (const r of results) {
    // Only keep actual individual listing URLs
    if (!r.link || !r.link.match(/classifieds\.ksl\.com\/listing\/\d+/)) continue;

    const { year, price, hours, make } = parseSnippet(r.title || '', r.snippet || '', type);

    // Skip if no price found
    if (!price) continue;

    // Skip rentals
    const text = `${r.title} ${r.snippet}`.toLowerCase();
    if (text.includes('rent') || text.includes('/day') || text.includes('per day')) continue;

    // Apply filters
    if (params.priceMin && price < parseInt(params.priceMin)) continue;
    if (params.priceMax && price > parseInt(params.priceMax)) continue;
    if (params.yearMin && year && parseInt(year) < parseInt(params.yearMin)) continue;
    if (params.yearMax && year && parseInt(year) > parseInt(params.yearMax)) continue;
    if (params.hoursMax && hours && hours > parseInt(params.hoursMax)) continue;

    listings.push({
      id: r.link, type,
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      source: 'ksl',
      year, price, hours, make, model: null,
      scrapedAt: new Date().toISOString(),
    });
  }

  return listings;
}

async function getExistingFile() {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${LISTINGS_PATH}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
  });
  if (!res.ok) return { listings: [], sha: null };
  const data = await res.json();
  const content = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  return { listings: content, sha: data.sha };
}

async function commitListings(listings, sha) {
  const content = Buffer.from(JSON.stringify(listings, null, 2)).toString('base64');
  const body = { message: `Update listings ${new Date().toISOString()}`, content };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${LISTINGS_PATH}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`GitHub commit failed: ${res.status}`);
  return true;
}

module.exports = async function handler(req, res) {
  try {
    const params = req.query || {};
    if (params.types) params.types = params.types.split(',');

    const activeSearches = params.types && params.types.length > 0
      ? SEARCHES.filter(s => params.types.includes(s.type))
      : SEARCHES;

    const allListings = [];
    for (const search of activeSearches) {
      try {
        const listings = await fetchListings(search, params);
        console.log(`Got ${listings.length} from: ${search.query}`);
        allListings.push(...listings);
      } catch (err) {
        console.error(`Failed: ${search.query}`, err.message);
      }
    }

    const seen = new Set();
    const deduped = allListings.filter(l => {
      if (seen.has(l.url)) return false;
      seen.add(l.url); return true;
    });

    const { listings: existing, sha } = await getExistingFile();
    const existingMap = new Map(existing.map(l => [l.url, l]));
    for (const l of deduped) existingMap.set(l.url, l);
    const merged = Array.from(existingMap.values())
      .sort((a, b) => new Date(b.scrapedAt) - new Date(a.scrapedAt))
      .slice(0, 500);

    await commitListings(merged, sha);
    return res.status(200).json({ success: true, fetched: deduped.length, total: merged.length, lastRun: new Date().toISOString() });
  } catch (err) {
    console.error('Scrape failed:', err);
    return res.status(500).json({ error: err.message });
  }
};
