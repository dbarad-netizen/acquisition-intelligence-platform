// Enrichment pipeline: Google Places lookup + LLM website analysis → Supabase.
// Required Vercel env vars:
//   SUPABASE_SERVICE_ROLE_KEY  (already set for the outreach log)
//   TEAM_PASSCODE              (already set)
//   GOOGLE_MAPS_API_KEY        (Google Cloud → Places API (New) enabled → API key)
//   ANTHROPIC_API_KEY          (already set for the coach; used for website analysis)

const SUPA = "https://xazmwpozsmbrqoulizyn.supabase.co";
export const maxDuration = 60;

const digits = s => String(s || "").replace(/[^0-9]/g, "");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const skey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pass = process.env.TEAM_PASSCODE;
  const gkey = process.env.GOOGLE_MAPS_API_KEY;
  const akey = process.env.ANTHROPIC_API_KEY;
  if (!skey || !pass) return res.status(500).json({ error: "Set SUPABASE_SERVICE_ROLE_KEY and TEAM_PASSCODE in Vercel env vars." });
  if (!gkey) return res.status(500).json({ error: "Set GOOGLE_MAPS_API_KEY in Vercel env vars (Google Cloud → enable Places API (New) → create key)." });
  if ((req.headers["x-team-passcode"] || "") !== pass) return res.status(401).json({ error: "Wrong or missing team passcode" });

  const H = { apikey: skey, Authorization: "Bearer " + skey, "content-type": "application/json" };
  const { license } = req.body || {};
  if (!license) return res.status(400).json({ error: "license required" });

  try {
    // 1) load the business
    const br = await fetch(`${SUPA}/rest/v1/acq_businesses?license_number=eq.${encodeURIComponent(license)}&select=*`, { headers: H });
    const found = await br.json();
    if (!found.length) return res.status(404).json({ error: "business not found" });
    const biz = found[0];
    const patch = {};
    const report = [];

    // 2) Google Places Text Search (New)
    const ps = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": gkey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus",
      },
      body: JSON.stringify({ textQuery: `${biz.name} ${biz.city || ""} CA`, maxResultCount: 3 }),
    });
    const pd = await ps.json();
    if (!ps.ok) return res.status(502).json({ error: "Places API: " + (pd.error?.message || ps.status) });
    const cands = pd.places || [];

    // 3) pick the best match: phone > zip > name prefix
    let best = null, how = "";
    for (const c of cands) {
      if (biz.phone && digits(c.nationalPhoneNumber) && digits(c.nationalPhoneNumber) === digits(biz.phone)) { best = c; how = "phone match (high confidence)"; break; }
    }
    if (!best) for (const c of cands) {
      if (biz.zip && (c.formattedAddress || "").includes(biz.zip)) { best = c; how = "ZIP match (medium confidence)"; break; }
    }
    if (!best && cands.length && (cands[0].displayName?.text || "").toLowerCase().slice(0, 8) === biz.name.toLowerCase().slice(0, 8)) {
      best = cands[0]; how = "name match only (verify manually)";
    }

    if (!best) {
      report.push("No confident Google match — business may operate under a different name, or has no Google presence (itself a signal: likely low web maturity).");
    } else {
      patch.google_place_id = best.id;
      if (best.rating != null) patch.google_rating = best.rating;
      if (best.userRatingCount != null) patch.google_review_count = best.userRatingCount;
      if (best.websiteUri) patch.website = best.websiteUri;
      report.push(`Google match via ${how}: ${best.rating ?? "no"}★ · ${best.userRatingCount ?? 0} reviews · ${best.websiteUri ? "website found" : "NO website"} · status ${best.businessStatus || "?"}`);
      if (best.businessStatus === "CLOSED_PERMANENTLY") {
        patch.disqualified = true;
        patch.disqualified_reason = "Google shows permanently closed";
        report.push("⚠ Marked disqualified: Google reports permanently closed.");
      }
    }

    // 4) LLM website analysis
    if (patch.website && akey) {
      try {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
        const wr = await fetch(patch.website, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; AcqIntel/1.0)" }, redirect: "follow" });
        clearTimeout(t);
        let html = (await wr.text()).slice(0, 400000);
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").slice(0, 16000);
        const ar = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": akey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 500,
            system: "You analyze a small trade-business website's text for an acquisition platform. Reply with ONLY a JSON object, no prose: {\"website_score\":1-5 (1=broken/none,2=outdated brochure,3=basic working,4=strong lead-gen,5=advanced online systems),\"online_booking\":bool,\"recurring_pct_hint\":int 0-100 or null (only if maintenance plans/service agreements are clearly promoted; estimate conservatively),\"marketing_gap\":0-100 (100=no marketing sophistication),\"backoffice_gap\":0-100 (100=clearly paper-era; infer from tech signals, portals, financing options),\"team_page\":bool,\"succession_hint\":string or null (e.g. 'son listed as ops manager','founder-only'),\"summary\":string max 200 chars}",
            messages: [{ role: "user", content: "Website text of \"" + biz.name + "\" (" + biz.industry + "):\n\n" + text }],
          }),
        });
        const ad = await ar.json();
        if (ar.ok) {
          const raw = (ad.content || []).map(c => c.text || "").join("");
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) {
            const j = JSON.parse(m[0]);
            if (j.website_score >= 1 && j.website_score <= 5) patch.website_score = j.website_score;
            if (typeof j.online_booking === "boolean") patch.online_booking = j.online_booking;
            if (j.recurring_pct_hint != null) patch.recurring_pct = Math.max(0, Math.min(100, j.recurring_pct_hint));
            if (j.marketing_gap != null) patch.marketing_gap = Math.max(0, Math.min(100, j.marketing_gap));
            if (j.backoffice_gap != null) patch.backoffice_gap = Math.max(0, Math.min(100, j.backoffice_gap));
            if (j.succession_hint) patch.no_succession = !/son|daughter|second.generation|junior|family|successor/i.test(j.succession_hint) ? true : false;
            report.push("Website analysis (AI): score " + (j.website_score ?? "?") + "/5 · booking " + (j.online_booking ? "yes" : "no") + (j.succession_hint ? " · succession: " + j.succession_hint : "") + " — " + (j.summary || ""));
          }
        } else {
          report.push("Website analysis skipped: " + (ad.error?.message || ar.status));
        }
      } catch (e) {
        report.push("Website unreachable (" + e.message + ") — site may be dead: strong modernization-upside signal.");
        patch.website_score = 1;
      }
    } else if (best && !patch.website) {
      patch.website_score = 1;
      report.push("No website on Google profile → website score 1/5 (maximum modernization gap).");
    }

    // 5) write back (append provenance to notes, never overwrite them)
    if (Object.keys(patch).length) {
      patch.notes = (biz.notes || "") + " || Enriched " + new Date().toISOString().slice(0, 10) + " (Google Places + AI website analysis): " + report.join(" | ");
      const ur = await fetch(`${SUPA}/rest/v1/acq_businesses?id=eq.${biz.id}`, { method: "PATCH", headers: H, body: JSON.stringify(patch) });
      if (!ur.ok) return res.status(500).json({ error: "DB update failed: " + (await ur.text()).slice(0, 200) });
    }

    return res.status(200).json({
      ok: true, report,
      fields: {
        rating: patch.google_rating ?? null, reviews: patch.google_review_count ?? null,
        website: patch.website ?? null, web: patch.website_score ?? null,
        booking: patch.online_booking ?? null, recurring: patch.recurring_pct ?? null,
        marketingGap: patch.marketing_gap ?? null, backofficeGap: patch.backoffice_gap ?? null,
        noSucc: patch.no_succession ?? null, disq: patch.disqualified ?? false,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: "Enrichment failed: " + e.message });
  }
}
