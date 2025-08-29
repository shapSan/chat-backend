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

// HubSpot API key for resolving user IDs
const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const HUBSPOT_BASE_URL = 'https://api.hubapi.com';

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

// ADDED: send the draft you just created
async function sendDraftMessage({ messageId, senderEmail }) {
  const { access_token } = await getGraphToken();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/messages/${encodeURIComponent(messageId)}/send`;
  const resp = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${access_token}` } });
  if (!resp.ok) throw new Error(`Send failed: ${resp.status} ${await resp.text()}`);
}

// ADDED: send a simple notification email (separate from the pitch)
async function sendSimpleMail({ subject, htmlBody, to, senderEmail }) {
  const { access_token } = await getGraphToken();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`;
  const payload = {
    message: {
      subject,
      body: { contentType: "HTML", content: htmlBody },
      toRecipients: (to || []).slice(0, 10).map(email => ({ emailAddress: { address: email } })),
    },
    saveToSentItems: true
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`Notify send failed: ${resp.status} ${await resp.text()}`);
}

// ---------- HubSpot User Resolution ----------
async function resolveHubSpotUsers(brands) {
  if (!HUBSPOT_API_KEY) return brands;
  
  // Collect unique user IDs from all brands
  const userIds = new Set();
  brands.forEach(b => {
    if (b.secondaryOwnerId) userIds.add(b.secondaryOwnerId);
    if (b.specialtyLeadId) userIds.add(b.specialtyLeadId);
  });
  
  if (userIds.size === 0) return brands;
  
  // Fetch user details from HubSpot
  const userMap = {};
  for (const userId of userIds) {
    try {
      const response = await fetch(
        `${HUBSPOT_BASE_URL}/settings/v3/users/${userId}`,
        {
          headers: {
            'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.ok) {
        const userData = await response.json();
        userMap[userId] = {
          email: userData.email,
          firstName: userData.firstName || userData.email?.split('@')[0] || 'there'
        };
      }
    } catch (e) {
      console.log(`[resolveHubSpotUsers] Could not resolve user ${userId}:`, e.message);
    }
  }
  
  // Enhance brands with resolved contact info
  return brands.map(b => ({
    ...b,
    primaryContact: b.secondaryOwnerId ? userMap[b.secondaryOwnerId] : null,
    secondaryContact: b.specialtyLeadId ? userMap[b.specialtyLeadId] : null
  }));
}

// ---------- helpers ----------
const esc = (s="") => String(s).replace(/[<&>]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const isHttp = u => typeof u==='string' && /^https?:\/\//i.test(u) && u.length < 1000;
const trim = (s,n=1400)=>String(s||'').slice(0,n);
const normIdeas = v => Array.isArray(v) ? v : v ? String(v).split(/\n|•|- |\u2022/).map(x=>x.trim()).filter(Boolean) : [];

// ALWAYS-CC list (added to every draft)
const ALWAYS_CC = [
  "jo@hollywoodbranded.com",
  "roman.rida@selfrun.ai",
  "ian@hollywoodbranded.com",
  "stacy@hollywoodbranded.com",
];

// dedupe while preserving first-seen order
function dedupeEmails(list = []) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const email = typeof v === "string" ? v.trim() : "";
    if (!email) continue;
    const key = email.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(email);
    }
  }
  return out;
}

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
    assets,
    isInSystem: b.isInSystem || false,  // Preserve the isInSystem flag
    oneSheetLink: b.oneSheetLink || b.one_sheet_link || null,  // Include one-sheet link
    secondaryOwnerId: b.secondaryOwnerId || null,  // Preserve for resolution
    specialtyLeadId: b.specialtyLeadId || null  // Preserve for resolution
  };
}

// Natural one-liner that references resources, used inside the email
function assetsNote(brand){
  const t = (brand.assets||[]).map(a=>a.type);
  const parts = [];
  if (t.includes('audio')) parts.push('a quick audio pitch');
  if (t.includes('video')) parts.push('a short video');
  if (t.includes('pdf'))   parts.push('the proposal PDF');
  if (t.includes('image')) parts.push('a one-sheet/poster');
  if (!parts.length) return '';
  if (parts.length === 1) return `I've included ${parts[0]} below for a quick skim.`;
  return `I've included ${parts.slice(0,-1).join(', ')} and ${parts.slice(-1)} below for a quick skim.`;
}

