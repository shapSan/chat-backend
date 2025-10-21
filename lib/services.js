// lib/services.js
import fetch from 'node-fetch';
import WebSocket from 'ws'; // Not used in the functions below, but available if you wire realtime later
import RunwayML from '@runwayml/sdk';
import { put } from '@vercel/blob';
import { Buffer } from 'node:buffer';

import firefliesAPI, { firefliesApiKey } from '../client/fireflies-client.js';
// (Optional) hubspot-client is not required by the moved functions; import later if needed
// import hubspotAPI from '../client/hubspot-client.js';

import {
  MODELS,
  openAIApiKey,
  elevenLabsApiKey,
  anthropicApiKey,
  runwayApiKey,
  googleGeminiApiKey,
  msftTenantId,
  msftClientId,
  msftClientSecret,
} from './config.js';

// Local helper to normalize terms (no core dependency)
function normalizeTerm(t) {
  return String(t || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

function uniqShort(list, max) {
  const out = [];
  const seen = new Set();
  for (const t of list.map(normalizeTerm)) {
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/* ---------------------------------------
 * Microsoft 365 (Graph) Email API Wrapper
 * ------------------------------------- */
export const o365API = {
  accessToken: null,
  tokenExpiry: null,
  baseUrl: 'https://graph.microsoft.com/v1.0',

  async getAccessToken() {
    try {
      if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
        return this.accessToken;
      }

      const tokenUrl = `https://login.microsoftonline.com/${msftTenantId}/oauth2/v2.0/token`;

      const params = new URLSearchParams({
        client_id: msftClientId,
        client_secret: msftClientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Microsoft auth failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = new Date(Date.now() + (data.expires_in - 300) * 1000);
      return this.accessToken;
    } catch (error) {
      console.error('[o365API.getAccessToken] Exception:', error);
      throw error;
    }
  },

  // Email search with RAOP handling
  async searchEmails(query, options = {}) {
    try {
      if (!msftClientId || !msftClientSecret || !msftTenantId) {
        return { emails: [], o365Status: 'no_credentials', userEmail: null };
      }

      const accessToken = await this.getAccessToken();
      const userEmail = options.userEmail || 'stacy@hollywoodbranded.com';

      // Build search terms (entities first, then keywords), 7-term budget
      let searchTerms = [];
      if (Array.isArray(query)) {
        searchTerms = uniqShort(query, 7);
      } else {
        searchTerms = uniqShort(String(query || '').split(/[,\|]/), 7);
      }

      if (searchTerms.length === 0) {
        return { emails: [], o365Status: 'ok', userEmail };
      }

      const top = 5;
      const queryPromises = searchTerms.map(async (term) => {
        const searchQuery = `"${term}"`;
        const url = new URL(`${this.baseUrl}/users/${encodeURIComponent(userEmail)}/messages`);
        url.searchParams.set('$top', String(top));
        url.searchParams.set('$search', searchQuery);
        url.searchParams.set('$select', 'id,subject,from,receivedDateTime,bodyPreview,webLink');
        url.searchParams.set('$count', 'true');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
          const res = await fetch(url, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              ConsistencyLevel: 'eventual',
              Prefer: 'outlook.body-content-type="text"',
            },
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!res.ok) {
            const body = await res.text();
            if (res.status === 403 && body.includes('ApplicationAccessPolicy')) {
              return { raopBlocked: true };
            }
            return { emails: [] };
          }

          const data = await res.json();
          return {
            emails:
              data.value?.map((m) => ({
                id: m.id,
                subject: m.subject,
                from: m.from?.emailAddress?.address,
                fromName: m.from?.emailAddress?.name,
                receivedDate: m.receivedDateTime,
                preview: m.bodyPreview?.slice(0, 200),
                webLink: m.webLink,
              })) || [],
          };
        } catch (err) {
          clearTimeout(timeoutId);
          console.error('[o365API.searchEmails] Query error:', err.message);
          return { emails: [] };
        }
      });

      const queryResults = await Promise.all(queryPromises);

      if (queryResults.some((r) => r.raopBlocked)) {
        return { emails: [], o365Status: 'forbidden_raop', userEmail };
      }

      const uniqueEmails = new Map();
      queryResults.forEach((result) => {
        result.emails?.forEach((email) => {
          if (!uniqueEmails.has(email.id)) uniqueEmails.set(email.id, email);
        });
      });

      const sortedEmails = Array.from(uniqueEmails.values())
        .sort((a, b) => new Date(b.receivedDate) - new Date(a.receivedDate))
        .slice(0, options.limit || 12);

      return { emails: sortedEmails, o365Status: 'ok', userEmail };
    } catch (error) {
      console.error('[o365API.searchEmails] Fatal error:', error);
      return { emails: [], o365Status: 'error', userEmail: null };
    }
  },

  async createDraft(subject, body, to, options = {}) {
    try {
      const accessToken = await this.getAccessToken();
      const senderEmail = options.senderEmail || 'shap@hollywoodbranded.com';

      const draftData = {
        subject,
        body: {
          contentType: options.isHtml !== false ? 'HTML' : 'Text',
          content: body,
        },
        toRecipients: Array.isArray(to)
          ? to.map((email) => ({ emailAddress: { address: email } }))
          : to
            ? [{ emailAddress: { address: to } }]
            : [{ emailAddress: { address: 'shap@hollywoodbranded.com' } }],
        ccRecipients: options.cc
          ? (Array.isArray(options.cc)
              ? options.cc.map((email) => ({ emailAddress: { address: email } }))
              : [{ emailAddress: { address: options.cc } }])
          : [],
      };

      const createRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(draftData),
        }
      );

      if (!createRes.ok) {
        const errorText = await createRes.text();
        throw new Error(`Draft creation failed: ${createRes.status} - ${errorText}`);
      }

      const draft = await createRes.json();

      const webLinkRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/messages/${draft.id}?$select=webLink`,
        { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!webLinkRes.ok) {
        return { id: draft.id, webLink: null };
      }

      const webLinkData = await webLinkRes.json();
      return { id: draft.id, webLink: webLinkData.webLink || null };
    } catch (error) {
      console.error('[o365API.createDraft] Exception:', error);
      throw error;
    }
  },

  async testConnection() {
    try {
      const token = await this.getAccessToken();
      const probeEmail = 'stacy@hollywoodbranded.com';
      const response = await fetch(`${this.baseUrl}/users/${encodeURIComponent(probeEmail)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  },
};

/* -------------------------------
 * Fireflies.ai Transcript Search
 * ----------------------------- */
export async function searchFireflies(searchTerms, options = {}) {
  if (!firefliesApiKey) {
    return { transcripts: [], firefliesStatus: 'no_credentials' };
  }

  try {
    const isConnected = await firefliesAPI.testConnection();
    if (!isConnected) {
      if (firefliesAPI.initialize) {
        await firefliesAPI.initialize();
        const retry = await firefliesAPI.testConnection();
        if (!retry) return { transcripts: [], firefliesStatus: 'connection_failed' };
      } else {
        return { transcripts: [], firefliesStatus: 'connection_failed' };
      }
    }

    // Accept array of terms directly (no AI extraction in services)
    let termsToSearch = [];
    if (Array.isArray(searchTerms)) {
      const generic = ['millennial', 'paris', 'luxury', 'thriller', 'drama', 'comedy', 'action', 'romance'];
      termsToSearch = searchTerms.filter((t) => t && !generic.includes(String(t).toLowerCase().trim()));
    } else if (typeof searchTerms === 'string' && searchTerms.trim()) {
      // If string passed, use as single term (no AI extraction)
      termsToSearch = [searchTerms.trim()];
    }

    const allTranscripts = new Map();

    if (termsToSearch.length > 0) {
      for (const term of termsToSearch.slice(0, 10)) {
        try {
          const filters = {
            keyword: String(term).trim(),
            limit: options.limit || 10,
          };
          if (options.fromDate) filters.fromDate = options.fromDate;

          const results = await firefliesAPI.searchTranscripts(filters);
          results.forEach((t) => allTranscripts.set(t.id, t));
        } catch (err) {
          console.error('[searchFireflies] Term failed:', term, err?.message);
        }
      }
    }

    const individualResults = Array.from(allTranscripts.values());
    if (individualResults.length > 0) {
      return { transcripts: individualResults, firefliesStatus: 'ok', meetingsMode: 'entity_search' };
    }

    // Fallback: recent transcripts with rolling window
    const DAYS = 90; // Configurable rolling window (90 days default, can be 365 for full year)
    const recentFilters = {
      limit: 10,
      fromDate: options.fromDate || new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString(),
    };
    const recent = await firefliesAPI.searchTranscripts(recentFilters);
    return {
      transcripts: recent || [],
      firefliesStatus: 'ok',
      meetingsMode: 'recent_fallback',
    };
  } catch (error) {
    console.error('[searchFireflies] Fatal error:', error);
    return { transcripts: [], firefliesStatus: 'error' };
  }
}

/* ----------------------------
 * RunwayML Video (image2video)
 * -------------------------- */
export async function generateRunwayVideo({
  promptText,
  promptImage,
  model = MODELS.runway.default,
  ratio = '1104:832',
  duration = 5,
}) {
  if (!runwayApiKey) throw new Error('RUNWAY_API_KEY not configured');

  try {
    const client = new RunwayML({ apiKey: runwayApiKey });

    let imageToUse = promptImage;
    if (!imageToUse || imageToUse.includes('dummyimage.com')) {
      imageToUse =
        'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1280&h=720&fit=crop&q=80';
    }

    const videoTask = await client.imageToVideo.create({
      model,
      promptImage: imageToUse,
      promptText,
      ratio,
      duration,
    });

    let task = videoTask;
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      task = await client.tasks.retrieve(task.id);

      if (task.status === 'SUCCEEDED') {
        const videoUrl = task.output?.[0];
        if (!videoUrl) throw new Error('No video URL in output');
        return { url: videoUrl, taskId: task.id };
      }

      if (task.status === 'FAILED') {
        throw new Error(`Generation failed: ${task.failure || task.error || 'Unknown error'}`);
      }

      await new Promise((r) => setTimeout(r, 5000));
      attempts++;
    }

    throw new Error('Video generation timed out');
  } catch (error) {
    if (error.message?.includes('401')) {
      throw new Error('Invalid API key. Check RUNWAY_API_KEY in Vercel settings.');
    }
    if (error.message?.includes('429')) {
      throw new Error('Rate limit exceeded. Try again later.');
    }
    if (error.message?.includes('insufficient_credits') || error.status === 402) {
      throw new Error('Runway credits exhausted. Please upgrade your plan or wait for credits to reset.');
    }
    if (error.status === 504 || error.message?.includes('timeout')) {
      throw new Error('Video generation timed out. This usually means the server is busy. Please try again.');
    }
    throw error;
  }
}

/* --------------------------
 * Google Veo 3 (preview API)
 * ------------------------ */
export async function generateVeo3Video({
  promptText,
  aspectRatio = '16:9',
  duration = 5,
}) {
  if (!googleGeminiApiKey) throw new Error('GOOGLE_GEMINI_API_KEY not configured');

  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-preview:generateVideo?key=${googleGeminiApiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: promptText,
        config: { personGeneration: 'allow_all', aspectRatio, duration: `${duration}s` },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) throw new Error('Invalid API key. Check GOOGLE_GEMINI_API_KEY.');
      if (response.status === 404)
        throw new Error('Veo3 endpoint not found or not enabled for your key/region.');
      if (response.status === 429) throw new Error('Rate limit exceeded. Try again later.');
      throw new Error(`Veo3 API error: ${response.status} - ${errorText}`);
    }

    const operation = await response.json();

    if (operation.name) {
      let attempts = 0;
      const maxAttempts = 60;

      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 10000));

        const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${operation.name}?key=${googleGeminiApiKey}`;
        const statusResponse = await fetch(statusUrl);

        if (!statusResponse.ok) throw new Error('Failed to check video generation status');

        const statusData = await statusResponse.json();

        if (statusData.done) {
          if (statusData.error) throw new Error(`Video generation failed: ${statusData.error.message}`);
          const videoUrl =
            statusData.response?.video?.uri || statusData.response?.videoUrl;
          if (!videoUrl) throw new Error('No video URL in response');
          return { url: videoUrl, taskId: operation.name, metadata: statusData.response };
        }

        attempts++;
      }

      throw new Error('Video generation timed out');
    } else {
      const videoUrl = operation.video?.uri || operation.videoUrl;
      if (!videoUrl) throw new Error('No video URL in response');
      return { url: videoUrl, taskId: 'direct-response', metadata: operation };
    }
  } catch (error) {
    throw new Error(`Veo3 is currently in preview and may not be available. ${error.message}`);
  }
}

/* -----------------------
 * OpenAI Text (Chat API)
 * --------------------- */
export async function getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent) {
  try {
    const messages = [
      { role: 'system', content: systemMessageContent },
      { role: 'user', content: userMessage },
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: MODELS.openai.chat,
        messages,
        max_tokens: 1000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    throw error;
  }
}

/* ------------------------
 * Anthropic Text (Claude)
 * ---------------------- */
export async function getTextResponseFromClaude(userMessage, sessionId, systemMessageContent) {
  try {
    // Special casing is retained from original logic
    let claudeSystemPrompt = `<role>You are an expert brand partnership analyst for Hollywood entertainment. You provide honest, nuanced analysis while being helpful and conversational.</role>

${systemMessageContent}`;

    if (systemMessageContent.includes('BRAND_ACTIVITY') && systemMessageContent.includes('**ABSOLUTE REQUIREMENT')) {
      claudeSystemPrompt += `

<critical_instruction>
YOU MUST DISPLAY EVERY SINGLE ITEM IN THE COMMUNICATIONS ARRAY. 
Do not summarize, skip, or combine items.
Before responding, count your numbered items - it must match the total specified.
</critical_instruction>`;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELS.anthropic.claude,
        max_tokens: 4000,
        temperature: 0.3,
        messages: [{ role: 'user', content: `${claudeSystemPrompt}\n\nUser's request: ${userMessage}` }],
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[Claude API] response:', response.status, errorData);
      throw new Error(`Claude API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? null;
    return text;
  } catch (error) {
    // Fallback to OpenAI if Claude fails and OpenAI key exists
    console.error('[getTextResponseFromClaude] Falling back to OpenAI:', error?.message);
    if (openAIApiKey) {
      return getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent);
    }
    throw error;
  }
}

/* ---------------------------------------------------------
 * Nano Banana Image Generation (Google Gemini 2.5 Flash)
 * ------------------------------------------------------- */
export async function generateNanoBananaImage({
  prompt,
  sessionId,
  imageUrl, // Optional: for editing existing images
  projectName,
  brandName,
  slideContent,
}) {
  if (!googleGeminiApiKey) {
    throw new Error('Image generation service not configured. Please set GOOGLE_GEMINI_API_KEY.');
  }

  try {
    // For text-to-image generation using Gemini
    if (!imageUrl) {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${googleGeminiApiKey}`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Generate a professional, high-quality image: ${prompt}`
            }]
          }],
          generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 2048,
          }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Nano Banana] API error:', errorText);
        throw new Error(`Image generation failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Extract image from response
      const imageData = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData);
      
      if (!imageData?.inlineData?.data) {
        throw new Error('No image generated');
      }

      // Convert base64 to buffer
      const mimeType = imageData.inlineData.mimeType || 'image/png';
      const base64Data = imageData.inlineData.data;
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // Upload to Vercel Blob
      const timestamp = Date.now();
      const filename = `${sessionId || 'unknown-session'}/nano-banana-${timestamp}.png`;

      const { url } = await put(filename, imageBuffer, {
        access: 'public',
        contentType: mimeType,
      });

      return {
        success: true,
        imageUrl: url,
        model: 'nano-banana',
        storage: 'blob',
        prompt,
      };
    }
    // For editing existing images (image-to-image)
    else {
      // Use fal.ai for editing with Nano Banana
      const falApiKey = process.env.FAL_API_KEY || googleGeminiApiKey;
      
      const response = await fetch('https://fal.run/fal-ai/nano-banana/edit', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${falApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          image_urls: [imageUrl],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Nano Banana Edit] API error:', errorText);
        throw new Error(`Image editing failed: ${response.status}`);
      }

      const data = await response.json();
      const editedImageUrl = data.images?.[0]?.url || data.image?.url;
      
      if (!editedImageUrl) {
        throw new Error('No edited image URL received');
      }

      // Download and re-upload to our blob storage
      const imageResponse = await fetch(editedImageUrl);
      if (!imageResponse.ok) {
        throw new Error('Failed to fetch edited image');
      }
      
      const imageArrayBuffer = await imageResponse.arrayBuffer();
      const imageBuffer = Buffer.from(imageArrayBuffer);

      const timestamp = Date.now();
      const filename = `${sessionId || 'unknown-session'}/nano-banana-edit-${timestamp}.png`;

      const { url } = await put(filename, imageBuffer, {
        access: 'public',
        contentType: 'image/png',
      });

      return {
        success: true,
        imageUrl: url,
        model: 'nano-banana-edit',
        storage: 'blob',
        prompt,
      };
    }
  } catch (error) {
    console.error('[generateNanoBananaImage] Exception:', error);
    throw error;
  }
}

