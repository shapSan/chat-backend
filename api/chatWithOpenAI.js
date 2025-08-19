import dotenv from 'dotenv';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import RunwayML from '@runwayml/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import hubspotAPI, { hubspotApiKey } from './hubspot-client.js';
import firefliesAPI, { firefliesApiKey } from './fireflies-client.js';
import { kv } from '@vercel/kv';
import { put } from '@vercel/blob';

dotenv.config();

// Configuration constants
const CONFIG = {
  api: {
    bodyParser: { sizeLimit: '10mb' }
  },
  models: {
    openai: {
      chat: 'gpt-4o',
      chatMini: 'gpt-4o-mini',
      chatLegacy: 'gpt-3.5-turbo',
      image: 'gpt-image-1',
      realtime: 'gpt-4o-realtime-preview-2024-10-01'
    },
    anthropic: {
      claude: 'claude-3-5-sonnet-20241022'
    },
    elevenlabs: {
      voice: 'eleven_monolingual_v1'
    },
    runway: {
      default: 'gen3_alpha_turbo',
      turbo: 'gen4_turbo'
    }
  },
  projects: {
    'default': {
      baseId: 'appTYnw2qIaBIGRbR',
      chatTable: 'EagleView_Chat',
      knowledgeTable: 'Chat-KnowledgeBase',
      voiceId: '21m00Tcm4TlvDq8ikWAM',
      voiceSettings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.5,
        use_speaker_boost: true
      }
    },
    'HB-PitchAssist': {
      baseId: 'apphslK7rslGb7Z8K',
      chatTable: 'Chat-Conversations',
      knowledgeTable: 'Chat-KnowledgeBase',
      voiceId: 'GFj1cj74yBDgwZqlLwgS',
      voiceSettings: {
        stability: 0.34,
        similarity_boost: 0.8,
        style: 0.5,
        use_speaker_boost: true
      }
    }
  },
  featureFlags: {
    recsFixMerge: process.env.RECS_FIX_MERGE !== 'false',
    recsCooldown: process.env.RECS_COOLDOWN !== 'false',
    recsDiversify: process.env.RECS_DIVERSIFY !== 'false',
    recsJitterTarget: process.env.RECS_JITTER_TARGET !== 'false',
    recsDiscoverRatio: process.env.RECS_DISCOVER_RATIO || '50,30,20'
  }
};

// Environment variables
const ENV = {
  airtableApiKey: process.env.AIRTABLE_API_KEY,
  openAIApiKey: process.env.OPENAI_API_KEY,
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  runwayApiKey: process.env.RUNWAY_API_KEY,
  googleGeminiApiKey: process.env.GOOGLE_GEMINI_API_KEY,
  msftTenantId: process.env.MICROSOFT_TENANT_ID,
  msftClientId: process.env.MICROSOFT_CLIENT_ID,
  msftClientSecret: process.env.MICROSOFT_CLIENT_SECRET
};

export const config = CONFIG.api;

