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

## Outreach log (LIVE)

Open any business → the drawer has an Outreach log: every call, letter, or email gets logged to `acq_outreach` with outcome, notes, next action + date, and the Tier-3 conversation fields (retirement timeline, price expectation, seller-financing openness). Each save also snapshots the business's current scores to `acq_score_snapshots` — that's the calibration dataset — and updates the owner-response field, which re-scores the record instantly.

Setup (one time, in Vercel → Settings → Environment Variables):
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase dashboard → Project Settings → API → `service_role` key (keep secret; server-side only)
- `TEAM_PASSCODE` — any shared secret you choose; the site prompts for it once per browser

Redeploy after adding the vars. Writes go through `api/outreach.js`; the passcode gates access and the service key never reaches the browser.

## Enrichment (Google Places + AI website analysis)

Open an unenriched business → **⚡ Enrich now**. One click runs: Google Places lookup (rating, review count, website, phone, open/closed status; match confidence via phone > ZIP > name) → fetches the website → Claude analyzes it (website score 1–5, online booking, maintenance-plan evidence, marketing & back-office gaps, succession hints from the team page) → writes everything to Supabase with a dated provenance note. Scores and tier update live; permanently-closed businesses get auto-disqualified.

Extra env var needed (besides the ones above):
- `GOOGLE_MAPS_API_KEY` — console.cloud.google.com → create project → enable **Places API (New)** → Credentials → API key (restrict to Places API) → attach billing

Cost per business: ~3–4¢ Google + well under 1¢ Claude (Haiku). Top 500 ≈ $20; all 3,601 ≈ $115–130.

## Database (LIVE)

The app loads live data from Supabase (project `xazmwpozsmbrqoulizyn`, tables prefixed `acq_`):
`acq_businesses` holds 3,601 real LA County contractors (CSLB licenses 15+ yrs, workers'-comp insured, CLEAR status, C-10/C-20/C-36/C-39). The page falls back to an embedded snapshot if the database is unreachable. The publishable key in `index.html` is safe to expose — row-level security makes it read-only; writes require an authenticated user or the service-role key.

Also live: `acq_outreach` (call/letter log + next actions), `acq_score_snapshots` (scores at time of outreach, for calibration), `acq_score_weights` and `acq_config` (weights/thresholds as data). See `db/schema.sql`.

Next enrichment passes: Google Places (+rating/website/status), LLM website analysis, assessor property lookups, Data Axle (revenue/contacts).