// Clean project name to remove common suffixes
function cleanProjectName(name) {
  if (!name) return 'Project';
  // Remove common trailing words that shouldn't be in the project name
  return name.replace(/\s*(Synopsis|Description|Overview|Summary|Details?)\s*$/i, '').trim() || name;
}

// Clickable links block under the body
function quickLinksHtml(brand){
  if (!brand.assets?.length) return '';
  const rows = brand.assets.map(a =>
    `<p style="margin:4px 0;"><a href="${a.url}" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:none;font-size:14px;">${esc(a.title)}</a></p>`
  ).join('');
  return `
    <div style="margin-top:24px;padding-top:16px;">
      <p style="font-weight:600;margin:0 0 8px 0;font-size:14px;">Quick links</p>
      ${rows}
    </div>`;
}

// Professional email writer with natural resource mention
async function generateAiBody({ project, vibe, cast, location, notes, brand, isInSystem, recipientName, distributor, releaseDate, oneSheetLink }) {
  const mention = assetsNote(brand);
  
  // Clean the project name
  const cleanedProject = cleanProjectName(project);
  
  // Use recipientName throughout
  const greeting = recipientName && recipientName !== '[First Name]' ? `Hi ${recipientName}` : 'Hi [First Name]';
  
  // Format distributor/release for email
  const distributorText = distributor && distributor !== '[Distributor/Studio]' ? distributor : '[Distributor/Studio]';
  const releaseDateText = releaseDate && releaseDate !== '[Release Date]' ? releaseDate : '[Release Date]';
  
  // Different fallback templates based on whether brand is in system
  const fallback = () => {
    const ideas = brand.integrationIdeas?.length ? brand.integrationIdeas[0] : '';
    
    if (isInSystem) {
      // VERSION 2: Warmer email for existing clients
      return `${greeting},\n\nGreat news! We have an exciting opportunity with ${cleanedProject} that aligns perfectly with ${brand.name}.\n\n${brand.whyItWorks || `Given our successful past collaborations, this ${vibe} production would be an ideal fit for ${brand.name}.`}\n\n${ideas ? `Building on our relationship: ${ideas}` : `We see natural integration opportunities that build on ${brand.name}'s previous successes.`}\n\n${mention ? mention + ' ' : ''}Let's catch up soon to explore how we can make this happen together.\n\nBest,\nStacy`.trim();
    } else {
      // VERSION 1: New brand email template from user's requirements
      const integrationIdea = ideas || '[Integration Idea]';
      const whyItWorks = brand.whyItWorks || '[Why it works]';
      
      return `${greeting},\n\nSeveral of our brand partners are evaluating opportunities around ${cleanedProject} (${distributorText}, releasing ${releaseDateText}). The project ${whyItWorks}.\n\nWe see a strong alignment with ${brand.name} and wanted to share how this could look:\n\nQuick Links: [Poster], [Audio Pitch], [Video], [Proposal], [Slides]${oneSheetLink ? `, [One Sheet: ${oneSheetLink}]` : ''}\n\n• On-Screen Integration: ${integrationIdea} (Scene/placement opportunities from one-sheet).\n• Content Extensions: [Capsule collection, co-promo, social/behind-the-scenes content]. Ie - Co-branded merchandise, social campaigns with the cast, or exclusive partner activations.\n• Amplification: [PR hooks, retail tie-ins, influencer/media activations].\n\nThis is exactly what we do at Hollywood Branded. We've delivered over 10,000 campaigns across film, TV, music, sports, and influencer marketing - including global partnerships that turned integrations into full marketing platforms.\n\nWould you be open to a quick call so we can walk you through how we partner with brands to unlock opportunities like this and build a long-term Hollywood strategy?\n\nBest,\nStacy`.trim();
    }
  };

  try {
    if (!process.env.OPENAI_API_KEY) return fallback();

    // Smart prompt that follows the exact template structure
    const integrationIdea = (brand.integrationIdeas && brand.integrationIdeas[0]) || 'Strategic product placement';
    const whyItWorks = brand.whyItWorks || 'Natural brand fit';
    
    const prompt = `
Generate a professional brand integration email. IMPORTANT: Follow the template EXACTLY.

${isInSystem ? 'VERSION 2: EXISTING CLIENT (warm, relationship-focused)' : 'VERSION 1: NEW BRAND (use exact template below)'}

${!isInSystem ? `TEMPLATE TO FOLLOW EXACTLY:
"${greeting},

Several of our brand partners are evaluating opportunities around ${cleanedProject} (${distributorText}, releasing ${releaseDateText}). The project ${whyItWorks}.

We see a strong alignment with ${brand.name} and wanted to share how this could look:

Quick Links: [Keep as placeholders]

• On-Screen Integration: [Expand from: ${integrationIdea}] 
• Content Extensions: [Generate specific ideas based on brand: ${brand.name} and genre: ${vibe}]
• Amplification: [Generate PR/retail/influencer ideas]

This is exactly what we do at Hollywood Branded. We've delivered over 10,000 campaigns across film, TV, music, sports, and influencer marketing - including global partnerships that turned integrations into full marketing platforms.

Would you be open to a quick call so we can walk you through how we partner with brands to unlock opportunities like this and build a long-term Hollywood strategy?

Best,
Stacy"

Fill in the bracketed sections intelligently. Keep the structure EXACTLY as shown.` : `
Write warm relationship email mentioning past success and new opportunity.`}

Project: ${cleanedProject}
Brand: ${brand.name}
Genre: ${vibe}
Cast: ${cast || 'TBD'}
`.trim();

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":`Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role:"system", content: isInSystem ? 
            "Write warm, relationship-focused emails for existing clients. Be concise and professional." :
            "Follow the email template EXACTLY as provided. Fill in bracketed sections intelligently based on the brand and production context." },
          { role:"user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 800
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
    console.log('[pushDraft TRACE 5] Raw `brands` array received from frontend:', JSON.stringify(brandsRaw, null, 2));
    console.log('[pushDraft] brands:', brandsRaw.length);

    const pd = body.productionData && typeof body.productionData === "object" ? body.productionData : {};
    const projectName = cleanProjectName(body.projectName ?? pd.projectName ?? "Project");
    const cast = body.cast ?? pd.cast ?? "";
    const location = body.location ?? pd.location ?? "";
    const vibe = body.vibe ?? pd.vibe ?? "";
    const notes = body.notes ?? pd.notes ?? "";

    const toRecipients = Array.isArray(body.to) && body.to.length ? body.to.slice(0, 10) : ["shap@hollywoodbranded.com"];

    // optional flags
    const sendNow = !!body.sendNow || !!body.send;     // send the draft immediately
    const notifyWatchers = !!body.notifyWatchers;      // send separate FYI email to ALWAYS_CC

    // merge request CCs + always-CC, dedupe, cap 10
    const requestedCC = Array.isArray(body.cc) ? body.cc.slice(0, 10) : [];
    const ccRecipients = dedupeEmails([...requestedCC, ...ALWAYS_CC]).slice(0, 10);

    const senderEmail = body.senderEmail || "shap@hollywoodbranded.com";

    if (!brandsRaw.length) return res.status(400).json({ error: "No brands provided" });

    const brands = brandsRaw.map(sanitizeBrand).slice(0, 10); // safety cap
  
  // Resolve HubSpot user IDs to contact information
  const brandsWithContacts = await resolveHubSpotUsers(brands);
  console.log('[pushDraft] Resolved contacts for', brandsWithContacts.filter(b => b.primaryContact).length, 'brands');

    // --- ALWAYS SPLIT: one draft per brand ---
    const results = [];
    for (const b of brandsWithContacts) {
      try {
      console.log('[pushDraft] brand', b.name, 'has assets:', b.assets);
      console.log('[pushDraft] assets count:', (b.assets||[]).length);

      // Check if brand is in system (has isInSystem flag)
      const isInSystem = b.isInSystem || false;
      console.log('[pushDraft] Brand', b.name, 'isInSystem:', isInSystem);
      
      // Use resolved contact name or fallback
      const recipientName = b.primaryContact?.firstName || '[First Name]';
      const recipientEmail = b.primaryContact?.email || null;
      console.log('[pushDraft] Using recipient name:', recipientName);
      console.log('[pushDraft] Using recipient email:', recipientEmail);
      console.log('[pushDraft] Primary contact:', b.primaryContact);
      console.log('[pushDraft] Secondary contact:', b.secondaryContact);
      
      // Include distributor and release date from production data
      const distributor = pd.distributor || '[Distributor/Studio]';
      const releaseDate = pd.releaseDate ? new Date(pd.releaseDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '[Release Date]';
      console.log('[pushDraft] Distributor:', distributor);
      console.log('[pushDraft] Release date:', releaseDate);
      
      const bodyText = await generateAiBody({ 
        project: projectName, 
        vibe, 
        cast, 
        location, 
        notes, 
        brand: b,
        isInSystem, // Pass the flag to email generator
        recipientName, // Pass resolved name
        distributor, // Pass distributor
        releaseDate, // Pass release date
        oneSheetLink: b.oneSheetLink || b.one_sheet_link // Pass one-sheet link
      });

        const paragraphs = bodyText.split('\n').filter(line => line.trim());
        const formattedBody = paragraphs.map(para =>
          `<p style="margin:0 0 16px 0;">${esc(para)}</p>`
        ).join('');

        // Build Quick links section - ALWAYS include if there are assets
        let quickLinksSection = '';
        if (b.assets && b.assets.length > 0) {
          const linkItems = b.assets.map(a =>
            `<p style="margin:4px 0;"><a href="${a.url}" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:none;">${esc(a.title)}</a></p>`
          ).join('');
          quickLinksSection = `
            <div style="margin-top:24px;padding-top:16px;">
              <p style="font-weight:600;margin:0 0 8px 0;">Quick links</p>
              ${linkItems}
            </div>`;
        }

        const htmlBody = `
<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;max-width:720px;">
  ${formattedBody}
  ${quickLinksSection}
</div>`.trim();

        console.log('[pushDraft] html includes Quick links?', htmlBody.includes('Quick links'));
        console.log('[pushDraft] quickLinksSection:', quickLinksSection ? 'YES' : 'NO');

        const subject = `[Agent Pitch] ${projectName} — ${b.name || 'Brand'}`;
        
        // Use the resolved email if available, otherwise use default
        const draftRecipients = recipientEmail ? [recipientEmail] : toRecipients;
        
        // Build CC list with resolved contacts
        const brandCCs = [];
        if (b.primaryContact?.email && !draftRecipients.includes(b.primaryContact.email)) {
          brandCCs.push(b.primaryContact.email);
        }
        if (b.secondaryContact?.email) {
          brandCCs.push(b.secondaryContact.email);
        }
        const finalCCList = dedupeEmails([...brandCCs, ...ccRecipients]).slice(0, 10);
        console.log('[pushDraft] Final CC list:', finalCCList);
        
        const draft = await createDraftInMailbox({
          subject,
          htmlBody,
          to: draftRecipients,
          cc: finalCCList,
          senderEmail,
        });

        // optionally send the draft now
        let sent = false;
        if (sendNow && draft?.id) {
          try {
            await sendDraftMessage({ messageId: draft.id, senderEmail });
            sent = true;
          } catch (e) {
            console.error('[pushDraft] send failed:', e);
          }
        }

        // optionally notify the watchers that a draft exists (separate email)
        if (notifyWatchers) {
          try {
            const linkHtml = draft?.webLink ? `<p><a href="${draft.webLink}" target="_blank" rel="noopener">Open draft</a></p>` : '';
            await sendSimpleMail({
              subject: `Draft ready: ${subject}`,
              htmlBody: `<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;max-width:720px;">
                <p>A draft for <b>${esc(b.name || 'Brand')}</b> on <b>${esc(projectName)}</b> is ready.</p>
                ${linkHtml}
              </div>`,
              to: ALWAYS_CC,
              senderEmail,
            });
          } catch (e) {
            console.error('[pushDraft] notifyWatchers failed:', e);
          }
        }

        results.push({ brand: b.name || "Brand", subject, webLink: draft.webLink || null, sent });
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