/* ---------------------------------------------------------
 * New: Image generation via OpenAI + upload to Vercel Blob
 * ------------------------------------------------------- */
export async function generateOpenAIImage({
  prompt,
  sessionId,
  enhancedPrompt, // optional pre-enhanced prompt
  dimensions, // '1536x1024' etc.
}) {
  if (!openAIApiKey) {
    throw new Error('Image generation service not configured. Please set OPENAI_API_KEY.');
  }

  const model = MODELS.openai.image;
  const body = {
    model,
    prompt: enhancedPrompt || prompt,
    n: 1,
    size: dimensions || '1536x1024',
  };

  // Add timeout handling for the image generation request
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout

  try {
    const imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!imageResponse.ok) {
      const errorData = await imageResponse.text();
      console.error('[generateOpenAIImage] Error response:', imageResponse.status, errorData);
      
      // Parse error details
      let errorMessage = 'Failed to generate image';
      let errorCode = null;
      
      try {
        const errJson = JSON.parse(errorData);
        errorMessage = errJson.error?.message || errorData;
        errorCode = errJson.error?.code;
      } catch {
        errorMessage = errorData;
      }
      
      // Handle specific error cases with user-friendly messages
      if (imageResponse.status === 401) {
        throw new Error('AUTHENTICATION_ERROR: Invalid API key. Please contact support.');
      }
      
      if (imageResponse.status === 429) {
        throw new Error('RATE_LIMIT: Too many requests. Please wait a moment and try again.');
      }
      
      if (imageResponse.status === 400) {
        // Check for content policy violations
        if (errorMessage.includes('content_policy') || 
            errorMessage.includes('safety') || 
            errorMessage.includes('not allowed')) {
          throw new Error('CONTENT_POLICY: Your prompt was flagged by our content safety system. Please try rephrasing your request to be more appropriate.');
        }
        
        // Check for billing issues
        if (errorMessage.includes('billing') || errorMessage.includes('quota')) {
          throw new Error('BILLING_ERROR: Service quota exceeded. Please contact support.');
        }
        
        // Generic bad request
        throw new Error(`INVALID_REQUEST: ${errorMessage}`);
      }
      
      // Catch-all for other errors
      throw new Error(`IMAGE_GENERATION_ERROR: ${errorMessage}`);
    }

  const data = await imageResponse.json();

  let imageBuffer = null;

  if (data.data && data.data.length > 0) {
    if (data.data[0].url) {
      const temporaryImageUrl = data.data[0].url;
      const imageDataResponse = await fetch(temporaryImageUrl);
      if (!imageDataResponse.ok) {
        throw new Error(`Failed to fetch image from OpenAI URL: ${imageDataResponse.status}`);
      }
      const imageArrayBuffer = await imageDataResponse.arrayBuffer();
      imageBuffer = Buffer.from(imageArrayBuffer);
    } else if (data.data[0].b64_json) {
      const base64Image = data.data[0].b64_json;
      imageBuffer = Buffer.from(base64Image, 'base64');
    }
  } else if (data.url) {
    const imageDataResponse = await fetch(data.url);
    if (!imageDataResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageDataResponse.status}`);
    }
    const imageArrayBuffer2 = await imageDataResponse.arrayBuffer();
    imageBuffer = Buffer.from(imageArrayBuffer2);
  }

  if (!imageBuffer) {
    throw new Error('No image data received from OpenAI');
  }

  const timestamp = Date.now();
  const filename = `${sessionId || 'unknown-session'}/poster-image-${timestamp}.png`;

  const { url } = await put(filename, imageBuffer, {
    access: 'public',
    contentType: 'image/png',
  });

  return {
    success: true,
    imageUrl: url,
    revisedPrompt: data.data?.[0]?.revised_prompt || (enhancedPrompt || prompt),
    model,
    storage: 'blob',
  };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Image generation timed out. Please try again with a simpler prompt.');
    }
    throw error;
  }
}

/* --------------------------------------------------------
 * New: Audio generation via ElevenLabs + upload to Blob
 * ------------------------------------------------------ */
export async function generateElevenLabsAudio({
  prompt,
  voiceId,
  voiceSettings,
  sessionId,
}) {
  if (!elevenLabsApiKey) {
    throw new Error('Audio generation service not configured. Please set ELEVENLABS_API_KEY.');
  }

  const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const elevenLabsResponse = await fetch(elevenLabsUrl, {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': elevenLabsApiKey,
    },
    body: JSON.stringify({
      text: prompt,
      model_id: MODELS.elevenlabs.voice,
      voice_settings: voiceSettings,
    }),
  });

  if (!elevenLabsResponse.ok) {
    const errorText = await elevenLabsResponse.text();
    throw new Error(`Failed to generate audio: ${errorText}`);
  }

  const audioArrayBuffer = await elevenLabsResponse.arrayBuffer();
  const audioBuffer = Buffer.from(audioArrayBuffer);

  const timestamp = Date.now();
  const filename = `${sessionId || 'unknown-session'}/audio-narration-${timestamp}.mp3`;

  const { url: permanentUrl } = await put(filename, audioBuffer, {
    access: 'public',
    contentType: 'audio/mpeg',
  });

  return {
    success: true,
    audioUrl: permanentUrl,
    voiceUsed: voiceId,
    storage: 'blob',
  };
}

/* --------------------------
 * Web Search - Hybrid Approach (Real-time + Historical Knowledge)
 * ------------------------ */
export async function searchWeb(query, options = {}) {
  // Get BOTH real-time and historical insights for comprehensive market context
  const results = [];
  
  // 1. Try Claude for REAL current news (if available)
  if (anthropicApiKey) {
    const liveResults = await searchWebWithClaude(query, { ...options, focus: 'current' });
    if (liveResults.results?.length > 0) {
      results.push(...liveResults.results);
    }
  }
  
  // 2. ALWAYS get strategic insights from OpenAI (historical patterns)
  if (openAIApiKey) {
    const strategicResults = await searchWebWithOpenAI(query, { ...options, focus: 'strategic' });
    if (strategicResults.results?.length > 0) {
      results.push(...strategicResults.results);
    }
  }
  
  // If we got both, we'll have ~6 results (3 current + 3 strategic)
  // If only one API is available, we'll have ~3 results
  if (results.length === 0) {
    return { results: [], error: 'No API keys configured for search' };
  }
  
  // Dedupe and limit to best results
  const seen = new Set();
  const uniqueResults = [];
  
  for (const result of results) {
    const key = result.snippet.substring(0, 50).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueResults.push(result);
      if (uniqueResults.length >= (options.limit || 3)) break;
    }
  }
  
  return { results: uniqueResults };
}

async function searchWebWithClaude(query, options = {}) {
  try {
    // Claude searches for CURRENT news and announcements
    const searchPrompt = `Search the web for RECENT information about: ${query}

Focus on:
- News from the last 30 days ONLY
- Recent campaign launches or announcements
- Current partnerships or sponsorships
- Breaking news or latest initiatives

Provide 2-3 specific, recent results with exact dates and sources.
Only include information from the last month.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODELS.anthropic.claude,
        max_tokens: 1000,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: searchPrompt
        }],
        system: 'You are a market research assistant. Search the web for ONLY very recent information (last 30 days). Include specific dates and sources. Do not include historical information or general brand facts.'
      })
    });

    if (!response.ok) {
      console.error('[searchWebWithClaude] API error:', response.status);
      return { results: [] };
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '';
    
    // Parse Claude's response into structured results
    const lines = content.split('\n').filter(l => l.trim());
    const results = [];
    
    for (let i = 0; i < lines.length && results.length < 2; i++) {
      const line = lines[i];
      // Only include if it has a recent date reference
      if (line.includes('2024') || line.includes('2025') || 
          line.includes('week') || line.includes('day') || 
          line.includes('November') || line.includes('December')) {
        results.push({
          snippet: line.substring(0, 200),
          url: `https://news.google.com/search?q=${encodeURIComponent(query)}`,
          date: 'Recent',
          type: 'current_news',
          isLive: true
        });
      }
    }
    
    return { results };
    
  } catch (error) {
    console.error('[searchWebWithClaude] Exception:', error.message);
    return { results: [] };
  }
}

