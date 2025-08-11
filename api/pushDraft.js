// /api/pushDraft.js  (CORS canary)
export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

export default function handler(req, res) {
  // CORS
  res.setHeader("Vary", "Origin");
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  return res.status(200).json({ ok: true });
}
