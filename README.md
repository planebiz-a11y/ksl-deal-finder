# Iron Hunter — KSL Equipment Deal Finder

Finds skid steers, mini excavators, and trailers on KSL Classifieds at good prices.
Runs on Vercel. Uses SerpAPI for search. No database needed — stores listings in `public/listings.json`.

## Setup

### 1. Clone and push to GitHub
```bash
git init
git add .
git commit -m "init"
gh repo create ksl-deal-finder --public --push
```

### 2. Deploy to Vercel
```bash
npx vercel --prod
```

### 3. Set environment variable in Vercel
In your Vercel dashboard → Project → Settings → Environment Variables:
```
SERP_API_KEY = 7014e6359d313117e052d041235b1da36bc63d72084111105cc72199d9d83130
```

### 4. Cron schedule
`vercel.json` configures the scraper to run every 4 hours automatically.
You can also trigger it manually from the dashboard via the "Run Scrape Now" button.

## Architecture

```
/api/scrape.js       — Vercel serverless function, hits SerpAPI, parses results, writes listings.json
/public/index.html   — Dashboard UI with filters
/public/listings.json — Persisted listings (up to 500, deduplicated by URL)
/vercel.json         — Cron config (every 4 hours)
```

## Searches Run
- `skid steer for sale site:ksl.com`
- `mini excavator for sale site:ksl.com`
- `trailer for sale site:ksl.com`

## Fields Parsed from Snippets
- Year (4-digit)
- Price ($X,XXX)
- Make (CAT, Bobcat, Kubota, John Deere, etc.)
- Model
- Hours (skid steer + excavator only)

## Adding Facebook Later
Add a new entry to `SEARCHES` in `api/scrape.js`:
```js
{ query: 'skid steer for sale site:facebook.com/marketplace', type: 'skid_steer', hasHours: true }
```
Everything else — parsing, storage, UI — works as-is.
```