async function searchWebWithOpenAI(query, options = {}) {
  if (!openAIApiKey) {
    return { results: [], error: 'OpenAI API key not configured' };
  }

  try {
    // OpenAI provides STRATEGIC CONTEXT and historical patterns
    const searchPrompt = `Analyze the brand from: ${query}

Provide strategic market intelligence about:
- The brand's typical partnership strategies and past collaborations
- Their core marketing approach and brand positioning
- Target demographics and psychographics
- Notable historical campaigns or partnerships
- Industry positioning and competitive landscape

Focus on STRATEGIC INSIGHTS that would inform partnership decisions.
Do NOT include recent news (that comes from elsewhere).
Provide 2-3 key insights about their partnership approach and brand strategy.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${openAIApiKey}` 
      },
      body: JSON.stringify({
        model: MODELS.openai.chat,
        messages: [
          { 
            role: 'system', 
            content: 'You are a brand strategy expert. Provide strategic insights about brands based on historical patterns, typical partnership approaches, and market positioning. Focus on evergreen strategic intelligence, NOT current news.'
          },
          { role: 'user', content: searchPrompt }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      console.error('[searchWebWithOpenAI] API error:', response.status);
      return { results: [] };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Parse into strategic insights
    const insights = content.split('\n').filter(l => l.trim() && l.length > 20);
    const results = [];
    
    for (let i = 0; i < insights.length && results.length < 2; i++) {
      const insight = insights[i];
      if (insight.length > 30) {  // Only substantial insights
        results.push({
          snippet: insight.substring(0, 250),
          url: `https://www.${query.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
          date: 'Historical Context',
          type: 'strategic_insight',
          isLive: false
        });
      }
    }
    
    // Always provide at least one strategic insight
    if (results.length === 0 && content.length > 50) {
      results.push({
        snippet: `Strategic Profile: ${content.substring(0, 250)}`,
        url: `https://www.google.com/search?q=${encodeURIComponent(query + ' brand strategy')}`,
        date: 'Brand Intelligence',
        type: 'strategic_insight',
        isLive: false
      });
    }
    
    return { results };
    
  } catch (error) {
    console.error('[searchWebWithOpenAI] Exception:', error.message);
    return { results: [] };
  }
}

/* =========================
 * OPENAI-POWERED HELPERS (moved from core.js)
 * ======================= */
export async function extractKeywordsForHubSpot(synopsis) {
  if (!openAIApiKey) return '';
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: MODELS.openai.chatMini,
        messages: [
          {
            role: 'system',
            content:
              "Analyze this production synopsis and identify 3-5 brand categories that would resonate with its audience. Think about: What brands would viewers of this content naturally gravitate toward? What lifestyle/aspirations does this story represent? What demographic psychographics emerge? Return ONLY category keywords that brands use, separated by spaces. Be specific and insightful - go beyond obvious genre matches to find authentic brand-audience alignment.",
          },
          { role: 'user', content: synopsis },
        ],
        temperature: 0.3,
        max_tokens: 40,
      }),
    });
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  } catch {
    return '';
  }
}

