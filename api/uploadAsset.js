import { put } from "@vercel/blob";

export const config = { 
  api: { 
    bodyParser: false,
    sizeLimit: '10mb' // Increase size limit for video uploads
  } 
};

export default async function handler(req, res) {
  // CORS (allow from your site)
  res.setHeader("Access-Control-Allow-Origin", "*"); // Allow all origins
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-vercel-filename");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const filename = req.headers["x-vercel-filename"] || `asset-${Date.now()}`;
  const contentType = req.headers["content-type"];
  if (!contentType) return res.status(400).json({ error: "Content-Type header is required." });

  try {
    // pass the raw request stream to Vercel Blob
    const { url: permanentUrl } = await put(filename, req, {
      access: "public",
      contentType,
    });
    return res.status(200).json({ success: true, url: permanentUrl });
  } catch (error) {
    console.error("Error uploading to Vercel Blob:", error);
    // Return more detailed error for debugging
    return res.status(500).json({ 
      error: "Failed to upload file.",
      details: error.message || error.toString(),
      filename: filename
    });
  }
}