// Utility functions
const Utils = {
  // Progress tracking helpers
  progressKey: (sessionId, runId) => runId ? `progress:${sessionId}:${runId}` : `mcp:${sessionId}`,
  
  async progressInit(sessionId, runId) {
    const key = this.progressKey(sessionId, runId);
    await kv.set(key, { steps: [], done: false, runId: runId || null, ts: Date.now() }, { ex: 900 });
  },
  
  async progressPush(sessionId, runId, step) {
    const key = this.progressKey(sessionId, runId);
    const s = (await kv.get(key)) || { steps: [], done: false, runId: runId || null, ts: Date.now() };
    const now = Date.now();
    const relativeMs = now - s.ts;
    s.steps.push({ 
      ...step, 
      timestamp: relativeMs,
      ms: relativeMs,
      at: now
    });
    if (s.steps.length > 100) s.steps = s.steps.slice(-100);
    await kv.set(key, s, { ex: 900 });
  },
  
  async progressDone(sessionId, runId) {
    const key = this.progressKey(sessionId, runId);
    const s = (await kv.get(key)) || { steps: [], done: false, runId: runId || null, ts: Date.now() };
    s.done = true;
    await kv.set(key, s, { ex: 300 });
  },

  // Time and formatting helpers
  getCurrentTimeInPDT() {
    const timeZone = 'America/Los_Angeles';
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      timeZoneName: 'short',
    }).format(new Date());
  },

  // Search term normalization
  normalizeTerm(t) {
    return String(t || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  },

  uniqShort(list, max) {
    const out = [];
    const seen = new Set();
    for (const t of list.map(this.normalizeTerm)) {
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
      if (out.length >= max) break;
    }
    return out;
  },

  // JSON extraction
  extractJson(text) {
    if (!text) return null;
    const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e) {
          return null;
        }
      }
      return null;
    }
  },

  // Timeout wrapper
  withTimeout(promise, ms, defaultValue) {
    let timeoutId = null;
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(defaultValue), ms);
    });
    return Promise.race([promise, timeoutPromise]).then(result => {
      clearTimeout(timeoutId);
      return result;
    });
  },

  // Genre extraction
  extractGenreFromSynopsis(synopsis) {
    if (!synopsis) return null;
    
    const synopsisLower = synopsis.toLowerCase();
    const genrePatterns = {
      action: /\b(action|fight|chase|explosion|battle|war|combat|hero|villain)\b/i,
      comedy: /\b(comedy|funny|humor|hilarious|laugh|sitcom|comedic)\b/i,
      drama: /\b(drama|emotional|family|relationship|struggle|journey)\b/i,
      horror: /\b(horror|scary|terror|thriller|suspense|supernatural)\b/i,
      documentary: /\b(documentary|docu|non-fiction|true story|real|factual)\b/i,
      sports: /\b(sports|athletic|fitness|game|match|competition|championship)\b/i,
      scifi: /\b(sci-fi|science fiction|future|space|alien|technology|dystopian)\b/i,
      romance: /\b(romance|love|romantic|relationship|dating)\b/i,
      crime: /\b(crime|detective|investigation|murder|police|criminal)\b/i
    };
    
    for (const [genre, pattern] of Object.entries(genrePatterns)) {
      if (pattern.test(synopsis)) {
        return genre;
      }
    }
    
    return 'general';
  },

  // Production context extraction
  extractLastProduction(conversation) {
    if (!conversation) return null;
    
    const patterns = [
      /Synopsis:([\s\S]+?)(?=\nUser:|\nAI:|$)/gi,
      /Production:([\s\S]+?)(?=\nUser:|\nAI:|$)/gi,
      /(?:movie|film|show|series|production)[\s\S]{0,500}?(?:starring|featuring|about|follows)[\s\S]+?(?=\nUser:|\nAI:|$)/gi
    ];
    
    for (const pattern of patterns) {
      const matches = conversation.match(pattern);
      if (matches && matches.length > 0) {
        const lastProduction = matches[matches.length - 1];
        return lastProduction
          .replace(/^(Synopsis:|Production:)\s*/i, '')
          .trim();
      }
    }
    
    return null;
  }
};

