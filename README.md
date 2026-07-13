# Acquisition Intelligence Platform (Prototype)

Static app (`index.html`) + one serverless function (`api/coach.js`) for the AI Coach. No build step.

Four scores per business (Business Quality, Transition Probability, Brokerage Fit, AI Modernization Upside), live Acquire / Broker / Watch / Pass tiering with adjustable thresholds and buy-box, quality×transition map, per-business AI modernization plans, adjustable scoring weights, CSV export, and an AI Coach that analyzes businesses and suggests platform improvements. Sample data is fictional.

## Repo contents

```
index.html      the app
api/coach.js    serverless function that securely calls the Claude API
coach.jpg       (you add this) avatar photo for the AI Coach — any image works, it's auto-framed
README.md
```

## Upload to GitHub (web, no terminal)

1. github.com → **+ → New repository** → name it → Create
2. **Add file → Upload files** → drag in `index.html`, `README.md`, and your `coach.jpg` → Commit
3. **Add file → Create new file** → type `api/coach.js` as the filename (the `/` creates the folder) → paste the contents of `api/coach.js` → Commit

## Deploy on Vercel

1. vercel.com → **Add New… → Project** → import the repo
2. Framework preset: **Other**, leave build/output empty → **Deploy**
3. **Enable the AI Coach:** Project → **Settings → Environment Variables** → add
   - Name: `ANTHROPIC_API_KEY`
   - Value: your key from [console.anthropic.com](https://console.anthropic.com) (Settings → API Keys)
4. Redeploy (Deployments → ⋯ → Redeploy) so the variable takes effect.

The coach won't work when opening `index.html` as a local file — it needs the deployed `/api/coach` endpoint.

## AI Coach

- Floating button, bottom right. Chat context is automatic: with a business drawer open it analyzes that business (all fields + component scores); otherwise it sees the whole scored portfolio and current thresholds.
- Quick actions: Analyze, Outreach letter, Priorities, Improve the app.
- The API key stays server-side in the Vercel function; it is never exposed in the page.
- Cost: pay-as-you-go on your Anthropic account; typical chat turns cost fractions of a cent.

## Roadmap to real data

- Replace the hardcoded `DATA` array with a fetch from Supabase (free tier is plenty).
- Seed from free sources (CSLB contractor files, city business-license CSVs), then enrich (Google Places, LLM website analysis), then commercial data (Data Axle).
- Keep scoring weights in a `config` table so recalibration doesn't require a deploy.
