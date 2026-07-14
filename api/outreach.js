// Outreach log API — writes to Supabase with the service-role key (server-side only).
// Required Vercel env vars:
//   SUPABASE_SERVICE_ROLE_KEY  (Supabase → Project Settings → API → service_role key)
//   TEAM_PASSCODE              (any shared secret you and your partner choose)

const SUPA = "https://xazmwpozsmbrqoulizyn.supabase.co";

export default async function handler(req, res) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pass = process.env.TEAM_PASSCODE;
  if (!key || !pass) {
    return res.status(500).json({ error: "Set SUPABASE_SERVICE_ROLE_KEY and TEAM_PASSCODE in Vercel → Settings → Environment Variables, then redeploy." });
  }
  if ((req.headers["x-team-passcode"] || "") !== pass) {
    return res.status(401).json({ error: "Wrong or missing team passcode" });
  }
  const H = { apikey: key, Authorization: "Bearer " + key, "content-type": "application/json" };

  async function bizIdByLicense(lic) {
    const r = await fetch(`${SUPA}/rest/v1/acq_businesses?license_number=eq.${encodeURIComponent(lic)}&select=id`, { headers: H });
    const rows = await r.json();
    return rows.length ? rows[0].id : null;
  }

  try {
    if (req.method === "GET") {
      const lic = req.query.license;
      if (!lic) return res.status(400).json({ error: "license query param required" });
      const id = await bizIdByLicense(lic);
      if (!id) return res.status(404).json({ error: "business not found" });
      const r = await fetch(`${SUPA}/rest/v1/acq_outreach?business_id=eq.${id}&order=occurred_at.desc&limit=50`, { headers: H });
      return res.status(200).json({ entries: await r.json() });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      if (!b.license || !b.channel) return res.status(400).json({ error: "license and channel required" });
      const id = await bizIdByLicense(b.license);
      if (!id) return res.status(404).json({ error: "business not found" });

      const entry = {
        business_id: id,
        channel: b.channel,
        outcome: b.outcome || null,
        summary: (b.summary || "").slice(0, 4000) || null,
        next_action: (b.next_action || "").slice(0, 500) || null,
        next_action_date: b.next_action_date || null,
        retirement_timeline: (b.retirement_timeline || "").slice(0, 300) || null,
        price_expectation: b.price_expectation || null,
        seller_financing_open: typeof b.seller_financing_open === "boolean" ? b.seller_financing_open : null,
        created_by: (b.created_by || "").slice(0, 100) || null,
      };
      const ins = await fetch(`${SUPA}/rest/v1/acq_outreach`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(entry) });
      if (!ins.ok) return res.status(500).json({ error: "insert failed: " + (await ins.text()).slice(0, 300) });

      // update owner_response on the business when the outcome tells us something
      const map = { conversation: "replied", interested: "interested", mandate_signed: "interested", loi_signed: "interested", closed: "interested", not_interested: "declined" };
      const resp = map[b.outcome];
      if (resp) {
        await fetch(`${SUPA}/rest/v1/acq_businesses?id=eq.${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ owner_response: resp }) });
      }
      // snapshot the scores that prompted this touch (honest calibration data)
      if (b.scores && typeof b.scores === "object") {
        await fetch(`${SUPA}/rest/v1/acq_score_snapshots`, { method: "POST", headers: H, body: JSON.stringify({
          business_id: id,
          quality: b.scores.quality ?? null, transition: b.scores.transition ?? null,
          broker_fit: b.scores.broker ?? null, ai_upside: b.scores.ai ?? null,
          tier: b.tier || null, weights_version: 1,
        }) });
      }
      return res.status(200).json({ ok: true, owner_response: resp || null });
    }

    return res.status(405).json({ error: "GET or POST only" });
  } catch (e) {
    return res.status(500).json({ error: "Request failed: " + e.message });
  }
}