// Optimized O365 API client
const o365API = {
  accessToken: null,
  tokenExpiry: null,
  baseUrl: 'https://graph.microsoft.com/v1.0',
  
  async getAccessToken() {
    try {
      if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
        return this.accessToken;
      }
      
      const tokenUrl = `https://login.microsoftonline.com/${ENV.msftTenantId}/oauth2/v2.0/token`;
      const params = new URLSearchParams({
        client_id: ENV.msftClientId,
        client_secret: ENV.msftClientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      });
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      
      if (!response.ok) {
        throw new Error(`Microsoft auth failed: ${response.status}`);
      }
      
      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = new Date(Date.now() + (data.expires_in - 300) * 1000);
      
      return this.accessToken;
    } catch (error) {
      console.error('[O365] Auth error:', error);
      throw error;
    }
  },
  
  async searchEmails(query, options = {}) {
    try {
      if (!ENV.msftClientId || !ENV.msftClientSecret || !ENV.msftTenantId) {
        return { emails: [], o365Status: 'no_credentials', userEmail: null };
      }
      
      const accessToken = await this.getAccessToken();
      const userEmail = options.userEmail || 'stacy@hollywoodbranded.com';
      
      let searchTerms = [];
      if (Array.isArray(query)) {
        searchTerms = Utils.uniqShort(query, 7);
      } else {
        searchTerms = Utils.uniqShort(String(query || '').split(/[,\|]/), 7);
      }
      
      if (searchTerms.length === 0) {
        return { emails: [], o365Status: 'ok', userEmail };
      }
      
      const results = [];
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
              'Authorization': `Bearer ${accessToken}`,
              'ConsistencyLevel': 'eventual',
              'Prefer': 'outlook.body-content-type="text"',
            },
            signal: controller.signal
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
            emails: data.value?.map(m => ({
              id: m.id,
              subject: m.subject,
              from: m.from?.emailAddress?.address,
              fromName: m.from?.emailAddress?.name,
              receivedDate: m.receivedDateTime,
              preview: m.bodyPreview?.slice(0, 200),
              webLink: m.webLink,
            })) || []
          };
        } catch (error) {
          clearTimeout(timeoutId);
          console.error('[O365] Query error:', error.message);
          return { emails: [] };
        }
      });
      
      const queryResults = await Promise.all(queryPromises);
      
      if (queryResults.some(r => r.raopBlocked)) {
        return { emails: [], o365Status: 'forbidden_raop', userEmail };
      }
      
      const uniqueEmails = new Map();
      queryResults.forEach(result => {
        if (result.emails) {
          result.emails.forEach(email => {
            if (!uniqueEmails.has(email.id)) {
              uniqueEmails.set(email.id, email);
            }
          });
        }
      });
      
      const sortedEmails = Array.from(uniqueEmails.values())
        .sort((a, b) => new Date(b.receivedDate) - new Date(a.receivedDate))
        .slice(0, options.limit || 12);
      
      return { emails: sortedEmails, o365Status: 'ok', userEmail };
      
    } catch (error) {
      console.error('[O365] Search error:', error);
      return { emails: [], o365Status: 'error', userEmail: null };
    }
  },
  
  async createDraft(subject, body, to, options = {}) {
    try {
      const accessToken = await this.getAccessToken();
      const senderEmail = options.senderEmail || 'shap@hollywoodbranded.com';
      
      const draftData = {
        subject: subject,
        body: {
          contentType: options.isHtml !== false ? 'HTML' : 'Text',
          content: body
        },
        toRecipients: Array.isArray(to) ? 
          to.map(email => ({ emailAddress: { address: email } })) : 
          (to ? [{ emailAddress: { address: to } }] : [{ emailAddress: { address: 'shap@hollywoodbranded.com' } }])
      };
      
      if (options.cc) {
        draftData.ccRecipients = Array.isArray(options.cc) ?
          options.cc.map(email => ({ emailAddress: { address: email } })) :
          [{ emailAddress: { address: options.cc } }];
      }
      
      const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(draftData)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Draft creation failed: ${response.status} - ${errorText}`);
      }
      
      const draft = await response.json();
      
      const webLinkResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/messages/${draft.id}?$select=webLink`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      let webLink = null;
      if (webLinkResponse.ok) {
        const webLinkData = await webLinkResponse.json();
        webLink = webLinkData.webLink;
      }
      
      return { id: draft.id, webLink };
      
    } catch (error) {
      console.error('[O365] Draft error:', error);
      throw error;
    }
  },
  
  async testConnection() {
    try {
      const token = await this.getAccessToken();
      const probeEmail = 'stacy@hollywoodbranded.com';
      
      const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(probeEmail)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      return response.ok;
    } catch (error) {
      return false;
    }
  }
};