export async function extractKeywordsForContextSearch(text) {
  if (!openAIApiKey) return [];
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: MODELS.openai.chatMini,
        messages: [
          {
            role: 'system',
            content:
              'Return up to 5 proper nouns/entities: Project title, studio/distributor, talent names, company/brand names. Do not return demographics or generic terms like "Millennial", "Paris", "luxury", "thriller". If no clear title is found, synthesize "Untitled [Genre] Project". Return as JSON: {"keywords": ["entity1", "entity2", ...]}. Multi-word names should be in quotes.',
          },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    });
    const data = await response.json();
    const result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    return Array.isArray(result.keywords) ? result.keywords : [];
  } catch (error) {
    console.error('[extractKeywordsForContextSearch] error:', error?.message);
    return [];
  }
}

export async function generateWildcardBrands(synopsis) {
  if (!openAIApiKey) return [];
  try {
    const systemPromptContent = `You are a top-tier brand strategist who specializes in identifying "Net-New" partnership opportunities - brands that are unexpected yet perfect fits. Your suggestions balance being innovative with being realistic about which brands actually do entertainment partnerships.

<NET_NEW_CRITERIA>
A great Net-New brand suggestion:
1. Has a real marketing budget and history of creative partnerships (not just any random company)
2. Is culturally relevant and trendy among specific demographics
3. Creates an "aha!" moment - unexpected but makes total sense once you think about it
4. Aligns with modern consumer behavior and cultural trends
5. Is NOT:
   - A film studio or production company (A24, Neon, etc.)
   - A mega-corporation everyone thinks of first (Nike, Coca-Cola, Apple)
   - A brand with no marketing presence or partnership history
   - Something completely random with no logical connection
</NET_NEW_CRITERIA>

<BRAND_CATEGORIES_THAT_WORK>
Focus on brands from these categories that actively do entertainment partnerships:
- Direct-to-consumer brands (Warby Parker, Casper, Away, Glossier)
- Modern financial services (Robinhood, Chime, Klarna, Affirm)
- Emerging beverages (Athletic Brewing, Liquid Death, Poppi, Olipop)
- Gaming/Tech platforms (Discord, Twitch, Steam, Epic Games)
- Modern wellness (Headspace, Peloton, Therabody, Oura)
- Fashion/Streetwear (Supreme, Kith, Fear of God, Aimé Leon Dore)
- Food delivery/Quick commerce (DoorDash, Gopuff, Gorillas)
- Dating/Social apps (Bumble, Hinge, BeReal)
- Crypto/Web3 (but only established ones like Coinbase, OpenSea)
- Athletic/Outdoor gear (On Running, Vuori, Outdoor Voices, Patagonia)
</BRAND_CATEGORIES_THAT_WORK>

<THINK_ABOUT>
- What brands would this production's target audience ACTUALLY use?
- What products naturally fit into the story world without feeling forced?
- What brands are having a cultural moment that aligns with the themes?
- What unexpected category could enhance a scene or character?
</THINK_ABOUT>

CRITICAL RULES:
1. Each brand MUST be real and have done marketing partnerships before
2. The connection must be clever but not forced - it should feel natural
3. Consider the production's tone, setting, and target demographic
4. Provide a specific, actionable integration idea (not just "good fit")
5. Output ONLY valid JSON: {"brands": ["Brand Name - Specific integration opportunity that feels organic to the story."]}

Think step by step:
1. What's the core audience for this production?
2. What brands are those people actually excited about?
3. How could these brands enhance specific scenes without feeling like an ad?`;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: MODELS.openai.chat,
        messages: [
          { role: 'system', content: systemPromptContent },
          { role: 'user', content: `Production Synopsis: ${synopsis?.slice(0, 1000) || 'No synopsis provided'}\n\nGenerate 5 Net-New brand suggestions that are unexpected yet perfect fits. Remember: no film studios, no obvious mega-brands, only brands that actually do partnerships.` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.8,
        max_tokens: 300,
      }),
    });
    
    const data = await response.json();
    const result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    
    if (Array.isArray(result.brands)) {
      // Filter out any film studios or non-brand entities that might slip through
      const invalidBrands = ['a24', 'neon', 'searchlight', 'focus features', 'annapurna', 
                            'bleecker street', 'ifc', 'magnolia', 'sony pictures', 'paramount',
                            'universal', 'warner', 'disney', 'netflix', 'amazon studios',
                            'apple tv', 'hulu', 'hbo', 'showtime', 'fx'];
      
      return result.brands.filter(brandString => {
        const brandName = brandString.split(' - ')[0].toLowerCase();
        // Check it's not a studio/network
        const isValid = !invalidBrands.some(invalid => brandName.includes(invalid));
        // Also filter out any that don't have a proper integration idea
        const hasIntegration = brandString.includes(' - ') && brandString.split(' - ')[1].length > 10;
        return isValid && hasIntegration;
      }).slice(0, 5);
    }
    return [];
  } catch (error) {
    console.error('[generateWildcardBrands] error:', error?.message);
    return [];
  }
}
