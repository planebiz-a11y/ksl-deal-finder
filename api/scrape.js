const SERP_API_KEY = process.env.SERP_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'planebiz-a11y/ksl-deal-finder';
const LISTINGS_PATH = 'public/listings.json';

const SEARCHES = [
  { query: 'skid steer for sale site:ksl.com', type: 'skid_steer', hasHours: true },
  { query: 'mini excavator for sale site:ksl.com', type: 'mini_excavator', hasHours: true },
  { query: 'trailer for sale site:ksl.com', type: 'trailer', hasHours: false },
];

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
  })).filter(r => r.url && r.url.includes('ksl.com'));
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
    const allListings = [];
    for (const search of SEARCHES) {
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
