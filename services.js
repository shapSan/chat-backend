// lib/services.js
import fetch from 'node-fetch';
import WebSocket from 'ws'; // Not used in the functions below, but available if you wire realtime later
import RunwayML from '@runwayml/sdk';
import { put } from '@vercel/blob';
import { Buffer } from 'node:buffer';

import firefliesAPI, { firefliesApiKey } from '../fireflies-client.js';
// (Optional) hubspot-client is not required by the moved functions; import later if needed
// import hubspotAPI from '../hubspot-client.js';

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

// These helpers will be created in ./core.js in the next step (importing now is OK)
import { extractKeywordsForContextSearch, uniqShort } from './core.js';

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
export async function searchFireflies(query, options = {}) {
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

    // Build entity-based search terms
    let searchTerms = [];
    if (Array.isArray(query)) {
      const generic = ['millennial', 'paris', 'luxury', 'thriller', 'drama', 'comedy', 'action', 'romance'];
      searchTerms = query.filter((t) => t && !generic.includes(String(t).toLowerCase().trim()));
    } else if (typeof query === 'string' && query.trim()) {
      const extracted = await extractKeywordsForContextSearch(query);
      searchTerms = extracted.filter((t) => t && String(t).trim() !== '');
    }

    const allTranscripts = new Map();

    if (searchTerms.length > 0) {
      for (const term of searchTerms.slice(0, 10)) {
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

    // Fallback: recent transcripts
    const recentFilters = {
      limit: 10,
      fromDate: options.fromDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
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

  const imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
    body: JSON.stringify(body),
  });

  if (!imageResponse.ok) {
    const errorData = await imageResponse.text();
    if (imageResponse.status === 401) throw new Error('Invalid API key. Check OPENAI_API_KEY.');
    if (imageResponse.status === 429) throw new Error('Rate limit exceeded. Try again later.');
    if (imageResponse.status === 400) {
      let details = errorData;
      try {
        const errJson = JSON.parse(errorData);
        details = errJson.error?.message || details;
      } catch {}
      throw new Error(`Invalid request: ${details}`);
    }
    throw new Error(`Failed to generate image: ${imageResponse.status} - ${errorData}`);
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
      imageBuffer = await imageDataResponse.buffer();
    } else if (data.data[0].b64_json) {
      const base64Image = data.data[0].b64_json;
      imageBuffer = Buffer.from(base64Image, 'base64');
    }
  } else if (data.url) {
    const imageDataResponse = await fetch(data.url);
    if (!imageDataResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageDataResponse.status}`);
    }
    imageBuffer = await imageDataResponse.buffer();
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

  const audioBuffer = await elevenLabsResponse.buffer();

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
