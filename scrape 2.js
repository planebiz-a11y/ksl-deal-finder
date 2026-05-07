const SERP_API_KEY = process.env.SERP_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'planebiz-a11y/ksl-deal-finder';
const LISTINGS_PATH = 'public/listings.json';

const EQUIPMENT_TYPES = {
  skid_steer: 'skid steer',
  mini_excavator: 'mini excavator',
  trailer: 'trailer',
};

function buildQueries(params) {
  const { types, priceMin, priceMax, yearMin, yearMax, keyword } = params;
  const activeTypes = types && types.length > 0 ? types : ['skid_steer', 'mini_excavator', 'trailer'];
  const queries = [];
  for (const type of activeTypes) {
    const label = EQUIPMENT_TYPES[type];
    if (!label) continue;
    let q = `${label}`;
    if (keyword) q += ` ${keyword}`;
    if (yearMin || yearMax) {
      if (yearMin && yearMax) q += ` ${yearMin}-${yearMax}`;
      else if (yearMin) q += ` ${yearMin}`;
    }
    if (priceMin || priceMax) {
      if (priceMin && priceMax) q += ` $${priceMin}-$${priceMax}`;
      else if (priceMin) q += ` over $${priceMin}`;
      else if (priceMax) q += ` under $${priceMax}`;
    }
    q += ' for sale -rent -rental -lease site:ksl.com';
    queries.push({ query: q, type, hasHours: type !== 'trailer' });
  }
  return queries;
}

function parseSnippet(snippet, title, type) {
  const text = `${title} ${snippet}`;
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : null;
  const priceMatch = text.match(/\$[\d,]+/);
  const price = priceMatch ? parseInt(priceMatch[0].replace(/[$,]/g, '')) : null;
  const hoursMatch = type !== 'trailer' ? text.match(/(\d[\d,]*)\s*(hours?|hrs?)\b/i) : null;
  const hours = hoursMatch ? parseInt(hoursMatch[1].replace(/,/g, '')) : null;
  const makes = ['Caterpillar','CAT','John Deere','Deere','Bobcat','Kubota','Case','Takeuchi','Yanmar','Komatsu','Volvo','Hitachi','Doosan','Hyundai','New Holland','Gehl','Mustang','JCB','Wacker Neuson','LiuGong','Big Tex','PJ','Load Trail','Maxx-D','Diamond C','Sure-Trac','Kaufman'];
  let make = null;
  for (const m of makes) {
    if (text.toLowerCase().includes(m.toLowerCase())) { make = m; break; }
  }
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
  const { query, type } = searchObj;
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}&num=20&gl=us&hl=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpAPI error: ${res.status}`);
  const data = await res.json();
  return (data.organic_results || []).map(r => ({
    id: r.link, type, title: r.title, url: r.link, snippet: r.snippet, source: 'ksl',
    ...parseSnippet(r.snippet || '', r.title || '', type),
    scrapedAt: new Date().toISOString(),
  })).filter(r => {
    if (!r.url || !r.url.includes('ksl.com')) return false;
    const text = `${r.title} ${r.snippet}`.toLowerCase();
    if (text.includes('for rent') || text.includes('rental') || text.includes('/day') || text.includes('per day')) return false;
    // Filter out category pages (no price in snippet)
    if (!r.snippet || !r.snippet.includes('$')) return false;
    // Filter out generic category page titles
    const genericTitles = ['new and used listings', 'new & used', 'for sale near you', 'find new and used', 'search utah'];
    if (genericTitles.some(t => r.title && r.title.toLowerCase().includes(t))) return false;
    return true;
  });
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
    // Accept filter params from POST body or query string
    let params = {};
    if (req.method === 'POST') {
      params = req.body || {};
    } else {
      params = req.query || {};
      if (params.types) params.types = params.types.split(',');
    }

    const searches = buildQueries(params);
    const allListings = [];
    for (const search of searches) {
      try {
        const listings = await fetchListings(search);
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

    // Client-side filter params for price/year/hours post-filtering
    const priceMin = parseInt(params.priceMin) || 0;
    const priceMax = parseInt(params.priceMax) || Infinity;
    const yearMin = parseInt(params.yearMin) || 0;
    const yearMax = parseInt(params.yearMax) || 9999;
    const hoursMax = parseInt(params.hoursMax) || Infinity;

    const filtered = deduped.filter(l => {
      if (l.price !== null && (l.price < priceMin || l.price > priceMax)) return false;
      if (l.year !== null && (parseInt(l.year) < yearMin || parseInt(l.year) > yearMax)) return false;
      if (l.hours !== null && l.hours > hoursMax) return false;
      return true;
    });

    const { listings: existing, sha } = await getExistingFile();
    const existingMap = new Map(existing.map(l => [l.url, l]));
    for (const l of filtered) existingMap.set(l.url, l);
    const merged = Array.from(existingMap.values())
      .sort((a, b) => new Date(b.scrapedAt) - new Date(a.scrapedAt))
      .slice(0, 500);

    await commitListings(merged, sha);
    return res.status(200).json({ success: true, fetched: filtered.length, total: merged.length, lastRun: new Date().toISOString() });
  } catch (err) {
    console.error('Scrape failed:', err);
    return res.status(500).json({ error: err.message });
  }
};
