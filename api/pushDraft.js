// /api/pushDraft.js — ZERO top-level imports, robust CORS, dynamic OpenAI import

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };
// If your project ever defaults to Edge runtime, uncomment the next line:
// export const runtime = "nodejs"; // Next.js pages API only

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
    if (host.endsWith(".framer.website")) return origin; // allow Framer preview
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

// ---------- Graph (inline) ----------
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
  const sender = senderEmail || "stacy@hollywoodbranded.com";

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
const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const dedupe = (arr) => Array.from(new Set(arr.filter(Boolean)));
const bullets = (arr) => arr.map((x) => `• ${x}`).join("\n");
const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length < 1000;
const trim = (s, n=1200) => String(s || '').slice(0, n);
const normIdeas = (v) => 
  Array.isArray(v) ? v : v ? String(v).split(/\n|•|- |\u2022/).map(s=>s.trim()).filter(Boolean) : [];

function sanitizeBrand(b={}) {
  const assets = (Array.isArray(b.assets) ? b.assets : [])
    .filter(a => a && isHttpUrl(a.url))
    .slice(0, 12)
    .map(a => ({
      title: a.title || a.type || 'Link',
      type: a.type || 'link',
      url: a.url
    }));
  
  const extras = [
    b.posterUrl && isHttpUrl(b.posterUrl) ? 
      { title:'Poster', type:'image', url:b.posterUrl } : null,
    (b.videoUrl || b.exportedVideo) && isHttpUrl(b.videoUrl || b.exportedVideo) ? 
      { title:'Video', type:'video', url:b.videoUrl || b.exportedVideo } : null,
    (b.pdfUrl || b.brandCardPDF) && isHttpUrl(b.pdfUrl || b.brandCardPDF) ? 
      { title:'Proposal PDF', type:'pdf', url:b.pdfUrl || b.brandCardPDF } : null,
    b.audioUrl && isHttpUrl(b.audioUrl) ? 
      { title:'Audio Pitch', type:'audio', url:b.audioUrl } : null,
  ].filter(Boolean);
  
  return {
    name: b.name || '',
    whyItWorks: trim(b.whyItWorks),
    hbInsights: trim(b.hbInsights),
    integrationIdeas: normIdeas(b.integrationIdeas).slice(0,8).map(x=>trim(x,200)),
    assets: [...assets, ...extras]
  };
}

function linkListHtml(brands) {
  const blocks = brands.map(b => {
    const lines = (b.assets || []).map(a => 
      `<div><a href="${a.url}" target="_blank" rel="noopener">${esc(a.title || a.type || 'Link')}</a></div>`
    ).join('');
    return lines ? 
      `<div style="margin-top:6px;"><div style="font-weight:600;">${esc(b.name || 'Brand')}</div>${lines}</div>` : '';
  }).filter(Boolean);
  
  return blocks.length ? 
    `<div style="margin-top:12px;">${blocks.join('')}</div>` : '';
}

// ---------- handler ----------
export default async function handler(req, res) {
  applyCORS(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const body = req.body || {};

    // Accept both shapes (top-level or productionData)
    const pd = body.productionData && typeof body.productionData === "object" ? body.productionData : {};
    const projectName = body.projectName ?? pd.projectName ?? "Project";
    const cast        = body.cast        ?? pd.cast        ?? "";
    const location    = body.location    ?? pd.location    ?? "";
    const vibe        = body.vibe        ?? pd.vibe        ?? "";
    const notes       = body.notes       ?? pd.notes       ?? "";

    const brandsRaw = Array.isArray(body.brands) ? body.brands : [];
    const brands = brandsRaw.map(sanitizeBrand);
    if (!brands.length) return res.status(400).json({ error: "No brands provided" });

    // recipients: default to shap only
    const to = asArray(body.to);
    const cc = asArray(body.cc);
    const toRecipients = to.length ? to.slice(0, 10) : ["shap@hollywoodbranded.com"];
    const senderEmail = body.senderEmail || "shap@hollywoodbranded.com";

    // Build AI prompt blocks
    const brandTextBlocks = brands.map((b) => {
      const ideas = b.integrationIdeas;
      const linksTxt = b.assets
        .map((a) => `${a.title || a.type || "Link"}: ${a.url}`)
        .join("\n");

      return `
Brand: ${b.name || ""}
Why it works: ${b.whyItWorks || ""}
Integration ideas:
${ideas.length ? bullets(ideas) : "-"}
HB Insights: ${b.hbInsights || ""}
${linksTxt}
`.trim();
    }).join("\n---\n");

    // Dynamically import OpenAI so OPTIONS preflight never loads it
    let aiBody = "";
    try {
      const { default: OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const prompt = `
Write a short, natural, personal email to a brand contact about a potential partnership.
Avoid marketing jargon. Sound like a human who knows them.

Project: ${projectName}
Vibe: ${vibe}
Cast: ${cast}
Location: ${location}
Notes from sender: ${notes || "(none)"}

For each brand below, weave in "Why it works", the integration ideas, and any insights.
Keep it concise and friendly. After the body, add a short, clearly labeled link list for easy access.

${brandTextBlocks}
      `.trim();

      const aiResp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You write personable, concise business emails." },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      });
      aiBody = aiResp?.choices?.[0]?.message?.content?.trim() || "";
    } catch (e) {
      // Fallback if OpenAI lib/env not available
      aiBody = `Hi there—quick note on ${projectName}.`;
    }

    // Explicit link list (clear + clickable) - removed since we're using linkListHtml now

    const htmlBody = `
<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;">
  ${aiBody.split("\n").map((line) => `<div>${esc(line)}</div>`).join("")}
  ${linkListHtml(brands)}
</div>
    `.trim();

    const subject =
      `[Pitch] ${projectName} — ` +
      `${brands.slice(0, 3).map((b) => b.name).filter(Boolean).join(", ")}` +
      `${brands.length > 3 ? "…" : ""}`;

    const draft = await createDraftInMailbox({
      subject,
      htmlBody,
      to: toRecipients,
      cc,
      senderEmail,
    });

    return res.status(200).json({ success: true, webLink: draft?.webLink || null, subject });
  } catch (err) {
    // Keep CORS headers on error, too
    applyCORS(req, res);
    return res.status(500).json({ error: "Failed to push draft", details: err?.message || String(err) });
  }
}