// Optimized search functions
async function searchFireflies(query, options = {}) {
  if (!firefliesApiKey) {
    return { transcripts: [], firefliesStatus: 'no_credentials' };
  }
  
  try {
    const isConnected = await firefliesAPI.testConnection();
    if (!isConnected) {
      if (firefliesAPI.initialize) {
        await firefliesAPI.initialize();
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        return { transcripts: [], firefliesStatus: 'connection_failed' };
      }
    }
    
    let searchTerms = [];
    let meetingsMode = 'entity_search';
    
    if (Array.isArray(query)) {
      searchTerms = query.filter(term => {
        const termLower = String(term).toLowerCase().trim();
        const genericTerms = ['millennial', 'paris', 'luxury', 'thriller', 'drama', 'comedy', 'action', 'romance'];
        return term && termLower !== '' && !genericTerms.includes(termLower);
      });
    } else if (typeof query === 'string' && query.trim()) {
      const extractedTerms = await extractKeywordsForContextSearch(query);
      searchTerms = extractedTerms.filter(term => term && String(term).trim() !== '');
    }
    
    let allTranscripts = new Map();
    
    if (searchTerms.length > 0) {
      for (const term of searchTerms.slice(0, 10)) {
        if (!term || String(term).trim() === '') continue;
        
        try {
          const safeTerm = String(term).trim();
          const filters = {
            keyword: safeTerm,
            limit: options.limit || 10
          };
          
          if (options.fromDate) {
            filters.fromDate = options.fromDate;
          }
          
          const results = await firefliesAPI.searchTranscripts(filters);
          results.forEach(t => {
            allTranscripts.set(t.id, t);
          });
        } catch (error) {
          console.error(`[Fireflies] Error searching for term "${term}":`, error);
        }
      }
    }
    
    const individualResults = Array.from(allTranscripts.values());
    
    if (individualResults.length > 0) {
      return {
        transcripts: individualResults,
        firefliesStatus: 'ok',
        meetingsMode: 'entity_search'
      };
    }
    
    const recentFilters = {
      limit: 10,
      fromDate: options.fromDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    };
    
    const recentResults = await firefliesAPI.searchTranscripts(recentFilters);
    
    return {
      transcripts: recentResults || [],
      firefliesStatus: 'ok',
      meetingsMode: 'recent_fallback'
    };
    
  } catch (error) {
    console.error('[Fireflies] Search error:', error);
    return { transcripts: [], firefliesStatus: 'error' };
  }
}

// Optimized keyword extraction functions
async function extractKeywordsForHubSpot(synopsis) {
  if (!ENV.openAIApiKey) return '';
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        Authorization: `Bearer ${ENV.openAIApiKey}` 
      },
      body: JSON.stringify({
        model: CONFIG.models.openai.chatLegacy,
        messages: [
          { 
            role: 'system', 
            content: "Analyze this production synopsis and identify 3-5 brand categories that would resonate with its audience. Think about: What brands would viewers of this content naturally gravitate toward? What lifestyle/aspirations does this story represent? What demographic psychographics emerge? Return ONLY category keywords that brands use, separated by spaces. Be specific and insightful - go beyond obvious genre matches to find authentic brand-audience alignment." 
          },
          { role: 'user', content: synopsis }
        ],
        temperature: 0.3,
        max_tokens: 40
      }),
    });
    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    return '';
  }
}

async function extractKeywordsForContextSearch(text) {
  if (!ENV.openAIApiKey) return [];
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        Authorization: `Bearer ${ENV.openAIApiKey}` 
      },
      body: JSON.stringify({
        model: CONFIG.models.openai.chatLegacy,
        messages: [
          { 
            role: 'system', 
            content: 'Return up to 5 proper nouns/entities: Project title, studio/distributor, talent names, company/brand names. Do not return demographics or generic terms like "Millennial", "Paris", "luxury", "thriller". If no clear title is found, synthesize "Untitled [Genre] Project". Return as JSON: {"keywords": ["entity1", "entity2", ...]}. Multi-word names should be in quotes.' 
          },
          { role: 'user', content: text }
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);
    return Array.isArray(result.keywords) ? result.keywords : [];
  } catch (error) {
    console.error("[Context] Error extracting keywords:", error);
    return [];
  }
}

