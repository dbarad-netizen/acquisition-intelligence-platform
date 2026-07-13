# Acquisition Intelligence Platform (Prototype)

Single-file static app — no build step, no dependencies. `index.html` is the whole thing.

Four scores per business (Business Quality, Transition Probability, Brokerage Fit, AI Modernization Upside), live Acquire / Broker / Watch / Pass tiering with adjustable thresholds and buy-box, quality×transition map, per-business AI modernization plans, adjustable scoring weights, CSV export. Sample data is fictional.

## Push to GitHub

From this folder:

```bash
git init
git add .
git commit -m "Acquisition intelligence platform prototype"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/acquisition-intelligence-platform.git
git push -u origin main
```

(Or with GitHub CLI: `gh repo create acquisition-intelligence-platform --public --source=. --push`)

## Deploy on Vercel

1. vercel.com → **Add New… → Project**
2. Import the `acquisition-intelligence-platform` repo
3. Framework preset: **Other** — leave build command and output directory empty
4. **Deploy**. Every future `git push` auto-redeploys.

## Roadmap to real data

- Replace the hardcoded `DATA` array with a fetch from Supabase (free tier is plenty): one `businesses` table, load via `supabase-js` on page load.
- Seed from free sources first (CSLB contractor files, city business-license CSVs), then enrich (Google Places, LLM website analysis), then commercial data (Data Axle).
- Keep scoring weights in a `config` table so recalibration doesn't require a deploy.
