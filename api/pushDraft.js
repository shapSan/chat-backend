// /api/pushDraft.js — split mode, sanitized URLs, resilient OpenAI fallback
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };
export const maxDuration = 60; // 1 minute for email generation

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
// secondary_owner and specialty_lead are USER IDs (internal team members)
async function resolveHubSpotUsers(brands, onStep = () => {}) {
  if (!HUBSPOT_API_KEY) {
    console.log('[pushDraft TRACE 3.1] HubSpot API key not configured. Skipping resolution.');
    onStep({ type: 'info', text: 'HubSpot API not configured - using default recipients.' });
    return brands;
  }
  
  // Collect unique User IDs from all brands - all 4 owner types
  const userIds = new Set();
  brands.forEach(b => {
    if (b.secondaryOwnerId) userIds.add(b.secondaryOwnerId);
    if (b.specialtyLeadId) userIds.add(b.specialtyLeadId);
    if (b.partnershipsLeadId) userIds.add(b.partnershipsLeadId);
    if (b.hubspotOwnerId) userIds.add(b.hubspotOwnerId);
  });
  
  // --- TRACE 3.2: Log unique IDs found ---
  console.log('[pushDraft TRACE 3.2] Found unique HubSpot User IDs to resolve:', Array.from(userIds));
  
  if (userIds.size === 0) {
    onStep({ type: 'info', text: 'No HubSpot contacts to resolve - using default recipients.' });
    console.log('[pushDraft] No HubSpot user IDs found, will use default recipients');
    return brands;
  }
  
  onStep({ type: 'process', text: `Resolving ${userIds.size} HubSpot contact(s)...` });
  console.log(`[pushDraft] Resolving ${userIds.size} unique HubSpot user IDs`);
  
  // Fetch User details from HubSpot
  const userMap = {};
  let successCount = 0;
  let failCount = 0;
  
  for (const userId of userIds) {
    try {
      // --- TRACE 3.3: Log each API call ---
      console.log(`[pushDraft TRACE 3.3] Querying HubSpot for User ID: ${userId}`);
      
      const response = await fetch(
        `${HUBSPOT_BASE_URL}/crm/v3/owners/${userId}`,
        {
          headers: {
            'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.ok) {
        const userData = await response.json();
        // For Users, firstName is the right field
        const firstName = userData.firstName || 
                         userData.email?.split('@')[0] || 
                         null;
        
        userMap[userId] = {
          email: userData.email,
          firstName: firstName
        };
        successCount++;
        // --- TRACE 3.4: Log successful resolution ---
        console.log(`[pushDraft TRACE 3.4] SUCCESS - Resolved ${userId} to: ${firstName} <${userData.email}>`);
      } else {
        failCount++;
        // --- TRACE 3.5: Log failed resolution ---
        console.error(`[pushDraft TRACE 3.5] FAILED to fetch user ${userId}. Status: ${response.status}`);
        onStep({ type: 'warning', text: `Could not resolve contact ID ${userId}.` });
      }
    } catch (e) {
      failCount++;
      // --- TRACE 3.6: Log errors ---
      console.error(`[pushDraft TRACE 3.6] ERROR resolving user ${userId}:`, e.message);
      onStep({ type: 'error', text: `API error resolving contact ID ${userId}.` });
    }
  }
  
  // --- TRACE 3.7: Log final user map ---
  console.log('[pushDraft TRACE 3.7] Final resolved user map:', userMap);
  
  // Report final status
  if (successCount > 0) {
    onStep({ type: 'result', text: `✓ Resolved ${successCount} of ${userIds.size} contacts successfully.` });
  } else {
    onStep({ type: 'warning', text: 'Could not resolve any HubSpot contacts - using defaults.' });
  }
  
  // Enhance brands with resolved user info - all 4 contact types
  return brands.map(b => ({
    ...b,
    contacts: {
      secondaryOwner: b.secondaryOwnerId ? userMap[b.secondaryOwnerId] : null,
      specialtyLead: b.specialtyLeadId ? userMap[b.specialtyLeadId] : null,
      partnershipsLead: b.partnershipsLeadId ? userMap[b.partnershipsLeadId] : null,
      hubspotOwner: b.hubspotOwnerId ? userMap[b.hubspotOwnerId] : null
    },
    // Keep backward compatibility
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
  console.log('[sanitizeBrand] Input brand:', {
    name: b.name || b.brand,
    hasAssets: !!b.assets,
    assetsCount: b.assets?.length || 0,
    hasPosterUrl: !!b.posterUrl,
    hasVideoUrl: !!(b.videoUrl || b.exportedVideo),
    hasAudioUrl: !!b.audioUrl,
    hasPdfUrl: !!(b.pdfUrl || b.brandCardPDF),
    hasSlidesUrl: !!b.slidesUrl
  });
  
  const base = [];
  // fold any top-level url fields
  if (isHttp(b.videoUrl || b.exportedVideo)) {
    const url = b.videoUrl || b.exportedVideo;
    base.push({type:'video', url, title:'Video'});
    console.log('[sanitizeBrand] Added video:', url);
  }
  if (isHttp(b.pdfUrl || b.brandCardPDF)) {
    const url = b.pdfUrl || b.brandCardPDF;
    base.push({type:'pdf', url, title:'Proposal PDF'});
    console.log('[sanitizeBrand] Added PDF:', url);
  }
  if (isHttp(b.audioUrl)) {
    base.push({type:'audio', url:b.audioUrl, title:'Audio Pitch'});
    console.log('[sanitizeBrand] Added audio:', b.audioUrl);
  }
  if (isHttp(b.posterUrl)) {
    base.push({type:'image', url:b.posterUrl, title:'Poster'});
    console.log('[sanitizeBrand] Added poster:', b.posterUrl);
  }
  if (isHttp(b.slidesUrl)) {
    base.push({type:'link', url:b.slidesUrl, title:'Slides'});
    console.log('[sanitizeBrand] Added slides:', b.slidesUrl);
  }

  const extras = (Array.isArray(b.assets)?b.assets:[])
    .filter(a => a && isHttp(a.url))
    .slice(0, 12)
    .map(classifyAsset);

  // de-dupe by url
  const seen = new Set(); const assets = [];
  [...base, ...extras].forEach(a => { if (!seen.has(a.url)) { seen.add(a.url); assets.push(a); } });
  
  console.log('[sanitizeBrand] Final assets array:', assets.length, 'items', assets);

  // Check for both camelCase and snake_case versions for all 4 owner fields
  // Also check in the properties object if it exists
  const secondaryOwnerId = b.secondaryOwnerId || b.secondary_owner || b.properties?.secondary_owner || null;
  const specialtyLeadId = b.specialtyLeadId || b.specialty_lead || b.properties?.specialty_lead || null;
  const partnershipsLeadId = b.partnershipsLeadId || b.partnerships_lead || b.properties?.partnerships_lead || null;
  const hubspotOwnerId = b.hubspotOwnerId || b.hubspot_owner_id || b.properties?.hubspot_owner_id || null;
  
  console.log('[sanitizeBrand] Extracted IDs:', {
    secondaryOwnerId,
    specialtyLeadId,
    partnershipsLeadId,
    hubspotOwnerId
  });

  return {
    name: b.name || b.brand || '',
    whyItWorks: trim(b.whyItWorks),
    hbInsights: trim(b.hbInsights),
    integrationIdeas: normIdeas(b.integrationIdeas).slice(0,8).map(x=>trim(x,200)),
    contentText: trim(Array.isArray(b.content)? b.content.join('\n') : b.content, 2000),
    assets,
    isInSystem: b.isInSystem || false,  // Preserve the isInSystem flag
    oneSheetLink: b.oneSheetLink || b.one_sheet_link || null,  // Include one-sheet link
    secondaryOwnerId: secondaryOwnerId,  // Client Team Lead
    specialtyLeadId: specialtyLeadId,    // Specialty Lead
    partnershipsLeadId: partnershipsLeadId,  // Partnerships Lead
    hubspotOwnerId: hubspotOwnerId      // Primary Owner
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
async function generateAiBody({ project, vibe, cast, location, notes, brand, isInSystem, recipientName, distributor, releaseDate, productionStartDate, productionType, synopsis, oneSheetLink }) {
  const mention = assetsNote(brand);
  
  // Clean the project name
  const cleanedProject = cleanProjectName(project);
  
  // Use recipientName throughout
  const greeting = recipientName && recipientName !== '[First Name]' ? `Hi ${recipientName}` : 'Hi [First Name]';
  
  // Format all production data for email - USE THE ACTUAL DATA
  const distributorText = distributor || '[Distributor/Studio]';
  const releaseDateText = releaseDate || '[Release Date]';
  const productionStartText = productionStartDate || '[Production Start Date]';
  const productionTypeText = productionType || '[Production Type]';
  const locationText = location || '[Location]';
  const castText = cast || '[Cast]';
  
  // BUILD THE EXACT TEMPLATE
  const buildTemplate = () => {
    // Dynamically get the Integration Idea from the brand object
    const onScreenIntegrationText = brand.integrationIdeas?.length 
      ? brand.integrationIdeas[0] 
      : '[Scene/placement opportunities from one-sheet]';
    
    const whyItWorks = brand.whyItWorks || `is a ${vibe.toLowerCase()} ${productionTypeText.toLowerCase()} that aligns with your brand`;
    
    if (isInSystem) {
      // VERSION 2 — BRAND ALREADY IN SYSTEM [HB]BOX SYSTEM
      // Extract specific content ideas from brand data or use smart defaults
      let integrationOps = '[On-screen/scripted moments or character tie-ins from one-sheet]';
      let extensions = '[Merchandise, digital content, cast/social campaigns]';
      let amplification = '[Studio/global visibility + PR, retail, influencer activations]';
      
      if (brand.integrationIdeas?.length) {
        integrationOps = onScreenIntegrationText;
        if (brand.integrationIdeas.length > 1) extensions = brand.integrationIdeas[1];
        if (brand.integrationIdeas.length > 2) amplification = brand.integrationIdeas[2];
      } else if (vibe) {
        // Generate smart defaults based on genre/vibe for existing clients
        const vibeLower = vibe.toLowerCase();
        if (vibeLower.includes('horror') || vibeLower.includes('scary')) {
          integrationOps = 'Key product moments in suspense sequences aligned with brand safety guidelines';
          extensions = 'Halloween activation package, exclusive fan experiences, limited merchandise';
          amplification = 'Genre media blitz, specialty retail exclusives, horror influencer partnerships';
        } else if (vibeLower.includes('action')) {
          integrationOps = 'Hero product integration with stunt sequences and action set pieces';
          extensions = 'Adrenaline-focused content series, BTS stunt footage, adventure gear line';
          amplification = 'Global studio push, action sports partnerships, high-octane influencer content';
        } else if (vibeLower.includes('comedy')) {
          integrationOps = 'Organic brand moments woven into comedic beats';
          extensions = 'Viral content with cast, comedy club partnerships, fun merchandise';
          amplification = 'Mainstream media push, retail comedy campaigns, comedian partnerships';
        } else if (vibeLower.includes('drama')) {
          integrationOps = 'Meaningful brand integration into character arcs';
          extensions = 'Prestige content series, emotional storytelling campaigns';
          amplification = 'Awards season push, premium retail placements, thoughtful influencer strategy';
        }
      }
      
      return `${greeting},

As part of the opportunities currently being evaluated by several of our brand partners, **${cleanedProject}** (${distributorText}, releasing ${releaseDateText}) stands out as a strong potential fit for ${brand.name}.
**Quick Links:** [Keep as placeholders]

Here's how it could look:

• **Integration Opportunities:** ${integrationOps}.
• **Extensions:** ${extensions}.
• **Amplification:** ${amplification}.

This is exactly the type of opportunity surfaced through your **Playbook + Radar**. Once you greenlight through Access, we can move into securing the placement and building out extensions. From there, we layer in Produce (content creation) and Amplify (PR/media/retail) to turn it into a full campaign platform.

Let's set up a working session to map this one — or we can review additional opportunities currently in your pipeline.

Best,
Stacy`.trim();
    } else {
      // VERSION 1 — BRAND NOT IN SYSTEM (Intro + Opportunity + HB Credibility)
      // Quick description - use actual data or brand.whyItWorks
      let quickDescription = '';
      if (brand.whyItWorks && brand.whyItWorks !== '[quick description from one-sheet - e.g., "is a globally recognized franchise with multi-generational appeal"]') {
        quickDescription = brand.whyItWorks;
      } else if (vibe) {
        // Generate description based on vibe/genre
        quickDescription = `is a ${vibe.toLowerCase()} ${productionTypeText.toLowerCase() || 'production'}`;
      } else {
        quickDescription = '[quick description from one-sheet - e.g., "is a globally recognized franchise with multi-generational appeal"]';
      }
      
      // Use brand's actual integration ideas with onScreenIntegrationText
      let onScreenIntegration = onScreenIntegrationText;
      let contentExtensions = '[Capsule collection, co-promo, social/behind-the-scenes content]';
      let amplificationText = '[PR hooks, retail tie-ins, influencer/media activations]';
      
      if (brand.integrationIdeas?.length) {
        // onScreenIntegration already set to onScreenIntegrationText above
        if (brand.integrationIdeas.length > 1) contentExtensions = brand.integrationIdeas[1];
        if (brand.integrationIdeas.length > 2) amplificationText = brand.integrationIdeas[2];
      } else if (vibe) {
        // Generate smart defaults based on genre/vibe
        const vibeLower = vibe.toLowerCase();
        if (vibeLower.includes('horror') || vibeLower.includes('scary')) {
          onScreenIntegration = 'Strategic product placement in key suspense scenes';
          contentExtensions = 'Limited edition Halloween merchandise, themed social campaigns';
          amplificationText = 'Horror fan PR hooks, specialty retail tie-ins, genre influencer activations';
        } else if (vibeLower.includes('action')) {
          onScreenIntegration = 'Hero product integration in action sequences';
          contentExtensions = 'Adventure gear collection, behind-the-scenes stunt content';
          amplificationText = 'Action sports PR, outdoor retail tie-ins, stunt team social content';
        } else if (vibeLower.includes('comedy')) {
          onScreenIntegration = 'Natural brand moments in comedic scenes';
          contentExtensions = 'Fun merchandise line, viral social content with cast';
          amplificationText = 'Comedy PR angles, mainstream retail, comedian influencer activations';
        } else if (vibeLower.includes('drama')) {
          onScreenIntegration = 'Authentic brand integration into character stories';
          contentExtensions = 'Premium collection, emotional storytelling content';
          amplificationText = 'Prestige media PR, upscale retail partnerships, thoughtful influencer campaigns';
        }
      }
      
      return `${greeting},

Several of our brand partners are evaluating opportunities around **${cleanedProject}** (${distributorText}, releasing ${releaseDateText}). The project ${quickDescription}.
**Quick Links:** [Keep as placeholders]

We see a strong alignment with **${brand.name}** and wanted to share how this could look:

• **On-Screen Integration:** ${onScreenIntegration}.
• **Content Extensions:** ${contentExtensions}.
• **Amplification:** ${amplificationText}.

This is exactly what we do at **Hollywood Branded**. We've delivered over 10,000 campaigns across film, TV, music, sports, and influencer marketing - including global partnerships that turned integrations into full marketing platforms.

Would you be open to a quick call so we can walk you through how we partner with brands to unlock opportunities like this and build a long-term Hollywood strategy?

Best,
Stacy`.trim();
    }
  };

  // SKIP AI - just use the template directly
  return buildTemplate();
  
  /* DISABLED - AI keeps fucking it up
  try {
    if (!process.env.OPENAI_API_KEY) return buildTemplate();

    // Get the exact template first
    const templateEmail = buildTemplate();
    
    // Extract key info for AI to use
    const integrationIdea = (brand.integrationIdeas && brand.integrationIdeas[0]) || 'Strategic product placement';
    const whyItWorks = brand.whyItWorks || 'Natural brand fit';
    
    const prompt = isInSystem ? 
      // VERSION 2: Existing client prompt - LIGHT REWRITE ONLY
      `Take this EXACT email template and make it flow naturally. You may ONLY make minor wording adjustments:

${templateEmail}

RULES:
1. Keep the exact same structure and length
2. Keep greeting as "${greeting},"
3. Keep sign-off as "Best,\nStacy"
4. DO NOT add "I hope this finds you well" or similar pleasantries
5. DO NOT add new sentences or ideas
6. Just make the existing text flow smoothly` :
      // VERSION 1: New brand template - Fill in specific ideas ONLY
      `Take this email and ONLY improve the Content Extensions and Amplification bullets with specific ideas:

${templateEmail}

RULES:
1. KEEP EVERYTHING ELSE EXACTLY THE SAME
2. For "Content Extensions" bullet: Replace the generic ideas with 2-3 specific ones for ${brand.name} in a ${vibe || 'entertainment'} context
3. For "Amplification" bullet: Make the PR/retail/influencer ideas specific to ${brand.name}
4. DO NOT change the opening paragraph
5. DO NOT change the closing paragraph
6. DO NOT add "I hope this finds you well" or any pleasantries
7. Keep the exact same structure`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":`Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role:"system", content: "You are a professional email editor. Your ONLY job is to make minor adjustments to existing email templates. You MUST preserve the exact structure, length, and key phrases. Never add pleasantries like 'I hope this finds you well'. Never add new paragraphs. Only make the minimal changes requested." },
          { role:"user", content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 800
      })
    });
    if (!resp.ok) {
      console.log('[generateAiBody] OpenAI API failed, using fallback template');
      return buildTemplate();
    }
    const json = await resp.json();
    const aiResponse = json?.choices?.[0]?.message?.content?.trim();
    
    // Validate that AI followed instructions
    if (aiResponse) {
      // Check for forbidden phrases that indicate AI went off-script
      const forbiddenPhrases = [
        'I hope this finds you well',
        'I hope this message finds you',
        'thrilling news',
        'exciting to share',
        'trust you are doing well',
        'wonderful opportunity',
        'delighted to',
        'pleasure to'
      ];
      
      for (const phrase of forbiddenPhrases) {
        if (aiResponse.toLowerCase().includes(phrase.toLowerCase())) {
          console.log(`[generateAiBody] AI added forbidden phrase: "${phrase}" - using fallback`);
          return buildTemplate();
        }
      }
      
      // For new brands, check key phrases are preserved
      if (!isInSystem) {
        const requiredPhrases = [
          'Several of our brand partners are evaluating',
          'We see a strong alignment',
          'This is exactly what we do at Hollywood Branded'
        ];
        
        for (const phrase of requiredPhrases) {
          if (!aiResponse.includes(phrase)) {
            console.log(`[generateAiBody] AI removed required phrase: "${phrase}" - using fallback`);
            return buildTemplate();
          }
        }
      }
      
      // Check if AI made it too long or too short
      const templateLength = templateEmail.length;
      const responseLength = aiResponse.length;
      if (responseLength > templateLength * 1.3 || responseLength < templateLength * 0.7) {
        console.log(`[generateAiBody] AI response wrong length (template: ${templateLength}, response: ${responseLength}) - using fallback`);
        return buildTemplate();
      }
    }
    
    return aiResponse || buildTemplate();
  } catch (e) { 
    console.log('[generateAiBody] Error calling OpenAI:', e.message);
    return buildTemplate(); 
  }
  */
}

// Subject line rotation helper
let subjectCounter = 0;
function getRotatingSubject(projectName, brandName, isInSystem = false) {
  // Different subject lines for brands in system vs not in system
  if (isInSystem) {
    // VERSION 2 - Brand already in system subject lines
    const formats = [
      `Sample Opportunity for ${brandName}: ${projectName}`,
      `Radar Preview: ${projectName} for ${brandName}`,
      `Next Step: Turning ${projectName} Into ${brandName}'s Hollywood Platform`
    ];
    const subject = formats[subjectCounter % 3];
    subjectCounter++;
    return subject;
  } else {
    // VERSION 1 - Brand not in system subject lines
    const formats = [
      `Hollywood Opportunity: ${projectName} x ${brandName}`,
      `Idea Starter: ${projectName} for ${brandName}`,
      `Entertainment Partnership Opportunity for ${brandName}`
    ];
    const subject = formats[subjectCounter % 3];
    subjectCounter++;
    return subject;
  }
}

// ---------- handler ----------
export default async function handler(req, res) {
  applyCORS(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const body = req.body || {};
    // --- TRACE 1: Log incoming payload ---
    console.log('[pushDraft TRACE 1] Received request body:', JSON.stringify(body, null, 2));
    const brandsRaw = Array.isArray(body.brands) ? body.brands : [];
    console.log('[pushDraft TRACE 5] Raw `brands` array received from frontend:', JSON.stringify(brandsRaw, null, 2));
    console.log('[pushDraft] brands:', brandsRaw.length);

    // Extract production data from the payload
    const pd = body.productionData && typeof body.productionData === "object" ? body.productionData : {};
    const projectName = cleanProjectName(body.projectName ?? pd.projectName ?? "Project");
    const cast = body.cast ?? pd.cast ?? "";
    const location = body.location ?? pd.location ?? "";
    const vibe = body.vibe ?? pd.vibe ?? "";
    const notes = body.notes ?? pd.notes ?? "";
    const synopsis = pd.synopsis ?? "";
    
    // Log received production data for debugging
    console.log('[pushDraft] Received production data:', pd);
    console.log('[pushDraft] Extracted fields:', {
        projectName,
        cast,
        location,
        vibe,
        synopsis,
        distributor: pd.distributor,
        releaseDate: pd.releaseDate,
        productionStartDate: pd.productionStartDate,
        productionType: pd.productionType
    });

    const toRecipients = Array.isArray(body.to) && body.to.length ? body.to.slice(0, 10) : ["shap@hollywoodbranded.com"];

    // optional flags
    const sendNow = !!body.sendNow || !!body.send;     // send the draft immediately
    const notifyWatchers = !!body.notifyWatchers;      // send separate FYI email to ALWAYS_CC

    // merge request CCs + always-CC, dedupe, cap 10
    const requestedCC = Array.isArray(body.cc) ? body.cc.slice(0, 10) : [];
    const ccRecipients = dedupeEmails([...requestedCC, ...ALWAYS_CC]).slice(0, 10);

    const senderEmail = body.senderEmail || "shap@hollywoodbranded.com";

    if (!brandsRaw.length) return res.status(400).json({ error: "No brands provided" });

    // First, log the raw data to understand what we're receiving
    console.log('[pushDraft] Raw brand data received:');
    brandsRaw.forEach((b, i) => {
      console.log(`  Brand ${i}:`, {
        name: b.name || b.brand,
        hasSecondaryOwner: !!b.secondary_owner || !!b.secondaryOwnerId,
        hasSpecialtyLead: !!b.specialty_lead || !!b.specialtyLeadId,
        secondary_owner: b.secondary_owner,
        secondaryOwnerId: b.secondaryOwnerId,
        specialty_lead: b.specialty_lead,
        specialtyLeadId: b.specialtyLeadId,
        isInSystem: b.isInSystem,
        hubspotUrl: b.hubspotUrl,
        oneSheetLink: b.oneSheetLink || b.one_sheet_link
      });
    });
    
    const brands = brandsRaw.map(sanitizeBrand).slice(0, 10); // safety cap
  
  // --- TRACE 2: Log brands being passed to HubSpot resolver ---
  console.log('[pushDraft TRACE 2] Brands prepared for HubSpot resolution:', JSON.stringify(brands.map(b => ({ 
    name: b.name, 
    secondaryOwnerId: b.secondaryOwnerId, 
    specialtyLeadId: b.specialtyLeadId 
  })), null, 2));
  
  // Resolve HubSpot user IDs to user information with progress reporting
  const progressSteps = [];
  const brandsWithContacts = await resolveHubSpotUsers(brands, (step) => {
    console.log(`[MCP PROGRESS] ${step.text}`);
    progressSteps.push(step);
    // If a function like `progressPush` is available from body.progressCallback, use it here
    if (typeof body.progressCallback === 'function') {
      body.progressCallback(step);
    }
  });
  console.log('[pushDraft] Resolved users for', brandsWithContacts.filter(b => b.primaryContact).length, 'brands');

    // --- ALWAYS SPLIT: one draft per brand ---
    const results = [];
    for (const b of brandsWithContacts) {
      try {
      console.log('[pushDraft] brand', b.name, 'has assets:', b.assets);
      console.log('[pushDraft] assets count:', (b.assets||[]).length);

      // Check if brand is in system (has isInSystem flag)
      const isInSystem = b.isInSystem || false;
      console.log('[pushDraft] Brand', b.name, 'isInSystem:', isInSystem);
      
      // 1. Determine the recipient's name and email using priority order
      let recipientEmail = null;
      let recipientName = '[First Name]';
      const contacts = b.contacts || {};
      
      // Priority order for main recipient (To:)
      if (contacts.secondaryOwner?.email) {         // Priority 1: Client Team Lead
        recipientEmail = contacts.secondaryOwner.email;
        recipientName = contacts.secondaryOwner.firstName || '[First Name]';
      } else if (contacts.partnershipsLead?.email) { // Priority 2: Partnerships Lead
        recipientEmail = contacts.partnershipsLead.email;
        recipientName = contacts.partnershipsLead.firstName || '[First Name]';
      } else if (contacts.hubspotOwner?.email) {     // Priority 3: Primary Owner
        recipientEmail = contacts.hubspotOwner.email;
        recipientName = contacts.hubspotOwner.firstName || '[First Name]';
      } else if (contacts.specialtyLead?.email) {    // Priority 4: Specialty Lead
        recipientEmail = contacts.specialtyLead.email;
        recipientName = contacts.specialtyLead.firstName || '[First Name]';
      }
      
      const draftRecipients = recipientEmail ? [recipientEmail] : toRecipients;

      // 2. Build the CC list with ALL OTHER resolved contacts
      const brandCCs = new Set();
      Object.values(contacts).forEach(contact => {
        if (contact?.email && contact.email !== recipientEmail) {
          brandCCs.add(contact.email);
        }
      });
      
      // Combine brand-specific CCs with the standard internal list
      const finalCCList = dedupeEmails([...Array.from(brandCCs), ...ccRecipients]).slice(0, 10);
      
      // --- ADD THIS FINAL DIAGNOSTIC LOG ---
      console.log(`[pushDraft TRACE 5] Recipient assignment for brand "${b.name}":`);
      console.log(`  - All Resolved Contacts:`, b.contacts);
      console.log(`  - Primary Recipient (To): ${recipientEmail}`);
      console.log(`  - Brand-Specific Contacts (Cc):`, Array.from(brandCCs));
      console.log(`  - Final CC List (Internal + Brand):`, finalCCList);
      
      // Extract ALL production data fields - prioritize pd over body fields
      const distributor = pd.distributor || body.distributor || '[Distributor/Studio]';
      const releaseDate = pd.releaseDate ? 
        new Date(pd.releaseDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 
        '[Release Date]';
      const productionStartDate = pd.productionStartDate ? 
        new Date(pd.productionStartDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 
        '[Production Start Date]';
      const productionType = pd.productionType || body.productionType || '[Production Type]';
      const productionLocation = location || pd.location || '[Location]';
      const productionCast = cast || pd.cast || '[Cast]';
      const productionVibe = vibe || pd.vibe || '[Vibe]';
      const productionSynopsis = synopsis || pd.synopsis || '';
      
      console.log('[pushDraft] Production Data for email:', {
        distributor,
        releaseDate,
        productionStartDate,
        productionType,
        productionLocation,
        productionCast,
        productionVibe,
        synopsis: productionSynopsis ? productionSynopsis.substring(0, 100) + '...' : 'none'
      });
      
      // --- TRACE 4: Log final recipient lists ---
      console.log(`[pushDraft TRACE 4] Preparing draft for brand "${b.name}"`);
      console.log(`  - TO: ${JSON.stringify(draftRecipients)}`);
      console.log(`  - CC: ${JSON.stringify(finalCCList)}`);
      console.log(`  - GREETING NAME: "${recipientName}"`);
      console.log(`  - IS IN SYSTEM: ${isInSystem}`);
      console.log(`  - PRIMARY CONTACT: ${JSON.stringify(b.primaryContact)}`);
      console.log(`  - SECONDARY CONTACT: ${JSON.stringify(b.secondaryContact)}`);
      
      const bodyText = await generateAiBody({ 
        project: projectName, 
        vibe: productionVibe, 
        cast: productionCast, 
        location: productionLocation, 
        notes, 
        brand: b,
        isInSystem, // Pass the flag to email generator
        recipientName, // Pass resolved name
        distributor, // Pass distributor
        releaseDate, // Pass release date
        productionStartDate, // Pass production start date
        productionType, // Pass production type
        synopsis: productionSynopsis, // Pass synopsis
        oneSheetLink: b.oneSheetLink || b.one_sheet_link // Pass one-sheet link
      });

        const paragraphs = bodyText.split('\n').filter(line => line.trim());
        const formattedBody = paragraphs.map((para, index) => {
          // Convert markdown-style bold to HTML bold
          let formatted = esc(para);
          // Replace **text** with <strong>text</strong>
          formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
          
          // Check if this is a bullet point line
          if (formatted.startsWith('• ')) {
            // Format as a bullet point with proper indentation
            formatted = formatted.substring(2); // Remove the bullet
            return `<p style="margin:0 0 12px 0;padding-left:20px;text-indent:-20px;">• ${formatted}</p>`;
          }
          
          // Add extra spacing before certain sections
          let topMargin = '0';
          if (para.startsWith('We see a strong alignment') || 
              para.startsWith('As part of the opportunities') ||
              para.startsWith("Here's how it could look:")) {
            topMargin = '20px';
          }
          
          return `<p style="margin:${topMargin} 0 16px 0;">${formatted}</p>`;
        }).join('');

        const paragraphsProcessed = paragraphs.map((para, index) => {
          // Convert markdown-style bold to HTML bold
          let formatted = esc(para);
          // Replace **text** with <strong>text</strong>
          formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
          
          // Handle Quick Links line specially - replace placeholder with actual links
          if (formatted.includes('<strong>Quick Links:</strong>')) {
            if (b.assets && b.assets.length > 0) {
              const linkItems = b.assets.map(a => {
                return `<a href="${a.url}" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:none;">${esc(a.title)}</a>`;
              }).join(', ');
              formatted = `<strong>Quick Links:</strong> ${linkItems}`;
            }
            // Otherwise keep the placeholder as is
          }
          
          // Check if this is a bullet point line
          if (formatted.startsWith('• ')) {
            // Format as a bullet point with proper indentation
            formatted = formatted.substring(2); // Remove the bullet
            return `<p style="margin:0 0 12px 0;padding-left:20px;text-indent:-20px;">• ${formatted}</p>`;
          }
          
          // Add extra spacing before certain sections
          let topMargin = '0';
          if (para.startsWith('We see a strong alignment') || 
              para.startsWith('As part of the opportunities') ||
              para.startsWith("Here's how it could look:")) {
            topMargin = '20px';
          }
          
          return `<p style="margin:${topMargin} 0 16px 0;">${formatted}</p>`;
        }).join('');

        const htmlBody = `
<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;max-width:720px;">
  ${paragraphsProcessed}
</div>`.trim();

        console.log('[pushDraft] html includes Quick links?', htmlBody.includes('Quick'));
        console.log('[pushDraft] Assets for Quick Links:', b.assets?.length || 0);

        // Use rotating subject line format based on isInSystem status
        const subject = getRotatingSubject(projectName, b.name || 'Brand', isInSystem);
        console.log('[pushDraft] Using subject:', subject, 'isInSystem:', isInSystem);

        console.log('[pushDraft] TO recipients:', draftRecipients);
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
        // COMMENTED OUT: Notification emails disabled temporarily
        /*
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
        */

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
