// /api/pushDraft.js — split mode, sanitized URLs, resilient OpenAI fallback

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

// ---------- CORS ----------
const ALLOWED = [
  "https://www.selfrun.ai",
  "https://selfrun.ai",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
function allowOrigin(origin = "") {
  try {
    if (!origin) return "";
    if (ALLOWED.includes(origin)) return origin;
    const host = new URL(origin).hostname;
    if (host.endsWith(".framer.website")) return origin; // Framer preview
    return "";
  } catch { return ""; }
}
function applyCORS(req, res) {
  const origin = allowOrigin(req.headers.origin || "");
  res.setHeader("Vary", "Origin");
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// ---------- Microsoft Graph (app-only) ----------
const TENANT = process.env.MICROSOFT_TENANT_ID;
const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;

async function getGraphToken() {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(TENANT)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) throw new Error(`Graph token failed: ${resp.status} ${await resp.text()}`);
  return resp.json(); // { access_token }
}

async function createDraftInMailbox({ subject, htmlBody, to, cc, senderEmail }) {
  const { access_token } = await getGraphToken();
  const sender = senderEmail || "shap@hollywoodbranded.com";
  const draftData = {
    subject,
    body: { contentType: "HTML", content: htmlBody },
    toRecipients: (Array.isArray(to) ? to : [to])
      .filter(Boolean)
      .slice(0, 10)
      .map((email) => ({ emailAddress: { address: email } })),
  };
  if (Array.isArray(cc) && cc.length) {
    draftData.ccRecipients = cc.slice(0, 10).map((email) => ({ emailAddress: { address: email } }));
  }
  const createUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/messages`;
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(draftData),
  });
  if (!createRes.ok) throw new Error(`Draft creation failed: ${createRes.status} ${await createRes.text()}`);
  const created = await createRes.json();

  const getUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/messages/${created.id}?$select=webLink`;
  const getRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${access_token}` } });
  const getJson = getRes.ok ? await getRes.json() : {};
  return { id: created.id, webLink: getJson.webLink || created.webLink || null };
}

// ---------- helpers ----------
const esc = (s = "") => String(s).replace(/[<&>]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
const isHttpUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u) && u.length < 1000;
const trim = (s, n = 1400) => String(s || "").slice(0, n);
const normIdeas = (v) =>
  Array.isArray(v) ? v : v ? String(v).split(/\n|•|- |\u2022/).map((s) => s.trim()).filter(Boolean) : [];

function sanitizeBrand(b = {}) {
  const assets = (Array.isArray(b.assets) ? b.assets : [])
    .filter((a) => a && isHttpUrl(a.url))
    .slice(0, 12)
    .map((a) => ({ title: a.title || a.type || "Link", type: a.type || "link", url: a.url }));

  const extras = [
    b.posterUrl && isHttpUrl(b.posterUrl) ? { title: "Poster", type: "image", url: b.posterUrl } : null,
    (b.videoUrl || b.exportedVideo) && isHttpUrl(b.videoUrl || b.exportedVideo)
      ? { title: "Video", type: "video", url: b.videoUrl || b.exportedVideo }
      : null,
    (b.pdfUrl || b.brandCardPDF) && isHttpUrl(b.pdfUrl || b.brandCardPDF)
      ? { title: "Proposal PDF", type: "pdf", url: b.pdfUrl || b.brandCardPDF }
      : null,
    b.audioUrl && isHttpUrl(b.audioUrl) ? { title: "Audio Pitch", type: "audio", url: b.audioUrl } : null,
  ].filter(Boolean);

  return {
    name: b.name || "",
    whyItWorks: trim(b.whyItWorks),
    hbInsights: trim(b.hbInsights),
    integrationIdeas: normIdeas(b.integrationIdeas).slice(0, 8).map((x) => trim(x, 200)),
    contentText: trim(b.contentText, 2000), // fallback description
    assets: [...assets, ...extras],
  };
}

function linkListHtml(oneBrand) {
  const lines = (oneBrand.assets || []).map(
    (a) => `<div><a href="${a.url}" target="_blank" rel="noopener">${a.title || a.type || "Link"}</a></div>`
  );
  return lines.length ? `<div style="margin-top:12px;">${lines.join("")}</div>` : "";
}

// OpenAI: using plain fetch (no SDK dependency)
async function generateAiBody({ project, vibe, cast, location, notes, brand }) {
  const fallback = () => {
    const idea = brand.integrationIdeas?.length ? `\n• ${brand.integrationIdeas.join("\n• ")}` : "";
    return `Hi there—quick note on ${project}.

${brand.name}
${brand.whyItWorks ? "Why it works: " + brand.whyItWorks + "\n\n" : ""}
${brand.hbInsights ? "HB insights: " + brand.hbInsights + "\n\n" : ""}${
      idea ? "Integration ideas:\n" + idea + "\n\n" : ""
    }${notes ? "Notes: " + notes + "\n" : ""}`.trim();
  };

  try {
    if (!process.env.OPENAI_API_KEY) return fallback();
    
    const prompt = `
Write a short, friendly email to a brand contact about a potential partnership.
- Sound personal and concise (5–8 sentences), not salesy.
- Fold in the fields naturally (brand fit, ideas, HB insights).
- Do NOT include a subject line.
- Do NOT include any placeholders (no [Your Name], no [Brand Contact's Name]).
- Do NOT add a "Links:" section; I will append links separately.
- Do NOT ask the recipient to send information; this is an intro pitch.

Project: ${project}
Vibe: ${vibe}
Cast: ${cast}
Location: ${location}
Notes from sender: ${notes || "(none)"}

Brand: ${brand.name}
Why it works: ${brand.whyItWorks || "-"}
Integration ideas: ${brand.integrationIdeas?.length ? brand.integrationIdeas.map((x) => "• " + x).join("\n") : "-"}
HB Insights: ${brand.hbInsights || "-"}
Additional context: ${brand.contentText || "-"}
`.trim();

    // Use OpenAI REST API directly (no SDK dependency)
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You write personable, concise business emails." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      })
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      console.log("[pushDraft] OpenAI HTTP error", resp.status, errTxt);
      return fallback();
    }

    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content?.trim();
    return content || fallback();
  } catch (e) {
    console.log("[pushDraft] OpenAI fetch exception", e?.message || e);
    return fallback();
  }
}

// ---------- handler ----------
export default async function handler(req, res) {
  applyCORS(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const body = req.body || {};
    
    // Normalize flags
    const rawSplit = {
      splitPerBrand: body?.splitPerBrand,
      split: body?.split,
      mode: body?.mode
    };
    
    // We'll decide after we parse brandsRaw
    const brandsRaw = Array.isArray(body.brands) ? body.brands : [];
    
    let splitPerBrand = rawSplit.splitPerBrand === true ||
                        rawSplit.split === true ||
                        (typeof rawSplit.mode === 'string' && rawSplit.mode.toLowerCase() === 'split');
    
    // If caller sent NO split flags at all, default to split when >1 brands
    if (!splitPerBrand && 
        rawSplit.splitPerBrand === undefined && 
        rawSplit.split === undefined && 
        rawSplit.mode === undefined && 
        brandsRaw.length > 1) {
      splitPerBrand = true;
    }
    
    console.log('[pushDraft] split? (normalized)=', splitPerBrand, 
                'raw:', rawSplit, 
                'brands:', brandsRaw.length);
    
    const pd = body.productionData && typeof body.productionData === "object" ? body.productionData : {};
    const projectName = body.projectName ?? pd.projectName ?? "Project";
    const cast = body.cast ?? pd.cast ?? "";
    const location = body.location ?? pd.location ?? "";
    const vibe = body.vibe ?? pd.vibe ?? "";
    const notes = body.notes ?? pd.notes ?? "";
    const toRecipients = Array.isArray(body.to) && body.to.length ? body.to.slice(0, 10) : ["shap@hollywoodbranded.com"];
    const ccRecipients = Array.isArray(body.cc) ? body.cc.slice(0, 10) : [];
    const senderEmail = body.senderEmail || "shap@hollywoodbranded.com";

    if (!brandsRaw.length) return res.status(400).json({ error: "No brands provided" });

    const brands = brandsRaw.map(sanitizeBrand).slice(0, 10); // safety cap

    // --- SPLIT MODE: one draft per brand ---
    if (splitPerBrand) {
      const results = [];
      for (const b of brands) {
        try {
          const aiBody = await generateAiBody({
            project: projectName,
            vibe, cast, location, notes,
            brand: b,
          });
          const htmlBody = `
<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;">
  ${aiBody.split("\n").map((line) => `<div>${esc(line)}</div>`).join("")}
  ${linkListHtml(b)}
</div>`.trim();

          const subject = `[Pitch] ${projectName} — ${b.name || "Brand"}`;
          const draft = await createDraftInMailbox({
            subject,
            htmlBody,
            to: toRecipients,
            cc: ccRecipients,
            senderEmail,
          });
          results.push({ brand: b.name || "Brand", subject, webLink: draft.webLink || null });
        } catch (e) {
          results.push({ brand: b.name || "Brand", error: String(e?.message || e) });
        }
      }
      const webLinks = results.map((r) => r.webLink).filter(Boolean);
      return res.status(200).json({ success: true, mode: "split", count: results.length, webLinks, results });
    }

    // --- COMBINED MODE: one email with all brands ---
    const blocks = brands
      .map(
        (b) => `
Brand: ${b.name}
Why it works: ${b.whyItWorks || "(inline below)"}
Integration ideas:
${b.integrationIdeas?.length ? b.integrationIdeas.map((x) => "• " + x).join("\n") : "-"}
HB Insights: ${b.hbInsights || "-"}
Additional context:
${b.contentText || "-"}
Links:
${(b.assets || []).map((a) => `${a.title || a.type || "Link"}: ${a.url}`).join("\n")}
`.trim()
      )
      .join("\n---\n");

    const aiCombined = await generateAiBody({
      project: projectName,
      vibe, cast, location, notes,
      brand: {
        name: brands.map((b) => b.name).join(", "),
        whyItWorks: brands.map((b) => b.whyItWorks).filter(Boolean).join(" | "),
        integrationIdeas: brands.flatMap((b) => b.integrationIdeas || []),
        hbInsights: brands.map((b) => b.hbInsights).filter(Boolean).join(" | "),
        contentText: blocks,
      },
    });

    const linkListAll = brands
      .map((b) => {
        const lines = (b.assets || []).map(
          (a) => `<div><a href="${a.url}" target="_blank" rel="noopener">${a.title || a.type || "Link"}</a></div>`
        );
        return lines.length
          ? `<div style="margin-top:6px;"><div style="font-weight:600;">${b.name || "Brand"}</div>${lines.join("")}</div>`
          : "";
      })
      .filter(Boolean)
      .join("");

    const htmlCombined = `
<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;">
  ${aiCombined.split("\n").map((line) => `<div>${esc(line)}</div>`).join("")}
  ${linkListAll ? `<div style="margin-top:12px;">${linkListAll}</div>` : ""}
</div>`.trim();

    const subject =
      `[Pitch] ${projectName} — ` +
      `${brands.slice(0, 3).map((b) => b.name).filter(Boolean).join(", ")}` +
      `${brands.length > 3 ? "…" : ""}`;

    const draft = await createDraftInMailbox({
      subject,
      htmlBody: htmlCombined,
      to: toRecipients,
      cc: ccRecipients,
      senderEmail,
    });

    return res.status(200).json({ success: true, mode: "combined", webLink: draft.webLink || null, subject });
  } catch (err) {
    applyCORS(req, res);
    return res.status(500).json({ error: "Failed to push draft", details: err?.message || String(err) });
  }
}
