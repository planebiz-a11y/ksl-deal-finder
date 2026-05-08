const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'planebiz-a11y/ksl-deal-finder';
const LISTINGS_PATH = 'public/listings.json';

const SEARCHES = [
  { url: 'https://classifieds.ksl.com/v2/search/cat/Industrial/sub/Skid+Steer+Loaders/marketType/Sale', type: 'skid_steer' },
  { url: 'https://classifieds.ksl.com/v2/search/cat/Industrial/sub/Excavators/marketType/Sale', type: 'mini_excavator' },
  { url: 'https://classifieds.ksl.com/v2/search/cat/Auto+Parts+and+Accessories/sub/Utility+Trailers/marketType/Sale', type: 'trailer' },
];

const MAKES = ['Caterpillar','CAT','John Deere','Deere','Bobcat','Kubota','Case','Takeuchi','Yanmar','Komatsu','Volvo','Hitachi','Doosan','Hyundai','New Holland','Gehl','Mustang','JCB','Wacker Neuson','LiuGong','Big Tex','PJ','Load Trail','Maxx-D','Diamond C','Sure-Trac','Kaufman'];

async function fetchKSL(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://classifieds.ksl.com/',
      }
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`KSL fetch error: ${res.status}`);
    return await res.text();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function scrapeKSL(searchObj, params) {
  const { type } = searchObj;
  let fetchUrl = searchObj.url;

  const query = new URLSearchParams();
  if (params.priceMin) query.set('priceFrom', params.priceMin);
  if (params.priceMax) query.set('priceTo', params.priceMax);
  if (query.toString()) fetchUrl += `?${query.toString()}`;

  const html = await fetchKSL(fetchUrl);
  const listings = [];
  const listingIdRegex = /href="\/listing\/(\d+)"/g;
  const ids = new Set();
  let match;
  while ((match = listingIdRegex.exec(html)) !== null) ids.add(match[1]);

  for (const id of ids) {
    const listingUrl = `https://classifieds.ksl.com/listing/${id}`;
    const idx = html.indexOf(`/listing/${id}`);
    if (idx === -1) continue;
    const block = html.slice(Math.max(0, idx - 2000), idx + 2000);

    const priceMatch = block.match(/\$([0-9,]+)\.00/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
    if (!price) continue;

    // Skip rentals and new equipment
    const blockLower = block.toLowerCase();
    if (blockLower.includes('for rent') || blockLower.includes('/day') || blockLower.includes('per day')) continue;
    if (blockLower.includes('brand new') || blockLower.includes('new in box')) continue;

    const titleMatch = block.match(/alt="([^"]{10,100})"/) || block.match(/"title":"([^"]{10,100})"/) || block.match(/title="([^"]{10,100})"/);
    const title = titleMatch ? titleMatch[1] : `KSL ${type} listing ${id}`;

    const yearMatch = block.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? yearMatch[0] : null;

    const hoursMatch = type !== 'trailer' ? block.match(/(\d[\d,]*)\s*(hours?|hrs?)\b/i) : null;
    const hours = hoursMatch ? parseInt(hoursMatch[1].replace(/,/g, '')) : null;

    let make = null;
    for (const m of MAKES) {
      if (blockLower.includes(m.toLowerCase())) { make = m; break; }
    }

    if (params.priceMin && price < parseInt(params.priceMin)) continue;
    if (params.priceMax && price > parseInt(params.priceMax)) continue;
    if (params.yearMin && year && parseInt(year) < parseInt(params.yearMin)) continue;
    if (params.yearMax && year && parseInt(year) > parseInt(params.yearMax)) continue;
    if (params.hoursMax && hours && hours > parseInt(params.hoursMax)) continue;

    listings.push({
      id: listingUrl, type, title, url: listingUrl,
      snippet: `${year || ''} ${make || ''} - $${price.toLocaleString()}`.trim(),
      source: 'ksl', year, price, hours, make, model: null,
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
        const listings = await scrapeKSL(search, params);
        console.log(`Got ${listings.length} from ${search.url}`);
        allListings.push(...listings);
      } catch (err) {
        console.error(`Failed: ${search.url}`, err.message);
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
