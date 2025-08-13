// /api/translate.js — Simple translation endpoint using OpenAI

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

// ---------- CORS (reuse from pushDraft) ----------
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
    if (host.endsWith(".framer.website")) return origin;
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

// ---------- handler ----------
export default async function handler(req, res) {
  applyCORS(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { texts, targetLang = "es", batchSize = 50 } = req.body;
    
    // Validate input
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({ error: "No texts provided" });
    }
    
    // Very generous limit for real use cases
    if (texts.length > 1000) {
      return res.status(400).json({ error: "Too many text items (max 1000)" });
    }
    
    // ~100 pages of text (500 words ≈ 2500 chars, so 500k chars ≈ 100 pages)
    const totalChars = texts.reduce((sum, text) => sum + String(text).length, 0);
    if (totalChars > 500000) {
      return res.status(400).json({ error: "Total text too long (max 500,000 characters)" });
    }
    
    // Check for API key
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Translation service not configured" });
    }
    
    const totalWords = Math.round(totalChars / 5); // rough word count
    console.log(`[translate] Processing ${texts.length} texts (~${totalWords} words, ${totalChars} chars) to ${targetLang}`);
    
    // Process in batches for large requests
    const allTranslations = [];
    const actualBatchSize = Math.min(batchSize, 50); // Process 50 at a time
    
    for (let i = 0; i < texts.length; i += actualBatchSize) {
      const batch = texts.slice(i, i + actualBatchSize);
      const batchChars = batch.reduce((sum, text) => sum + String(text).length, 0);
      
      // Calculate appropriate token limit (1 token ≈ 4 chars, be generous)
      const estimatedTokens = Math.ceil(batchChars / 2); // Very generous for translations
      const maxTokens = Math.min(8000, Math.max(1000, estimatedTokens * 2)); // 2x buffer, cap at 8k
      
      console.log(`[translate] Batch ${Math.floor(i/actualBatchSize) + 1}: ${batch.length} items, ~${batchChars} chars, max_tokens: ${maxTokens}`);
      
      // Call OpenAI for translation
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { 
              role: "system", 
              content: `You are a professional translator. Translate the given texts to ${targetLang}.
Return ONLY a valid JSON array with translations in the exact same order.
Each item should be: {"original": "original text", "translation": "translated text"}
Maintain the tone, style, and formatting of the original text.
If a text is already in ${targetLang}, return it unchanged.
Preserve any HTML tags, markdown, or special formatting.`
            },
            { 
              role: "user", 
              content: `Translate these ${batch.length} texts to ${targetLang}:\n${JSON.stringify(batch, null, 2)}`
            }
          ],
          temperature: 0.3,
          max_tokens: maxTokens
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[translate] OpenAI error on batch ${i}:`, response.status, error);
        
        // Add fallback for failed batch
        batch.forEach(text => {
          allTranslations.push({
            original: text,
            translation: text,
            error: "Translation failed for this batch"
          });
        });
        continue;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      
      if (!content) {
        // Fallback for empty response
        batch.forEach(text => {
          allTranslations.push({
            original: text,
            translation: text,
            error: "No translation received"
          });
        });
        continue;
      }
      
      // Parse the JSON response
      try {
        const batchTranslations = JSON.parse(content);
        if (!Array.isArray(batchTranslations)) {
          throw new Error("Invalid response format");
        }
        
        // Ensure we have the right number of translations
        if (batchTranslations.length !== batch.length) {
          console.warn(`[translate] Mismatch: expected ${batch.length}, got ${batchTranslations.length}`);
        }
        
        allTranslations.push(...batchTranslations);
      } catch (parseError) {
        console.error(`[translate] Parse error on batch ${i}:`, parseError);
        // Try to extract what we can
        batch.forEach(text => {
          allTranslations.push({
            original: text,
            translation: text,
            error: "Translation parsing failed"
          });
        });
      }
      
      // Small delay between batches to avoid rate limits (only for multiple batches)
      if (i + actualBatchSize < texts.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    const successCount = allTranslations.filter(t => !t.error).length;
    console.log(`[translate] Completed: ${successCount}/${allTranslations.length} successful`);
    
    return res.status(200).json({
      success: true,
      targetLang,
      count: allTranslations.length,
      successCount,
      translations: allTranslations
    });
    
  } catch (err) {
    console.error("[translate] Error:", err);
    applyCORS(req, res);
    return res.status(500).json({ 
      error: "Translation service error", 
      details: err?.message || String(err) 
    });
  }
}
