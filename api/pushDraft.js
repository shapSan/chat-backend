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
    body: { contentType: "HTML", content: htmlBody }, // <- MUST be HTML
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
const esc = (s="") => String(s).replace(/[<&>]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const isHttp = u => typeof u==='string' && /^https?:\/\//i.test(u) && u.length < 1000;
const trim = (s,n=1400)=>String(s||'').slice(0,n);
const normIdeas = v => Array.isArray(v) ? v : v ? String(v).split(/\n|•|- |\u2022/).map(x=>x.trim()).filter(Boolean) : [];

// classify any asset to a sensible type
function classifyAsset(item={}) {
  const url = String(item.url||'');
  let type = (item.type||'').toLowerCase();
  if (!type) {
    if (/\.pdf($|\?)/i.test(url)) type = 'pdf';
    else if (/(youtube|vimeo|\.mp4|\.mov)/i.test(url)) type = 'video';
    else if (/(\.mp3|\.wav)|spotify|soundcloud/i.test(url)) type = 'audio';
    else if (/\.png|\.jpe?g|\.webp/i.test(url)) type = 'image';
    else type = 'link';
  }
  const defaultTitle = ({video:'Video', pdf:'Proposal PDF', audio:'Audio Pitch', image:'Poster', link:'Link'})[type] || 'Link';
  return { type, url, title: item.title || defaultTitle };
}

function sanitizeBrand(b={}) {
  const base = [];
  // fold any top-level url fields
  if (isHttp(b.videoUrl || b.exportedVideo)) base.push({type:'video', url:b.videoUrl || b.exportedVideo, title:'Video'});
  if (isHttp(b.pdfUrl || b.brandCardPDF))   base.push({type:'pdf',   url:b.pdfUrl || b.brandCardPDF,   title:'Proposal PDF'});
  if (isHttp(b.audioUrl))                   base.push({type:'audio', url:b.audioUrl,                   title:'Audio Pitch'});
  if (isHttp(b.posterUrl))                  base.push({type:'image', url:b.posterUrl,                  title:'Poster'});

  const extras = (Array.isArray(b.assets)?b.assets:[])
    .filter(a => a && isHttp(a.url))
    .slice(0, 12)
    .map(classifyAsset);

  // de-dupe by url
  const seen = new Set(); const assets = [];
  [...base, ...extras].forEach(a => { if (!seen.has(a.url)) { seen.add(a.url); assets.push(a); } });

  return {
    name: b.name || b.brand || '',
    whyItWorks: trim(b.whyItWorks),
    hbInsights: trim(b.hbInsights),
    integrationIdeas: normIdeas(b.integrationIdeas).slice(0,8).map(x=>trim(x,200)),
    contentText: trim(Array.isArray(b.content)? b.content.join('\n') : b.content, 2000),
    assets
  };
}

// Natural one-liner that references resources, used inside the email
function assetsNote(brand){
  const t = (brand.assets||[]).map(a=>a.type);
  const parts = [];
  if (t.includes('video')) parts.push('a short video');
  if (t.includes('pdf'))   parts.push('the proposal PDF');
  if (t.includes('audio')) parts.push('a quick audio pitch');
  if (t.includes('image')) parts.push('a one-sheet/poster');
  if (!parts.length) return '';
  if (parts.length === 1) return `I've included ${parts[0]} below for a quick skim.`;
  return `I've included ${parts.slice(0,-1).join(', ')} and ${parts.slice(-1)} below for a quick skim.`;
}

// Clickable links block under the body
function quickLinksHtml(brand){
  if (!brand.assets?.length) return '';
  const rows = brand.assets.map(a =>
    `<div style="margin:2px 0;"><a href="${a.url}" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:none;">${esc(a.title)}</a></div>`
  ).join('');
  return `<div style="margin-top:12px;">
    <div style="font-weight:600;margin-bottom:4px;">Quick links</div>${rows}
  </div>`;
}

// Professional email writer with natural resource mention
async function generateAiBody({ project, vibe, cast, location, notes, brand }) {
  const mention = assetsNote(brand);
  const fallback = () => {
    const ideas = brand.integrationIdeas?.length ? ` (${brand.integrationIdeas.join('; ')})` : '';
    return `Hi there—quick note on ${project}. ${brand.name} feels like a strong fit${ideas ? '—'+ideas : ''}. ${brand.whyItWorks||''} ${brand.hbInsights||''} ${mention}`.trim();
  };

  try {
    if (!process.env.OPENAI_API_KEY) return fallback();

    const prompt = `
Write a warm, professional email (5–8 sentences) from an experienced brand integration expert about a potential partnership.
- Sound knowledgeable and confident in the space; avoid hype or marketing fluff.
- Keep sentences tight; prefer concrete film/brand fit over generic fluff.
- Weave in why the brand fits naturally, 1–3 integration ideas, and any insights.
- Briefly reference available resources once: "${mention || '(none)'}".
- Do NOT include a subject, signature, or placeholders.
- Do NOT add a "Links" section; links will be appended below.
- Write as if you're reaching out directly, not as a formal pitch.

Project: ${project}
Vibe: ${vibe}
Cast: ${cast}
Location: ${location}
Notes from sender: ${notes || '(none)'}
Brand: ${brand.name}
Why it works: ${brand.whyItWorks || '-'}
Integration ideas: ${brand.integrationIdeas?.join(' | ') || '-'}
Insights: ${brand.hbInsights || '-'}
Additional context: ${brand.contentText || '-'}
`.trim();

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":`Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role:"system", content:"You write concise, personable business emails from an experienced Hollywood brand integration expert." },
          { role:"user", content: prompt }
        ],
        temperature: 0.55
      })
    });
    if (!resp.ok) return fallback();
    const json = await resp.json();
    return json?.choices?.[0]?.message?.content?.trim() || fallback();
  } catch { return fallback(); }
}

// ---------- handler ----------
export default async function handler(req, res) {
  applyCORS(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const body = req.body || {};
    
    const brandsRaw = Array.isArray(body.brands) ? body.brands : [];
    
    console.log('[pushDraft] brands:', brandsRaw.length);
    
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

    // --- ALWAYS SPLIT: one draft per brand ---
    const results = [];
    for (const b of brands) {
      try {
        // Log brand assets for debugging
        console.log('[pushDraft] brand', b.name, 'assets in:', (b.assets||[]).length, 
                    (b.assets||[]).map(x => `${x.type}:${x.url}`).slice(0,4));
        
        const bodyText = await generateAiBody({
          project: projectName, vibe, cast, location, notes, brand: b
        });
        
        const htmlBody = `
<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;max-width:720px;">
  ${bodyText.split('\n').map(line=>`<div>${esc(line)}</div>`).join('')}
  ${quickLinksHtml(b)}
</div>`.trim();

        // Log if Quick links made it into HTML
        console.log('[pushDraft] html has links?', htmlBody.includes('Quick links'));

        const subject = `[Pitch] ${projectName} — ${b.name || 'Brand'}`;
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
  } catch (err) {
    applyCORS(req, res);
    return res.status(500).json({ error: "Failed to push draft", details: err?.message || String(err) });
  }
}