// Conversation history helper
async function getConversationHistory(sessionId, projectId, chatUrl, headersAirtable) {
  try {
    const searchUrl = `${chatUrl}?filterByFormula=AND(SessionID="${sessionId}",ProjectID="${projectId || 'default'}")`;
    const historyResponse = await fetch(searchUrl, { headers: headersAirtable });
    if (historyResponse.ok) {
      const result = await historyResponse.json();
      if (result.records.length > 0) {
        return result.records[0].fields.Conversation || '';
      }
    }
  } catch (error) {
    console.error('Error fetching conversation history:', error);
  }
  return '';
}

// Airtable conversation update helper
async function updateAirtableConversation(sessionId, projectId, chatUrl, headersAirtable, updatedConversation, existingRecordId) {
  try {
    let conversationToSave = updatedConversation;
    if (conversationToSave.length > 10000) {
      conversationToSave = '...' + conversationToSave.slice(-10000);
    }
    
    const recordData = {
      fields: {
        SessionID: sessionId,
        ProjectID: projectId || 'default',
        Conversation: conversationToSave
      }
    };

    if (existingRecordId) {
      await fetch(`${chatUrl}/${existingRecordId}`, {
        method: 'PATCH',
        headers: headersAirtable,
        body: JSON.stringify({ fields: recordData.fields }),
      });
    } else {
      await fetch(chatUrl, {
        method: 'POST',
        headers: headersAirtable,
        body: JSON.stringify(recordData),
      });
    }
  } catch (error) {
    console.error('Airtable update error:', error);
  }
}

// Project configuration helper
function getProjectConfig(projectId) {
  return CONFIG.projects[projectId] || CONFIG.projects['default'];
}

// Search terms builder
function buildSearchTerms({ title, distributor, talent = [], keywords = [] }) {
  const fieldEntities = [title, distributor, ...talent.slice(0, 3)].filter(Boolean);
  const base = Array.isArray(keywords) ? keywords : String(keywords || '').split(/[,\|]/);
  const commsTerms = Utils.uniqShort([...fieldEntities, ...base], 7);
  const hubspotTerms = Utils.uniqShort([...base, title].filter(Boolean), 8);
  return { commsTerms, hubspotTerms };
}

// Optimized AI response functions
async function getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent) {
  try {
    const messages = [
      { role: 'system', content: systemMessageContent },
      { role: 'user', content: userMessage }
    ];
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ENV.openAIApiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.models.openai.chat,
        messages: messages,
        max_tokens: 1000,
        temperature: 0.7
      }),
    });
    
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    throw error;
  }
}

async function getTextResponseFromClaude(userMessage, sessionId, systemMessageContent) {
  try {
    let claudeSystemPrompt = `<role>You are an expert brand partnership analyst for Hollywood entertainment. You provide honest, nuanced analysis while being helpful and conversational.</role>

${systemMessageContent}`;
    
    if (systemMessageContent.includes('BRAND_ACTIVITY') && systemMessageContent.includes('**ABSOLUTE REQUIREMENT')) {
      claudeSystemPrompt += `\n\n<critical_instruction>
YOU MUST DISPLAY EVERY SINGLE ITEM IN THE COMMUNICATIONS ARRAY. 
Do not summarize, skip, or combine items.
The user's trust depends on seeing ALL items that were found.
Before responding, count your numbered items - it must match the total specified.
</critical_instruction>`;
    }
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ENV.anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CONFIG.models.anthropic.claude,
        max_tokens: 4000,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: `${claudeSystemPrompt}\n\nUser's request: ${userMessage}`
          }
        ]
      })
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('Claude API response:', response.status, errorData);
      throw new Error(`Claude API error: ${response.status} - ${errorData}`);
    }
    
    const data = await response.json();
    return data.content?.[0]?.text || null;
  } catch (error) {
    console.error('Claude failed, falling back to OpenAI:', error);
    if (ENV.openAIApiKey) {
      return getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent);
    }
    throw error;
  }
}

