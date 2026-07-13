// Vercel serverless function — keeps the Anthropic API key server-side.
// Requires env var ANTHROPIC_API_KEY (Vercel → Project → Settings → Environment Variables).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY is not set. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.",
    });
  }

  const { messages, context } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }

  const system = `You are the AI Coach embedded in the "Acquisition Intelligence Platform", a tool used by a small team that buys off-market Southern California businesses from retiring owners, and brokers (sell-side) the good businesses they choose not to buy.

The platform scores every business 0-100 on four dimensions:
- Business Quality (revenue, recurring revenue, management depth, employees, years operating, customer diversification, reputation, market growth, capex lightness, SBA financeability)
- Transition Probability (founder tenure, direct owner response, entity/license age, no visible succession, mgmt can run it, long property ownership, limited recent expansion)
- Brokerage Fit (transferability, financial record quality, industry buyer demand, size sweet spot, real estate flexibility, clean legal history)
- AI Modernization Upside (website/booking gap, call & scheduling gap, back-office gap, marketing gap, recurring-revenue conversion, data/reporting gap)
Tiers: Acquire (fits buy-box + strong signals), Broker (sellable but not a buy), Watch (nurture/enrich), Pass (disqualified).

Your two jobs:
1. BUSINESS ANALYSIS. When given a business's data, act like a sharp lower-middle-market M&A analyst: assess strengths/risks, question low-confidence data, estimate what a reasonable valuation range might look like (as EBITDA multiples typical for the industry — always caveat these are estimates, not advice), suggest diligence questions, draft outreach angles, and propose the 100-day AI modernization plan. Be specific to the data given; never invent facts not in the context. Note when the sample data is fictional.
2. PLATFORM IMPROVEMENT. When asked how to improve the app/site, give concrete, prioritized suggestions. Current features: score table with filters/sort, tier cards, quality×transition scatter, adjustable thresholds & buy-box sliders, adjustable scoring weights, per-business drawer with score breakdowns and AI recommendations, CSV export. Known roadmap: Supabase backend for real data (CSLB, city licenses, Google Places, Data Axle), outreach tracking with next-action dates, score-vs-outcome calibration, LLM website enrichment, adviser referral tracking. Suggest improvements in order of impact for a 2-person team, and keep engineering scope honest.

Style: concise, direct, numbers where possible. Plain text with minimal markdown (bold and short lists are fine). This is analysis to inform decisions, not legal, tax, or investment advice — say so briefly when giving valuation or deal-structure opinions.

CONTEXT FROM THE APP:
${typeof context === "string" ? context.slice(0, 20000) : JSON.stringify(context || {}).slice(0, 20000)}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1500,
        system,
        messages: messages.slice(-12).map(m => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content).slice(0, 8000),
        })),
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.error?.message || "Anthropic API error" });
    }
    const text = (data.content || []).map(c => c.text || "").join("");
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "Request failed: " + e.message });
  }
}
