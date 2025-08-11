// /api/pushDraft.js
import OpenAI from "openai";
import { o365API } from "./chatWithOpenAI.js"; // adjust if path differs

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

// ---- OpenAI client (inline) ----
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- CORS (Framer + prod + local) ----
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
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

// ---- tiny utils ----
const esc = (s = "") =>
  String(s).replace(/[<&>]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const dedupe = (arr) => Array.from(new Set(arr.filter(Boolean)));
const toBullets = (arr) => arr.map((x) => `• ${x}`).join("\n");

// ---- handler ----
export default async function handler(req, res) {
  applyCORS(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const body = req.body || {};

    // Support both payload shapes
    const pd = (body.productionData && typeof body.productionData === "object") ? body.productionData : {};
    const projectName = body.projectName ?? pd.projectName ?? "Project";
    const cast        = body.cast        ?? pd.cast        ?? "";
    const location    = body.location    ?? pd.location    ?? "";
    const vibe        = body.vibe        ?? pd.vibe        ?? "";
    const notes       = body.notes       ?? pd.notes       ?? "";

    const brands = Array.isArray(body.brands) ? body.brands : [];
    if (!brands.length) return res.status(400).json({ error: "No brands provided" });

    // recipients: default to shap only
    const to = asArray(body.to);
    const cc = asArray(body.cc);
    const toRecipients = to.length ? to.slice(0, 10) : ["shap@hollywoodbranded.com"];
    const senderEmail = body.senderEmail || "shap@hollywoodbranded.com";

    // Build AI prompt blocks
    const normalizeIdeas = (v) =>
      Array.isArray(v) ? v : v ? String(v).split(/\n|•|- |\u2022/).map(s=>s.trim()).filter(Boolean) : [];

    const brandTextBlocks = brands.map((b) => {
      const ideas = normalizeIdeas(b.integrationIdeas);
      const assets = Array.isArray(b.assets) ? b.assets : [];
      const extra = [
        b.posterUrl ? { title: "Poster", type: "image", url: b.posterUrl } : null,
        (b.videoUrl ?? b.exportedVideo) ? { title: "Video", type: "video", url: b.videoUrl ?? b.exportedVideo } : null,
        (b.pdfUrl ?? b.brandCardPDF) ? { title: "Proposal PDF", type: "pdf", url: b.pdfUrl ?? b.brandCardPDF } : null,
        b.audioUrl ? { title: "Audio Pitch", type: "audio", url: b.audioUrl } : null,
      ].filter(Boolean);

      const linksTxt = [...assets, ...extra]
        .map((a) => `${a.title || a.type || "Link"}: ${a.url}`)
        .join("\n");

      return `
Brand: ${b.name || ""}
Why it works: ${b.whyItWorks || ""}
Integration ideas:
${ideas.length ? toBullets(ideas) : "-"}
HB Insights: ${b.hbInsights || ""}
${linksTxt}
`.trim();
    }).join("\n---\n");

    // Personal tone email
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
    const aiBody = aiResp?.choices?.[0]?.message?.content?.trim() || "";

    // Explicit link list (clear + clickable)
    const linkListBlocks = brands.map((b) => {
      const links = [];
      const push = (title, url) => url && links.push(`${title}: ${url}`);

      (Array.isArray(b.assets) ? b.assets : []).forEach((a) =>
        push(a.title || a.type || "Link", a.url)
      );
      push("Poster", b.posterUrl);
      push("Video", b.videoUrl ?? b.exportedVideo);
      push("Proposal PDF", b.pdfUrl ?? b.brandCardPDF);
      push("Audio Pitch", b.audioUrl);

      const unique = dedupe(links);
      return unique.length ? `${b.name || "Brand"}:\n${unique.join("\n")}` : "";
    }).filter(Boolean).join("\n\n");

    const htmlBody = `
<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;">
  ${aiBody.split("\n").map((line) => `<div>${esc(line)}</div>`).join("")}
  ${linkListBlocks ? `<div style="margin-top:12px;font-size:13px;white-space:pre-line;">${esc(linkListBlocks)}</div>` : ""}
</div>
    `.trim();

    const subject =
      `[Pitch] ${projectName} — ` +
      `${brands.slice(0, 3).map((b) => b.name).filter(Boolean).join(", ")}` +
      `${brands.length > 3 ? "…" : ""}`;

    // Create Outlook draft
    const draft = await o365API.createDraft(subject, htmlBody, toRecipients, {
      isHtml: true,
      cc,
      senderEmail,
    });

    return res.status(200).json({
      success: true,
      webLink: draft?.webLink || null,
      subject,
    });
  } catch (err) {
    console.error("pushDraft error", err);
    applyCORS(req, res);
    return res.status(500).json({
      error: "Failed to push draft",
      details: err?.message || String(err),
    });
  }
}