// Intent routing helper
async function routeUserIntent(userMessage, conversationContext, lastProductionContext) {
  if (!ENV.openAIApiKey) return { tool: 'answer_general_question' };

  const tools = [
    {
      type: 'function',
      function: {
        name: 'find_brands',
        description: 'Use when user wants brand recommendations or suggestions. This includes: asking for brands for a project/production, requesting "more brands", finding brands that match criteria, or any variation of brand discovery/search. If they reference "this project" or "this production", combine with the last production context.',
        parameters: {
          type: 'object',
          properties: { 
            search_term: { type: 'string', description: 'Either the user\'s specific search criteria OR the last production context if they reference "this project/production".' }
          },
          required: ['search_term']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_brand_activity',
        description: 'Use when user wants to see communications (emails/meetings) about a specific brand, person, or partnership. This includes: "show me emails for X", "find all meetings with Y", "what meetings and emails do we have with Z", "show all communications for X", "what\'s the activity for Z brand", or any request for communication history. ALWAYS use this for requests about emails OR meetings OR both.',
        parameters: {
          type: 'object',
          properties: { 
            search_query: { type: 'string', description: 'The brand name, person name, or partnership/project name to search for in communications.' }
          },
          required: ['search_query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_pitches_for_brands',
        description: 'Use when user wants detailed integration ideas or pitches for SPECIFIC named brands. Key indicators: "create pitches for [brand names]", "why would [brand] work", "give me ideas for [brand]", "deep dive on [brands]". This is for generating creative integration strategies.',
        parameters: {
          type: 'object',
          properties: {
            brand_names: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'List of specific brand names mentioned by the user.' 
            }
          },
          required: ['brand_names']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'answer_general_question',
        description: 'Use for general questions, greetings, clarifications, or anything that doesn\'t require searching databases. Examples: "how are you?", "what can you do?", "explain product placement", general knowledge questions.',
        parameters: { type: 'object', properties: {} }
      }
    }
  ];

  try {
    const systemPrompt = `You are an intelligent routing system that UNDERSTANDS context and user intent, not just keywords.

CRITICAL ROUTING RULES:
1. READ and UNDERSTAND what the user is actually asking for, don't just match keywords
2. If user says "for this project" or "this production" without providing details, use the Last Production Context
3. Focus on the ACTION they want: finding brands, seeing communications, generating ideas, or general chat

ROUTING LOGIC:
- "find brands" / "more brands" / "brands for this" → find_brands (use context if vague)
- ANY request for emails, meetings, or both about a specific entity → get_brand_activity
  Examples: "find all emails with X", "show meetings for Y", "find all meetings and emails with Z"
- "create pitches for [brands]" / "ideas for [brands]" / "why [brand] works" → create_pitches_for_brands
- General questions / chat → answer_general_question

IMPORTANT: If user asks for emails, meetings, or communications about a specific brand/person/project, ALWAYS use get_brand_activity - it handles both emails AND meetings.

When the user references "this project" or is vague, COMBINE their request with the Last Production Context to create a complete search term.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { 
        role: 'user', 
        content: `Last Production Context:\n"""\n${lastProductionContext || 'None available'}\n"""\n\nUser's Request:\n"""\n${userMessage}\n"""\n\nBased on your UNDERSTANDING of what the user wants, route to the appropriate tool. If they reference "this project" and there's a Last Production Context, use it to complete their request.`
      }
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ENV.openAIApiKey}` },
      body: JSON.stringify({ 
        model: CONFIG.models.openai.chatMini,
        messages, 
        tools, 
        tool_choice: 'auto',
        temperature: 0.3
      })
    });

    if (!response.ok) throw new Error('AI router failed');
    const data = await response.json();
    const toolCall = data.choices[0].message.tool_calls?.[0];

    if (toolCall) {
      const args = JSON.parse(toolCall.function.arguments);
      
      if (toolCall.function.name === 'find_brands') {
        if (args.search_term && args.search_term.length < 50 && lastProductionContext) {
          const vagueTerms = ['this project', 'this production', 'more brands', 'additional brands', 'other brands'];
          const isVague = vagueTerms.some(term => args.search_term.toLowerCase().includes(term));
          
          if (isVague) {
            args.search_term = lastProductionContext;
          }
        } else if (!args.search_term && lastProductionContext) {
          args.search_term = lastProductionContext;
        } else if (!args.search_term) {
          args.search_term = userMessage;
        }
      }
      
      if (toolCall.function.name === 'get_brand_activity' && args.search_query) {
        args.brand_name = args.search_query;
        delete args.search_query;
      }
      
      return { tool: toolCall.function.name, args };
    }
    return { tool: 'answer_general_question' };
  } catch (error) {
    console.error('Error in AI router:', error);
    return { tool: 'answer_general_question' };
  }
}

