// api/pushDraft.js
import fetch from 'node-fetch';
import { o365API } from './chatWithOpenAI.js'; // export your existing o365API from there
import { openai } from './openai-client.js';  // replace with your existing OpenAI client import

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const {
      projectName = 'Project',
      cast = '',
      location = '',
      vibe = '',
      brands = [],
      notes = '',
      to = [],
      cc = [],
      senderEmail = 'stacy@hollywoodbranded.com'
    } = req.body || {};

    if (!Array.isArray(brands) || brands.length === 0) {
      return res.status(400).json({ error: 'No brands provided' });
    }

    // Resolve recipients
    let toRecipients = Array.isArray(to) && to.length ? to.slice(0, 10) : [];
    if (!toRecipients.length) {
      toRecipients = ['stacy@hollywoodbranded.com', 'shap@hollywoodbranded.com'];
    }

    // Build asset links
    const buildAssetSection = (assets = []) => {
      if (!assets.length) return '';
      return assets
        .map(a => {
          const label = a.title || a.type || 'Link';
          return `${label}: ${a.url}`;
        })
        .join('\n');
    };

    // Flatten brand details for the AI
    const brandTextBlocks = brands.map(b => {
      return `
Brand: ${b.name || ''}
Why it works: ${b.whyItWorks || ''}
Integration ideas: ${(b.integrationIdeas || []).join('; ')}
HB Insights: ${b.hbInsights || ''}
${buildAssetSection(b.assets)}
`;
    }).join('\n---\n');

    // AI prompt for a personal-tone body
    const prompt = `
You are writing a short, natural, personal-tone email to a brand contact.
No marketing fluff — it should read like a human typed it directly in their inbox.
The email is about a project partnership.

Project: ${projectName}
Vibe: ${vibe}
Cast: ${cast}
Location: ${location}
Notes from sender: ${notes}

For each brand below, naturally fold in the "Why it works", "Integration ideas", and "HB Insights" into the flow of the email. 
Make it concise and personable, as if you already have a friendly relationship.
At the end of the email, clearly list any provided links (video, PDF, audio, images) so they can access them easily.

Brands and details:
${brandTextBlocks}
`;

    const aiResp = await openai.chat.completions.create({
      model: "gpt-4o-mini", // or your existing fast/good model
      messages: [
        { role: "system", content: "You write personable, concise business emails." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7
    });

    const aiBody = aiResp.choices[0]?.message?.content?.trim() || '';

    // Add clean link list at bottom for absolute clarity
    const linkList = brands.map(b => {
      const links = (b.assets || []).map(a => `${a.title || a.type}: ${a.url}`);
      return links.length ? `${b.name}:\n${links.join('\n')}` : '';
    }).filter(Boolean).join('\n\n');

    const finalHtml = `
<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;">
  ${aiBody.split('\n').map(line => `<div>${line}</div>`).join('')}
  ${linkList ? `<div style="margin-top:12px;font-size:13px;white-space:pre-line;">${linkList}</div>` : ''}
</div>
`;

    const subject = `[Pitch] ${projectName} — ${brands.slice(0,3).map(b => b.name).join(', ')}${brands.length>3?'…':''}`;

    // Create draft in Outlook
    const draft = await o365API.createDraft(
      subject,
      finalHtml,
      toRecipients,
      { isHtml: true, cc, senderEmail }
    );

    return res.status(200).json({
      success: true,
      webLink: draft.webLink || null,
      subject
    });

  } catch (err) {
    console.error('pushDraft error', err);
    return res.status(500).json({ error: 'Failed to push draft', details: err.message });
  }
}