// Search utility helper
async function shouldUseSearch(userMessage, conversationContext) {
  const searchKeywords = ['brand', 'production', 'show', 'movie', 'series', 'find', 'search', 'recommend', 'suggestion', 'partner'];
  const messageLower = userMessage.toLowerCase();
  return searchKeywords.some(keyword => messageLower.includes(keyword));
}

// Main handler function
export default async function handler(req, res) {
  // CORS headers
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  // GET endpoint for progress
  if (req.method === 'GET' && req.query.progress === 'true') {
    const { sessionId, runId } = req.query;
    res.setHeader("Cache-Control", "no-store");
    
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    
    const key = Utils.progressKey(sessionId, runId);
    const s = (await kv.get(key)) || { steps: [], done: false, runId: runId || null };
    
    if (runId && s.runId !== runId) {
      return res.status(200).json({ steps: [], done: false, runId });
    }
    return res.status(200).json(s);
  }
  
  if (req.method === 'POST') {
    try {
      // Handle Push Draft endpoint
      if (req.body.pushDraft === true) {
        return await handlePushDraft(req, res);
      }
      
      // Handle Audio Generation
      if (req.body.generateAudio === true) {
        return await handleAudioGeneration(req, res);
      }
      
      // Handle Video Generation
      if (req.body.generateVideo === true) {
        return await handleVideoGeneration(req, res);
      }
      
      // Handle Image Generation
      if (req.body.generateImage === true) {
        return await handleImageGeneration(req, res);
      }
      
      // Handle main chat
      return await handleMainChat(req, res);
      
    } catch (error) {
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  } else {
    res.setHeader("Allow", ["POST", "OPTIONS"]);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
}

// Handler for Push Draft functionality
async function handlePushDraft(req, res) {
  const { productionData, brands, sessionId } = req.body;
  
  if (!productionData || !brands || brands.length === 0) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      details: 'productionData and brands array are required'
    });
  }
  
  if (!ENV.openAIApiKey || !ENV.msftClientId || !ENV.msftClientSecret) {
    return res.status(500).json({ 
      error: 'Push feature not configured',
      details: 'Missing OpenAI or Microsoft Graph credentials'
    });
  }
  
  try {
    console.log('[DEBUG pushDraft] Starting push draft creation...');
    
    // Generate email content using OpenAI
    const emailPrompt = `You are Shap, a brand partnership executive at Hollywood Branded. Write a PERSONAL, conversational email to yourself (as a draft) summarizing brand recommendations for a production.

Production Details:
- Title: ${productionData.knownProjectName || 'Untitled Production'}
- Vibe/Genre: ${productionData.vibe || 'Not specified'}
- Cast: ${productionData.cast || 'TBD'}
- Location: ${productionData.location || 'TBD'}
- Notes: ${productionData.notes || 'None'}

Selected Brands for Consideration (${brands.length} total):
${brands.map((brand, i) => `
${i + 1}. ${brand.name}
   - Category: ${brand.category || 'General'}
   - Why it works: ${brand.reason || brand.pitch || 'Good fit for production'}
   - Status: ${brand.clientStatus || 'Prospect'}
   ${brand.tags ? `- Tags: ${Array.isArray(brand.tags) ? brand.tags.join(', ') : brand.tags}` : ''}
`).join('\n')}

Write a draft email to yourself that:
1. Opens with a brief, personal reminder about this production (1-2 sentences)
2. Lists the brands with quick notes on why each could work
3. Includes any action items or next steps
4. Keeps a casual, note-to-self tone (this is YOUR draft folder)
5. Signs off as "- Shap" or similar

Format as HTML with simple formatting (use <br> for line breaks, <b> for emphasis, <ul>/<li> for lists).
Keep it under 300 words.`;

    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ENV.openAIApiKey}`
      },
      body: JSON.stringify({
        model: CONFIG.models.openai.chatMini,
        messages: [
          { role: 'system', content: 'You are Shap, writing a draft email to yourself about brand partnerships. Keep it personal and conversational.' },
          { role: 'user', content: emailPrompt }
        ],
        temperature: 0.7,
        max_tokens: 800
      })
    });
    
    if (!openAIResponse.ok) {
      throw new Error('Failed to generate email content');
    }
    
    const aiData = await openAIResponse.json();
    const emailBody = aiData.choices[0].message.content;
    
    // Create draft in Outlook
    const emailSubject = `Brand Recs: ${productionData.knownProjectName || 'Untitled Production'} (${brands.length} brands)`;
    
    const draftResult = await o365API.createDraft(
      emailSubject,
      emailBody,
      'shap@hollywoodbranded.com',
      { senderEmail: 'shap@hollywoodbranded.com', isHtml: true }
    );
    
    return res.status(200).json({
      success: true,
      draftId: draftResult.id,
      webLink: draftResult.webLink,
      webLinks: [draftResult.webLink],
      message: 'Draft created successfully in Outlook'
    });
    
  } catch (error) {
    console.error('[DEBUG pushDraft] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to create draft',
      details: error.message 
    });
  }
}

// Handler for Audio Generation
async function handleAudioGeneration(req, res) {
  const { prompt, projectId, sessionId } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      details: 'prompt is required'
    });
  }
  
  if (!ENV.elevenLabsApiKey) {
    return res.status(500).json({ 
      error: 'Audio generation service not configured',
      details: 'Please configure ELEVENLABS_API_KEY'
    });
  }
  
  try {
    const projectConfig = getProjectConfig(projectId);
    const { voiceId, voiceSettings } = projectConfig;
    
    const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    
    const elevenLabsResponse = await fetch(elevenLabsUrl, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ENV.elevenLabsApiKey
      },
      body: JSON.stringify({
        text: prompt,
        model_id: CONFIG.models.elevenlabs.voice,
        voice_settings: voiceSettings
      })
    });
    
    if (!elevenLabsResponse.ok) {
      const errorText = await elevenLabsResponse.text();
      return res.status(elevenLabsResponse.status).json({ 
        error: 'Failed to generate audio',
        details: errorText
      });
    }
    
    const audioBuffer = await elevenLabsResponse.buffer();
    const timestamp = Date.now();
    const filename = `${sessionId || 'unknown-session'}/audio-narration-${timestamp}.mp3`;
    
    const { url: permanentUrl } = await put(
      filename,
      audioBuffer,
      { access: 'public', contentType: 'audio/mpeg' }
    );
    
    return res.status(200).json({
      success: true,
      audioUrl: permanentUrl,
      voiceUsed: voiceId,
      storage: 'blob'
    });
    
  } catch (error) {
    console.error('[DEBUG generateAudio] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to generate audio',
      details: error.message 
    });
  }
}
