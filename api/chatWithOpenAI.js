import dotenv from 'dotenv';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import RunwayML from '@runwayml/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import hubspotAPI, { hubspotApiKey } from './hubspot-client.js';
import firefliesAPI, { firefliesApiKey } from './fireflies-client.js';

dotenv.config();

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const airtableApiKey = process.env.AIRTABLE_API_KEY;
const openAIApiKey = process.env.OPENAI_API_KEY;
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const runwayApiKey = process.env.RUNWAY_API_KEY;
const googleGeminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;
const msftTenantId = process.env.MICROSOFT_TENANT_ID;
const msftClientId = process.env.MICROSOFT_CLIENT_ID;
const msftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;

const PROJECT_CONFIGS = {
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
};


const microsoftTenantId = process.env.MICROSOFT_TENANT_ID;
const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;
const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;

const o365API = {
  accessToken: null,
  tokenExpiry: null,
  
  async getAccessToken() {
    try {
      console.log('[DEBUG o365API.getAccessToken] Checking existing token...');
      
      if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
        console.log('[DEBUG o365API.getAccessToken] Using cached token');
        return this.accessToken;
      }
      
      console.log('[DEBUG o365API.getAccessToken] Getting new token...');
      console.log('[DEBUG o365API.getAccessToken] Tenant ID present:', !!msftTenantId);
      console.log('[DEBUG o365API.getAccessToken] Client ID present:', !!msftClientId);
      console.log('[DEBUG o365API.getAccessToken] Client Secret present:', !!msftClientSecret);
      
      const tokenUrl = `https://login.microsoftonline.com/${msftTenantId}/oauth2/v2.0/token`;
      
      const params = new URLSearchParams({
        client_id: msftClientId,
        client_secret: msftClientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      });
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[DEBUG o365API.getAccessToken] Auth failed:', response.status, errorText);
        throw new Error(`Microsoft auth failed: ${response.status}`);
      }
      
      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = new Date(Date.now() + (data.expires_in - 300) * 1000);
      
      console.log('[DEBUG o365API.getAccessToken] Got new token, expires:', this.tokenExpiry);
      
      return this.accessToken;
    } catch (error) {
      console.error('[DEBUG o365API.getAccessToken] Exception:', error);
      throw error;
    }
  },
  
  async searchEmails(query, options = {}) {
    try {
      console.log('[DEBUG o365API.searchEmails] Starting search for:', query);
      console.log('[DEBUG o365API.searchEmails] Options:', options);
      
      if (!msftClientId || !msftClientSecret || !msftTenantId) {
        console.error('[DEBUG o365API.searchEmails] Missing Microsoft credentials');
        return [];
      }
      
      const accessToken = await this.getAccessToken();
      console.log('[DEBUG o365API.searchEmails] Got access token');
      
      const userEmail = options.userEmail || 'stacy@hollywoodbranded.com';
      console.log('[DEBUG o365API.searchEmails] Searching emails for user:', userEmail);
      
      // If query is an array, it's pre-extracted keywords
      let searchTerms;
      if (Array.isArray(query)) {
        searchTerms = query;
      } else {
        // For simple searches (like brand names), use the raw query
        searchTerms = [query];
        
        // Only extract keywords for complex queries
        if (query.length > 50) {
          const extractedTerms = await extractKeywordsForContextSearch(query);
          if (extractedTerms.length > 0) {
            // Combine raw query with extracted terms
            searchTerms = [...new Set([query.slice(0, 50), ...extractedTerms])];
          }
        }
      }
      
      console.log('[DEBUG o365API.searchEmails] Search terms:', searchTerms);
      
      let allEmails = new Map();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - (options.days || 90));
      const dateFilter = fromDate.toISOString();
      
      // Search for each term
      for (const term of searchTerms.slice(0, 5)) { // Limit to 5 terms
        try {
          // Limit search term to 20 characters to avoid timeouts
          let searchTerm = term.replace(/'/g, "''");
          
          // If term is too long, truncate it intelligently
          if (searchTerm.length > 20) {
            // Try to cut at word boundary
            searchTerm = searchTerm.substring(0, 20).split(' ').slice(0, -1).join(' ') || searchTerm.substring(0, 20);
          }
          
          // Skip if search term is too short after processing
          if (searchTerm.length < 2) continue;
          
          console.log(`[DEBUG o365API.searchEmails] Searching for term: "${searchTerm}" (original: "${term}")`);
          
          // Search in both subject and body
          const filter = `receivedDateTime ge ${dateFilter} and (contains(subject,'${searchTerm}') or contains(body/content,'${searchTerm}'))`;
          
          const messagesUrl = `https://graph.microsoft.com/v1.0/users/${userEmail}/messages?$filter=${encodeURIComponent(filter)}&$top=10&$select=id,subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc`;
          
          console.log('[DEBUG o365API.searchEmails] Request URL length:', messagesUrl.length);
          
          // Add timeout to prevent hanging on 504 errors
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
          
          try {
            const response = await fetch(messagesUrl, {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
              const data = await response.json();
              console.log(`[DEBUG o365API.searchEmails] Found ${data.value?.length || 0} emails for term "${searchTerm}"`);
              
              (data.value || []).forEach(email => {
                allEmails.set(email.id, email);
                console.log(`[DEBUG o365API.searchEmails] Added email: ${email.subject} from ${email.from?.emailAddress?.address}`);
              });
            } else {
              const errorText = await response.text();
              console.error(`[DEBUG o365API.searchEmails] Failed for term "${searchTerm}":`, response.status, errorText);
              
              // If we get a 504 timeout, skip remaining terms to avoid more timeouts
              if (response.status === 504) {
                console.warn('[DEBUG o365API.searchEmails] Got 504 timeout, skipping remaining search terms');
                break;
              }
            }
          } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
              console.error(`[DEBUG o365API.searchEmails] Request timeout for term "${searchTerm}"`);
              // Continue with next term instead of breaking
            } else {
              throw fetchError;
            }
          }
        } catch (error) {
          // Continue with other terms if one fails
          console.error(`[DEBUG o365API.searchEmails] Error searching for term "${term}":`, error);
        }
      }
      
      // Format and return unique emails
      const formattedEmails = Array.from(allEmails.values()).map(email => ({
        subject: email.subject,
        from: email.from?.emailAddress?.address,
        fromName: email.from?.emailAddress?.name,
        receivedDate: email.receivedDateTime,
        preview: email.bodyPreview?.slice(0, 200)
      }));
      
      // Sort by date and limit results
      const sortedEmails = formattedEmails
        .sort((a, b) => new Date(b.receivedDate) - new Date(a.receivedDate))
        .slice(0, options.limit || 20);
      
      console.log(`[DEBUG o365API.searchEmails] Returning ${sortedEmails.length} total emails`);
      
      return sortedEmails;
      
    } catch (error) {
      console.error('[DEBUG o365API.searchEmails] Fatal error:', error);
      return [];
    }
  },
  
  async createDraft(subject, body, to, options = {}) {
    try {
      const accessToken = await this.getAccessToken();
      
      const draftData = {
        subject: subject,
        body: {
          contentType: options.isHtml ? 'HTML' : 'Text',
          content: body
        },
        toRecipients: Array.isArray(to) ? 
          to.map(email => ({ emailAddress: { address: email } })) : 
          [{ emailAddress: { address: to } }]
      };
      
      if (options.cc) {
        draftData.ccRecipients = Array.isArray(options.cc) ?
          options.cc.map(email => ({ emailAddress: { address: email } })) :
          [{ emailAddress: { address: options.cc } }];
      }
      
      const response = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(draftData)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Draft creation failed: ${response.status}`);
      }
      
      const draft = await response.json();
      
      return {
        id: draft.id,
        webLink: draft.webLink
      };
      
    } catch (error) {
      throw error;
    }
  },
  
  async testConnection() {
    try {
      const token = await this.getAccessToken();
      
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        return false;
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }
};


async function searchFireflies(query, options = {}) {
  if (!firefliesApiKey) {
    console.log('[DEBUG searchFireflies] No API key available');
    return { transcripts: [] };
  }
  
  try {
    console.log('[DEBUG searchFireflies] Starting search with query:', query);
    console.log('[DEBUG searchFireflies] Options:', options);
    
    const isConnected = await firefliesAPI.testConnection();
    if (!isConnected) {
      console.error('[DEBUG searchFireflies] Failed connection test');
      return { transcripts: [] };
    }
    
    console.log('[DEBUG searchFireflies] Connection successful');
    
    // If no query or empty query, get recent transcripts without keyword filter
    if (!query || query.trim() === '') {
      console.log('[DEBUG searchFireflies] No query provided, fetching recent transcripts');
      const filters = {
        limit: options.limit || 10
      };
      
      if (options.fromDate) {
        filters.fromDate = options.fromDate;
      }
      
      const results = await firefliesAPI.searchTranscripts(filters);
      console.log(`[DEBUG searchFireflies] Found ${results.length} recent transcripts`);
      
      return {
        transcripts: results
      };
    }
    
    // If query is an array, it's pre-extracted keywords
    let searchTerms;
    if (Array.isArray(query)) {
      searchTerms = query.filter(term => term && term.trim() !== ''); // Filter out empty terms
      console.log('[DEBUG searchFireflies] Using provided search terms:', searchTerms);
    } else {
      // For simple searches (like brand names), also search the raw query
      searchTerms = [query.trim()]; // Start with the raw query
      
      // Only extract keywords for complex queries
      if (query.length > 50) {
        const extractedTerms = await extractKeywordsForContextSearch(query);
        console.log('[DEBUG searchFireflies] Extracted keywords:', extractedTerms);
        // Add extracted terms but keep the original simpler terms too
        searchTerms = [...new Set([...searchTerms, ...extractedTerms])].filter(term => term && term.trim() !== '');
      }
      
      console.log('[DEBUG searchFireflies] Final search terms:', searchTerms);
    }
    
    // If no valid search terms, get recent transcripts
    if (searchTerms.length === 0) {
      console.log('[DEBUG searchFireflies] No valid search terms, fetching recent transcripts');
      const filters = {
        limit: options.limit || 10
      };
      
      if (options.fromDate) {
        filters.fromDate = options.fromDate;
      }
      
      const results = await firefliesAPI.searchTranscripts(filters);
      return {
        transcripts: results
      };
    }
    
    let allTranscripts = new Map();
    
    // Search for each term and combine results
    for (const term of searchTerms.slice(0, 10)) { // Increased limit
      if (!term || term.trim() === '') continue; // Skip empty terms
      
      try {
        console.log(`[DEBUG searchFireflies] Searching for term: "${term}"`);
        
        const filters = {
          keyword: term.trim(),
          limit: options.limit || 10 // Increased default limit
        };
        
        // Add date filter if needed
        if (options.fromDate) {
          filters.fromDate = options.fromDate;
        }
        
        const results = await firefliesAPI.searchTranscripts(filters);
        console.log(`[DEBUG searchFireflies] Found ${results.length} results for "${term}"`);
        
        results.forEach(t => {
          allTranscripts.set(t.id, t);
          console.log(`[DEBUG searchFireflies] Added transcript: ${t.title} (${t.dateString})`);
        });
      } catch (error) {
        // Continue with other terms if one fails
        console.error(`[DEBUG searchFireflies] Error searching for term "${term}":`, error);
      }
    }
    
    const finalResults = Array.from(allTranscripts.values());
    console.log(`[DEBUG searchFireflies] Total unique transcripts found: ${finalResults.length}`);
    
    return {
      transcripts: finalResults
    };
    
  } catch (error) {
    console.error('[DEBUG searchFireflies] Fatal error:', error);
    return { transcripts: [] };
  }
}

function getProjectConfig(projectId) {
  const config = PROJECT_CONFIGS[projectId] || PROJECT_CONFIGS['default'];
  return config;
}

function getCurrentTimeInPDT() {
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
}

async function searchAirtable(query, projectId, searchType = 'auto', limit = 100) {
  return { searchType, records: [], total: 0 };
}

// ADD THIS NEW HELPER FUNCTION
async function extractKeywordsForHubSpot(synopsis) {
  if (!openAIApiKey) return '';
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: "Analyze this production synopsis and identify 3-5 brand categories that would resonate with its audience. Think about: What brands would viewers of this content naturally gravitate toward? What lifestyle/aspirations does this story represent? What demographic psychographics emerge? Return ONLY category keywords that brands use, separated by spaces. Be specific and insightful - go beyond obvious genre matches to find authentic brand-audience alignment." },
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

// Add this new helper function for context search
async function extractKeywordsForContextSearch(text) {
  if (!openAIApiKey) return [];
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Extract key entities from text for database search. From the text, extract: 1) Primary Project/Film Title, 2) Up to 3 key brand names mentioned, 3) Up to 3 relevant themes/genres. Return as JSON: {"keywords": ["term1", "term2", ...]}. Example: {"keywords": ["The Last Mrs. Parrish", "Netflix", "thriller", "luxury"]}' },
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
    console.error("Error extracting context keywords:", error);
    return [];
  }
}

// Add timeout wrapper for resilient searches
function withTimeout(promise, ms, defaultValue) {
  let timeoutId = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(defaultValue), ms);
  });
  return Promise.race([promise, timeoutPromise]).then(result => {
    clearTimeout(timeoutId);
    return result;
  });
}

// Add vibe match helper for pre-filtering
function isVibeMatch(productionSynopsis, brandCategory) {
  if (!productionSynopsis || !brandCategory) return false;
  
  const synopsis = productionSynopsis.toLowerCase();
  const category = brandCategory.toLowerCase();
  
  // Genre-to-category mapping
  const genreMap = {
    action: ['automotive', 'tech', 'gaming', 'energy drink', 'sports', 'electronics'],
    comedy: ['snack food', 'beverage', 'casual apparel', 'gaming', 'entertainment', 'food'],
    drama: ['luxury', 'fashion', 'automotive', 'beauty', 'home goods', 'apparel'],
    thriller: ['tech', 'security', 'automotive', 'insurance', 'electronics'],
    scifi: ['technology', 'automotive', 'gaming', 'aerospace', 'electronics', 'tech'],
    romance: ['jewelry', 'fashion', 'travel', 'luxury', 'beauty', 'floral', 'apparel'],
    family: ['food', 'beverage', 'entertainment', 'travel', 'home', 'baby'],
    horror: ['entertainment', 'gaming', 'streaming'],
    crime: ['automotive', 'security', 'tech', 'insurance']
  };

  for (const genre in genreMap) {
    if (synopsis.includes(genre)) {
      if (genreMap[genre].some(cat => category.includes(cat))) {
        return true;
      }
    }
  }
  return false;
}

// Extract JSON from AI response text
function extractJson(text) {
  // First try to parse the whole text
  try {
    return JSON.parse(text);
  } catch (e) {
    // If that fails, look for JSON object pattern
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e) {
        return null;
      }
    }
    return null;
  }
}

async function narrowWithOpenAI(airtableBrands, hubspotBrands, meetings, firefliesTranscripts, userMessage) {
  try {
    const allBrands = [...hubspotBrands];
    const result = await narrowWithIntelligentTags(allBrands, firefliesTranscripts || [], [], userMessage);
    return {
      topBrands: result.topBrands || [],
      scores: {}
    };
  } catch (error) {
    return { topBrands: [], scores: {} };
  }
}

// REPLACE your old searchHubSpot function with this corrected version
async function searchHubSpot(query, projectId, limit = 50) {
  if (!hubspotApiKey) {
    return { brands: [], productions: [] };
  }
 
  try {
    const isConnected = await hubspotAPI.testConnection();
    if (!isConnected) {
      return { brands: [], productions: [] };
    }
    
    // The logic to extract a keyword has been removed, as the AI now handles this.
    // We will now use a more general filter to get relevant brands.
    const brandFilters = {
      filterGroups: [
        {
          filters: [
            { propertyName: 'brand_name', operator: 'HAS_PROPERTY' }
          ]
        },
        {
          filters: [
            { propertyName: 'lifecyclestage', operator: 'IN', values: ['customer', 'opportunity', 'salesqualifiedlead'] }
          ]
        }
      ]
    };

    const brandsData = await hubspotAPI.searchBrands({
      ...brandFilters,
      limit
    });

    const productionsData = await hubspotAPI.searchProductions({ limit });

    return {
      brands: brandsData.results || [],
      productions: productionsData.results || []
    };

  } catch (error) {
    console.error("Error in searchHubSpot:", error);
    return { brands: [], productions: [] };
  }
}

// REPLACE your old narrowWithIntelligentTags function with this
async function narrowWithIntelligentTags(hubspotBrands, firefliesTranscripts, emails, userMessage) {
  console.log('[DEBUG narrowWithIntelligentTags] Starting with', hubspotBrands?.length || 0, 'brands');
  
  if (!hubspotBrands || hubspotBrands.length === 0) {
    console.log('[DEBUG narrowWithIntelligentTags] No brands provided, returning empty');
    return { topBrands: [], taggedBrands: [] };
  }
  if (!openAIApiKey) {
    console.warn("[DEBUG narrowWithIntelligentTags] OpenAI API key not found. Returning unranked brands.");
    return { topBrands: hubspotBrands.slice(0, 15), taggedBrands: [] };
  }

  try {
    console.log('[DEBUG narrowWithIntelligentTags] Preparing brands for AI analysis...');
    const brandsForAI = hubspotBrands.map(b => {
      const brandData = {
        id: b.id,
        name: b.properties.brand_name || 'Unknown',
        category: b.properties.main_category || 'General',
        subcategories: b.properties.product_sub_category__multi_ || '',
        partnershipCount: parseInt(b.properties.partnership_count || 0),
        dealsCount: parseInt(b.properties.deals_count || 0),
        clientStatus: b.properties.client_status || '',
        clientType: b.properties.client_type || '',
        helper_tags: []
      };

      // Add meaningful tags based on reliable data
      if (brandData.clientStatus === 'Active' || brandData.clientStatus === 'Contract') {
        brandData.helper_tags.push('Active Client');
      }
      if (brandData.clientType === 'Retainer') {
        brandData.helper_tags.push('Retainer Client (Premium)');
      }
      if (brandData.partnershipCount >= 10) {
        brandData.helper_tags.push(`Proven Partner (${brandData.partnershipCount} partnerships)`);
      }
      if (brandData.dealsCount >= 5) {
        brandData.helper_tags.push(`High Activity (${brandData.dealsCount} deals)`);
      }
      
      return brandData;
    });

    const systemPrompt = `You are a precise data analysis engine. Your sole function is to return a valid JSON object and nothing else. Do not include any conversational text, pleasantries, or markdown formatting before or after the JSON. The JSON object must have a single key "results", which is an array of the ranked brands. Each result needs: "id" (MUST match input), "relevanceScore" (0-100), "tags" (descriptive strings), "reason" (concise explanation).`;
    
    // Truncate and escape userMessage to avoid JSON parsing issues
    let truncatedUserMessage = userMessage.length > 500 ? userMessage.slice(0, 500) + '...' : userMessage;
    // Escape special characters that break JSON
    truncatedUserMessage = truncatedUserMessage
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    
    // Also escape the brand data to prevent JSON issues
    const brandsForAISafe = JSON.stringify(brandsForAI, (key, value) => {
      if (typeof value === 'string') {
        return value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
      }
      return value;
    });
    
    const userPrompt = `Production/Request: "${truncatedUserMessage}"\n\nBrand List:\n\`\`\`json\n${brandsForAISafe}\n\`\`\``;

    console.log('[DEBUG narrowWithIntelligentTags] Calling Claude for ranking...');
    console.log('[DEBUG narrowWithIntelligentTags] Prompt length:', userPrompt.length, 'characters');
    console.log('[DEBUG narrowWithIntelligentTags] Number of brands:', brandsForAI.length);
    
    // Add timeout using AbortController
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    try {
      // Use Claude 3.5 Sonnet for better accuracy
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1000,
          temperature: 0.2,
          messages: [
            {
              role: 'user',
              content: `${systemPrompt}\n\n${userPrompt}\n\nIMPORTANT: Return ONLY brands from the input list. Do not invent new brands.`
            }
          ]
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeout);

      if (!response.ok) {
        console.error('[DEBUG narrowWithIntelligentTags] Claude API error:', response.status);
        const errorText = await response.text();
        console.error('[DEBUG narrowWithIntelligentTags] Error details:', errorText);
        
        // Fall back to OpenAI if Claude fails
        if (openAIApiKey) {
          console.log('[DEBUG narrowWithIntelligentTags] Falling back to OpenAI...');
          return narrowWithIntelligentTagsOpenAI(hubspotBrands, firefliesTranscripts, emails, userMessage);
        }
        
        throw new Error(`Claude API error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('[DEBUG narrowWithIntelligentTags] Claude response received');
      
      let rankedData;
      try {
        // Claude returns content in a different format
        const rawContent = data.content[0].text;
        console.log('[DEBUG narrowWithIntelligentTags] Raw response preview:', rawContent.substring(0, 100) + '...');
        
        rankedData = extractJson(rawContent);
        
        if (!rankedData) {
          throw new Error("Failed to parse valid JSON from Claude response");
        }
      } catch (parseError) {
        console.error('[DEBUG narrowWithIntelligentTags] JSON parse error:', parseError);
        console.error('[DEBUG narrowWithIntelligentTags] Raw response:', data.content[0].text);
        
        // Fall back to OpenAI if Claude fails
        if (openAIApiKey) {
          console.log('[DEBUG narrowWithIntelligentTags] Falling back to OpenAI due to parse error...');
          return narrowWithIntelligentTagsOpenAI(hubspotBrands, firefliesTranscripts, emails, userMessage);
        }
        
        throw parseError;
      }
      
      const rankedResults = rankedData.results || [];
      console.log('[DEBUG narrowWithIntelligentTags] Claude ranked', rankedResults.length, 'brands');
      
      // Validate that Claude didn't hallucinate brands
      const inputBrandIds = new Set(brandsForAI.map(b => b.id));
      const validResults = rankedResults.filter(r => inputBrandIds.has(r.id));
      
      if (validResults.length !== rankedResults.length) {
        console.warn('[DEBUG narrowWithIntelligentTags] Claude hallucinated', rankedResults.length - validResults.length, 'brands');
      }

      const taggedBrands = validResults.map(rankedBrand => {
        const originalBrand = hubspotBrands.find(b => b.id === rankedBrand.id);

        if (!originalBrand) {
          console.warn('[DEBUG narrowWithIntelligentTags] Could not find brand with ID:', rankedBrand.id);
          return null;
        }

        return {
          source: 'hubspot', 
          id: originalBrand.id, 
          name: originalBrand.properties.brand_name || '',
          category: originalBrand.properties.main_category || 'General',
          subcategories: originalBrand.properties.product_sub_category__multi_ || '',
          clientStatus: originalBrand.properties.client_status || '',
          clientType: originalBrand.properties.client_type || '',
          partnershipCount: originalBrand.properties.partnership_count || '0',
          dealsCount: originalBrand.properties.deals_count || '0',
          lastActivity: originalBrand.properties.hs_lastmodifieddate,
          hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI.portalId}/company/${originalBrand.id}`,
          relevanceScore: rankedBrand.relevanceScore, 
          tags: rankedBrand.tags, 
          reason: rankedBrand.reason,
        };
      }).filter(Boolean);

      const topBrands = taggedBrands.sort((a, b) => b.relevanceScore - a.relevanceScore);
      console.log('[DEBUG narrowWithIntelligentTags] Returning', topBrands.length, 'tagged brands');
      return { topBrands, taggedBrands };
      
    } catch (fetchError) {
      clearTimeout(timeout);
      
      if (fetchError.name === 'AbortError') {
        console.error('[DEBUG narrowWithIntelligentTags] Claude request timed out');
      } else {
        console.error('[DEBUG narrowWithIntelligentTags] Claude request failed:', fetchError.message);
      }
      
      // Fallback: return brands sorted by activity
      console.log('[DEBUG narrowWithIntelligentTags] Using fallback sorting by activity');
      const fallbackBrands = hubspotBrands
        .sort((a, b) => {
          const scoreA = parseInt(a.properties.partnership_count || 0) + parseInt(a.properties.deals_count || 0);
          const scoreB = parseInt(b.properties.partnership_count || 0) + parseInt(b.properties.deals_count || 0);
          return scoreB - scoreA;
        })
        .slice(0, 15)
        .map(brand => ({
          source: 'hubspot',
          id: brand.id,
          name: brand.properties.brand_name || '',
          category: brand.properties.main_category || 'General',
          subcategories: brand.properties.product_sub_category__multi_ || '',
          clientStatus: brand.properties.client_status || '',
          clientType: brand.properties.client_type || '',
          partnershipCount: brand.properties.partnership_count || '0',
          dealsCount: brand.properties.deals_count || '0',
          lastActivity: brand.properties.hs_lastmodifieddate,
          hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI.portalId}/company/${brand.id}`,
          relevanceScore: 50,
          tags: ['Fallback Ranking'],
          reason: 'Ranked by activity count'
        }));
      
      return { topBrands: fallbackBrands, taggedBrands: fallbackBrands };
    }
  } catch (error) {
    console.error("[DEBUG narrowWithIntelligentTags] Error:", error);
    console.error("[DEBUG narrowWithIntelligentTags] Stack trace:", error.stack);
    return { topBrands: hubspotBrands.slice(0, 15), taggedBrands: [] };
  }
}



function analyzeBrandInsights(brandDetails, meetings, emails) {
  const insights = {
    engagementLevel: 'Unknown',
    keyTopics: [],
    decisionMakers: [],
    painPoints: [],
    opportunities: [],
    lastTouchpoint: null,
    sentimentTrend: 'Neutral'
  };
  
  const recentMeetings = meetings.filter(m => {
    const meetingDate = new Date(m.date);
    const daysSince = (new Date() - meetingDate) / (1000 * 60 * 60 * 24);
    return daysSince < 90;
  }).length;
  
  const recentEmails = emails.filter(e => {
    const emailDate = new Date(e.date);
    const daysSince = (new Date() - emailDate) / (1000 * 60 * 60 * 24);
    return daysSince < 30;
  }).length;
  
  if (recentMeetings >= 3 || recentEmails >= 5) {
    insights.engagementLevel = 'High';
  } else if (recentMeetings >= 1 || recentEmails >= 2) {
    insights.engagementLevel = 'Medium';
  } else {
    insights.engagementLevel = 'Low';
  }
  
  const allTopics = [];
  meetings.forEach(m => {
    if (m.keywords) allTopics.push(...m.keywords);
    if (m.topics) {
      const topics = m.topics.toLowerCase();
      if (topics.includes('budget')) insights.keyTopics.push('Budget Discussions');
      if (topics.includes('integration')) insights.keyTopics.push('Integration Planning');
      if (topics.includes('timeline')) insights.keyTopics.push('Timeline Alignment');
      if (topics.includes('creative')) insights.keyTopics.push('Creative Direction');
    }
  });
  
  const emailSenders = {};
  emails.forEach(e => {
    if (e.from) {
      emailSenders[e.from] = (emailSenders[e.from] || 0) + 1;
    }
  });
  
  insights.decisionMakers = Object.entries(emailSenders)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, interactions: count }));
  
  meetings.forEach(m => {
    const summary = (m.summary || '').toLowerCase();
    
    if (summary.includes('challenge') || summary.includes('concern')) {
      insights.painPoints.push('Implementation challenges discussed');
    }
    if (summary.includes('budget') && summary.includes('constraint')) {
      insights.painPoints.push('Budget constraints mentioned');
    }
    
    if (summary.includes('interested') || summary.includes('excited')) {
      insights.opportunities.push('High interest expressed');
    }
    if (m.actionItems && m.actionItems.length > 0) {
      insights.opportunities.push(`${m.actionItems.length} action items pending`);
    }
  });
  
  const allTouchpoints = [
    ...meetings.map(m => ({ type: 'meeting', date: new Date(m.date), title: m.title })),
    ...emails.map(e => ({ type: 'email', date: new Date(e.date), title: e.subject }))
  ].sort((a, b) => b.date - a.date);
  
  if (allTouchpoints.length > 0) {
    insights.lastTouchpoint = allTouchpoints[0];
  }
  
  if (insights.opportunities.length > insights.painPoints.length) {
    insights.sentimentTrend = 'Positive';
  } else if (insights.painPoints.length > insights.opportunities.length) {
    insights.sentimentTrend = 'Cautious';
  }
  
  return insights;
}

function generateIntegrationIdeas(brand, insights, currentProduction) {
  const ideas = [];
  
  const category = (brand.category || '').toLowerCase();
  
  if (category.includes('auto') || category.includes('car')) {
    ideas.push({
      type: 'Hero Vehicle',
      description: 'Feature brand vehicle as character\'s primary transportation',
      rationale: 'Natural integration that adds production value'
    });
    ideas.push({
      type: 'Chase Sequence',
      description: 'Showcase vehicle performance in action sequence',
      rationale: 'Highlights product capabilities authentically'
    });
  }
  
  if (category.includes('tech') || category.includes('electronics')) {
    ideas.push({
      type: 'Character Tool',
      description: 'Integrate as essential character technology',
      rationale: 'Shows product in realistic use cases'
    });
    ideas.push({
      type: 'Plot Device',
      description: 'Technology drives key story moments',
      rationale: 'Deep integration increases brand recall'
    });
  }
  
  if (category.includes('fashion') || category.includes('apparel')) {
    ideas.push({
      type: 'Wardrobe Integration',
      description: 'Outfit key characters in brand apparel',
      rationale: 'Visual presence throughout production'
    });
    ideas.push({
      type: 'Style Transformation',
      description: 'Use fashion to show character development',
      rationale: 'Emotional connection with brand'
    });
  }
  
  if (category.includes('food') || category.includes('beverage')) {
    ideas.push({
      type: 'Social Moments',
      description: 'Feature in character bonding scenes',
      rationale: 'Associates brand with positive emotions'
    });
    ideas.push({
      type: 'Daily Ritual',
      description: 'Part of character\'s routine',
      rationale: 'Shows habitual product use'
    });
  }
  
  if (insights.engagementLevel === 'High') {
    ideas.push({
      type: 'Custom Integration',
      description: 'Co-develop unique brand moment for production',
      rationale: 'High engagement allows for creative collaboration'
    });
  }
  
  if (brand.budget && parseFloat(brand.budget) > 10) {
    ideas.push({
      type: 'Multi-Scene Presence',
      description: 'Strategic placement across multiple episodes/scenes',
      rationale: 'Budget supports extended integration'
    });
  }
  
  if (currentProduction) {
    ideas.push({
      type: 'Themed Integration',
      description: `Align brand with ${currentProduction} themes`,
      rationale: 'Leverages production\'s unique narrative'
    });
  }
  
  return ideas.slice(0, 5);
}

function checkVibeMatch(productionContext, brand) {
  const brandName = brand.name.toLowerCase();
  const category = brand.category.toLowerCase();
  
  if (productionContext.genre === 'action' || productionContext.genre === 'scifi') {
    if (brandName.includes('tesla') || brandName.includes('red bull') || 
        category.includes('tech') || category.includes('gaming')) {
      return true;
    }
  }
  
  if (productionContext.genre === 'drama' || productionContext.genre === 'romance') {
    if (category.includes('beauty') || category.includes('fashion') || 
        category.includes('luxury') || category.includes('home')) {
      return true;
    }
  }
  
  return false;
}

function isEmergingCategory(category) {
  const emergingCategories = [
    'crypto', 'blockchain', 'nft', 'metaverse', 'ai', 'artificial intelligence',
    'sustainability', 'sustainable', 'eco', 'green tech',
    'plant-based', 'vegan', 'alternative protein',
    'wellness', 'mental health', 'meditation', 'mindfulness',
    'telehealth', 'digital health', 'healthtech',
    'fintech', 'digital banking', 'payment',
    'edtech', 'online learning', 'education technology',
    'creator economy', 'influencer', 'content creation',
    'subscription', 'saas', 'd2c', 'dtc', 'direct to consumer',
    'ev', 'electric vehicle', 'renewable energy',
    'gaming', 'esports', 'streaming'
  ];
  
  const categoryLower = category.toLowerCase();
  return emergingCategories.some(ec => categoryLower.includes(ec));
}

function extractGenreFromSynopsis(synopsis) {
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
}

// Add this new helper function to extract last production context
function extractLastProduction(conversation) {
  if (!conversation) return null;
  
  // Look for patterns that indicate a production/synopsis
  const patterns = [
    /Synopsis:([\s\S]+?)(?=\nUser:|\nAI:|$)/gi,
    /Production:([\s\S]+?)(?=\nUser:|\nAI:|$)/gi,
    /(?:movie|film|show|series|production)[\s\S]{0,500}?(?:starring|featuring|about|follows)[\s\S]+?(?=\nUser:|\nAI:|$)/gi
  ];
  
  let lastProduction = null;
  
  for (const pattern of patterns) {
    const matches = conversation.match(pattern);
    if (matches && matches.length > 0) {
      // Get the last match
      lastProduction = matches[matches.length - 1];
      break;
    }
  }
  
  // Clean up the extracted text
  if (lastProduction) {
    lastProduction = lastProduction
      .replace(/^(Synopsis:|Production:)\s*/i, '')
      .trim();
  }
  
  return lastProduction;
}

function checkGenreMatch(productionGenre, brandCategory) {
  const genreMap = {
    sports: ['athletic', 'fitness', 'sports', 'energy', 'nutrition', 'wellness', 'performance'],
    comedy: ['snack', 'beverage', 'casual', 'youth', 'entertainment', 'social', 'fun'],
    action: ['automotive', 'technology', 'gaming', 'energy', 'extreme', 'adventure', 'performance'],
    drama: ['fashion', 'beauty', 'lifestyle', 'home', 'family', 'luxury', 'wellness'],
    documentary: ['education', 'health', 'environment', 'social', 'tech', 'nonprofit', 'sustainability'],
    thriller: ['tech', 'security', 'automotive', 'insurance', 'home security', 'financial'],
    romance: ['jewelry', 'fashion', 'beauty', 'travel', 'hospitality', 'dining', 'luxury'],
    scifi: ['technology', 'gaming', 'electronics', 'automotive', 'innovation', 'future', 'ai'],
    crime: ['security', 'insurance', 'automotive', 'tech', 'financial', 'legal']
  };
  
  const relevantCategories = genreMap[productionGenre] || [];
  const categoryLower = brandCategory.toLowerCase();
  
  // Direct match
  if (relevantCategories.some(cat => categoryLower.includes(cat))) {
    return true;
  }
  
  // Smart matches for broader categories
  if (productionGenre && categoryLower) {
    // Tech/Innovation brands work well with action, scifi, thriller
    if (['action', 'scifi', 'thriller'].includes(productionGenre) && 
        (categoryLower.includes('tech') || categoryLower.includes('innovation') || categoryLower.includes('ai'))) {
      return true;
    }
    
    // Lifestyle brands work across multiple genres
    if (['drama', 'romance', 'comedy'].includes(productionGenre) && 
        (categoryLower.includes('lifestyle') || categoryLower.includes('consumer'))) {
      return true;
    }
  }
  
  return false;
}
async function routeUserIntent(userMessage, conversationContext, lastProductionContext) {
  if (!openAIApiKey) return { tool: 'answer_general_question' };

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
      { 
        role: 'system', 
        content: systemPrompt
      },
      { 
        role: 'user', 
        content: `Last Production Context:\n"""\n${lastProductionContext || 'None available'}\n"""\n\nUser's Request:\n"""\n${userMessage}\n"""\n\nBased on your UNDERSTANDING of what the user wants, route to the appropriate tool. If they reference "this project" and there's a Last Production Context, use it to complete their request.`
      }
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({ 
        model: 'gpt-4o-mini',
        messages, 
        tools, 
        tool_choice: 'auto',
        temperature: 0.3 // Lower temperature for more consistent routing
      })
    });

    if (!response.ok) throw new Error('AI router failed');
    const data = await response.json();
    const toolCall = data.choices[0].message.tool_calls?.[0];

    if (toolCall) {
      const args = JSON.parse(toolCall.function.arguments);
      
      // Special handling for vague brand searches
      if (toolCall.function.name === 'find_brands') {
        // If the search term is too vague but we have context, use the context
        if (args.search_term && args.search_term.length < 50 && lastProductionContext) {
          // Check if it's a vague reference like "this project" or "more brands"
          const vagueTerms = ['this project', 'this production', 'more brands', 'additional brands', 'other brands'];
          const isVague = vagueTerms.some(term => args.search_term.toLowerCase().includes(term));
          
          if (isVague) {
            args.search_term = lastProductionContext; // Use the full context
          }
        } else if (!args.search_term && lastProductionContext) {
          args.search_term = lastProductionContext;
        } else if (!args.search_term) {
          args.search_term = userMessage; // Fallback to original message
        }
      }
      
      // Rename search_query back to brand_name for backward compatibility
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

// Helper function to generate wildcard/creative brand suggestions
async function generateWildcardBrands(synopsis) {
  if (!openAIApiKey) return [];
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { 
            role: 'system', 
            content: 'Suggest exactly 5 UNEXPECTED consumer brand names (NOT studios/distributors/production companies) for product placement in this production. Think outside the box - find hidden gem brands that would create surprising but perfect synergy. Focus on real consumer brands that make products/services that could appear on screen and pay for placement. Be creative and unpredictable. Return JSON: {"brands": ["Brand Name 1", "Brand Name 2", ...]}' 
          },
          { role: 'user', content: `Find unexpected product placement gems for: ${synopsis.slice(0, 500)}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.9, // Increased for more variance
        max_tokens: 100
      })
    });
    
    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);
    return result.brands || [];
  } catch (error) {
    console.error('Error generating wildcard brands:', error);
    return [];
  }
}

// Helper function to tag and combine brands from different sources
function tagAndCombineBrands({ activityBrands, genreBrands, activeBrands, wildcardCategories, synopsis, context }) {
  const brandMap = new Map();
  
  // Helper to find relevant meeting/email quote for a brand
  const findBrandContext = (brandName) => {
    if (!context) return null;
    
    // Check meetings for brand mentions
    if (context.meetings && context.meetings.length > 0) {
      for (const meeting of context.meetings) {
        if (meeting.title?.toLowerCase().includes(brandName.toLowerCase()) || 
            meeting.summary?.overview?.toLowerCase().includes(brandName.toLowerCase())) {
          
          // Return structured insight with segments
          const segments = [];
          
          // Add text segment
          if (meeting.summary?.action_items && meeting.summary.action_items.length > 0) {
            segments.push({
              type: "text",
              content: "Active discussions noted with action items from "
            });
          } else if (meeting.summary?.overview) {
            segments.push({
              type: "text",
              content: "Recent meeting activity discussed in "
            });
          } else {
            segments.push({
              type: "text",
              content: "Mentioned in "
            });
          }
          
          // Add link segment
          segments.push({
            type: "link",
            content: `"${meeting.title}" on ${meeting.dateString}`,
            url: meeting.transcript_url || '#'
          });
          
          // Add any trailing context
          if (meeting.summary?.action_items && meeting.summary.action_items.length > 0) {
            segments.push({
              type: "text",
              content: ` - "${meeting.summary.action_items[0]}"`
            });
          }
          
          return {
            segments: segments,
            rawText: segments.map(s => s.content).join('') // For backward compatibility
          };
        }
      }
    }
    
    // Check emails for brand mentions
    if (context.emails && context.emails.length > 0) {
      for (const email of context.emails) {
        if (email.subject?.toLowerCase().includes(brandName.toLowerCase()) || 
            email.preview?.toLowerCase().includes(brandName.toLowerCase())) {
          const date = new Date(email.receivedDate).toLocaleDateString();
          
          // Return structured insight with segments
          const segments = [
            {
              type: "text",
              content: `Recent email from ${email.fromName || email.from}: "${email.subject}" (${date})`
            }
          ];
          
          return {
            segments: segments,
            rawText: segments[0].content // For backward compatibility
          };
        }
      }
    }
    
    return null;
  };
  
  // Helper to generate specific pitch based on brand and synopsis
  const generatePitch = (brand, synopsisText) => {
    const category = (brand.category || '').toLowerCase();
    const genre = extractGenreFromSynopsis(synopsisText);
    
    // Generate specific pitches based on category and genre
    if (category.includes('automotive') && genre === 'action') {
      return 'Hero car for chase sequences - proven track record with action films';
    }
    if (category.includes('fashion') && (genre === 'drama' || genre === 'romance')) {
      return 'Wardrobe partner for character development - luxury meets storytelling';
    }
    if (category.includes('tech') && genre === 'scifi') {
      return 'Future-tech integration - product as narrative device';
    }
    if (category.includes('beverage') && genre === 'comedy') {
      return 'Social scenes product placement - natural comedy moments';
    }
    if (parseInt(brand.partnershipCount) > 10) {
      return `${brand.partnershipCount} successful integrations - knows entertainment value`;
    }
    if (brand.clientType === 'Retainer') {
      return 'Retainer client with flexible integration budget';
    }
    if (parseInt(brand.dealsCount) > 5) {
      return `Active in ${brand.dealsCount} current productions - high engagement`;
    }
    
    // Default specific pitches
    return `${brand.category} leader - natural fit for ${genre || 'this'} production`;
  };
  
  // Process brands with recent activity (8)
  if (activityBrands && activityBrands.results) {
    activityBrands.results.forEach(brand => {
      const id = brand.id;
      const brandName = brand.properties.brand_name || '';
      const contextData = findBrandContext(brandName);
      
      if (!brandMap.has(id)) {
        brandMap.set(id, {
          source: 'hubspot',
          id: brand.id,
          name: brandName,
          category: brand.properties.main_category || 'General',
          subcategories: brand.properties.product_sub_category__multi_ || '',
          clientStatus: brand.properties.client_status || '',
          clientType: brand.properties.client_type || '',
          partnershipCount: brand.properties.partnership_count || '0',
          dealsCount: brand.properties.deals_count || '0',
          lastActivity: brand.properties.hs_lastmodifieddate,
          hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI.portalId}/company/${brand.id}`,
          tags: ['📧 Recent Activity'],
          relevanceScore: 95,
          reason: contextData?.rawText || `Recent engagement - last activity ${new Date(brand.properties.hs_lastmodifieddate).toLocaleDateString()}`,
          insight: contextData // Include structured insight data
        });
      }
      // Add additional tags based on status
      const brandData = brandMap.get(id);
      if (brand.properties.client_status === 'Active' || brand.properties.client_status === 'Contract') {
        brandData.tags.push('🔥 Active Client');
      }
      if (brand.properties.client_type === 'Retainer') {
        brandData.tags.push('Retainer Client (Premium)');
      }
      if (parseInt(brand.properties.partnership_count || 0) >= 10) {
        brandData.tags.push(`Proven Partner (${brand.properties.partnership_count} partnerships)`);
      }
      if (parseInt(brand.properties.deals_count || 0) >= 5) {
        brandData.tags.push(`High Activity (${brand.properties.deals_count} deals)`);
      }
    });
  }
  
  // Process genre/demographic brands (15)
  genreBrands.results?.forEach(brand => {
    const id = brand.id;
    const brandName = brand.properties.brand_name || '';
    const contextData = findBrandContext(brandName);
    
    if (!brandMap.has(id)) {
      brandMap.set(id, {
        source: 'hubspot',
        id: brand.id,
        name: brandName,
        category: brand.properties.main_category || 'General',
        subcategories: brand.properties.product_sub_category__multi_ || '',
        clientStatus: brand.properties.client_status || '',
        clientType: brand.properties.client_type || '',
        partnershipCount: brand.properties.partnership_count || '0',
        dealsCount: brand.properties.deals_count || '0',
        lastActivity: brand.properties.hs_lastmodifieddate,
        hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI.portalId}/company/${brand.id}`,
        tags: ['🎭 Vibe Match'],
        relevanceScore: 85,
        reason: contextData?.rawText || generatePitch(brand.properties, synopsis),
        insight: contextData // Include structured insight data
      });
    } else {
      brandMap.get(id).tags.push('🎭 Vibe Match');
      brandMap.get(id).relevanceScore = Math.min(98, brandMap.get(id).relevanceScore + 5);
      // Update insight if we found context
      if (contextData && !brandMap.get(id).insight) {
        brandMap.get(id).insight = contextData;
      }
    }
    // Add additional tags based on status
    const brandData = brandMap.get(id);
    if (brand.properties.client_status === 'Active' || brand.properties.client_status === 'Contract') {
      if (!brandData.tags.includes('🔥 Active Client')) brandData.tags.push('🔥 Active Client');
    }
    if (brand.properties.client_status === 'In Negotiation' || brand.properties.client_status === 'Pending') {
      brandData.tags.push('✨ New Opportunity');
    }
    if (brand.properties.client_type === 'Retainer' && !brandData.tags.includes('Retainer Client (Premium)')) {
      brandData.tags.push('Retainer Client (Premium)');
    }
    if (parseInt(brand.properties.partnership_count || 0) >= 10 && !brandData.tags.some(t => t.includes('Proven Partner'))) {
      brandData.tags.push(`Proven Partner (${brand.properties.partnership_count} partnerships)`);
    }
  });
  
  // Process active big-budget clients (10)
  activeBrands.results?.forEach(brand => {
    const id = brand.id;
    const brandName = brand.properties.brand_name || '';
    const contextData = findBrandContext(brandName);
    
    if (!brandMap.has(id)) {
      brandMap.set(id, {
        source: 'hubspot',
        id: brand.id,
        name: brandName,
        category: brand.properties.main_category || 'General',
        subcategories: brand.properties.product_sub_category__multi_ || '',
        clientStatus: brand.properties.client_status || '',
        clientType: brand.properties.client_type || '',
        partnershipCount: brand.properties.partnership_count || '0',
        dealsCount: brand.properties.deals_count || '0',
        lastActivity: brand.properties.hs_lastmodifieddate,
        hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI.portalId}/company/${brand.id}`,
        tags: ['💰 Active Big-Budget Client', '🔥 Active Client'],
        relevanceScore: 90,
        reason: contextData?.rawText || `Budget proven: ${brand.properties.deals_count} deals, ${brand.properties.partnership_count} partnerships`,
        insight: contextData // Include structured insight data
      });
    } else {
      if (!brandMap.get(id).tags.includes('💰 Big Budget')) {
        brandMap.get(id).tags.push('💰 Big Budget');
      }
      if (!brandMap.get(id).tags.includes('🔥 Active Client')) {
        brandMap.get(id).tags.push('🔥 Active Client');
      }
      brandMap.get(id).relevanceScore = Math.min(98, brandMap.get(id).relevanceScore + 8);
      // Update insight if we found context
      if (contextData && !brandMap.get(id).insight) {
        brandMap.get(id).insight = contextData;
      }
    }
    // Add additional tags based on activity levels
    const brandData = brandMap.get(id);
    if (brand.properties.client_type === 'Retainer' && !brandData.tags.includes('Retainer Client (Premium)')) {
      brandData.tags.push('Retainer Client (Premium)');
    }
    if (parseInt(brand.properties.partnership_count || 0) >= 10 && !brandData.tags.some(t => t.includes('Proven Partner'))) {
      brandData.tags.push(`Proven Partner (${brand.properties.partnership_count} partnerships)`);
    }
    if (parseInt(brand.properties.deals_count || 0) >= 5 && !brandData.tags.some(t => t.includes('High Activity'))) {
      brandData.tags.push(`High Activity (${brand.properties.deals_count} deals)`);
    }
  });
  
  // Add wildcard category suggestions for cold outreach (5)
  if (wildcardCategories && wildcardCategories.length > 0) {
    const genre = extractGenreFromSynopsis(synopsis);
    wildcardCategories.slice(0, 5).forEach((brandName, index) => {
      // Generate specific cold outreach pitch
      let pitch = `Perfect ${genre || 'creative'} synergy - worth cold outreach`;
      if (brandName.toLowerCase().includes('luxury')) {
        pitch = 'Elevates production value - luxury brand cachet';
      } else if (brandName.toLowerCase().includes('tech')) {
        pitch = 'Innovation angle - tech-forward narrative integration';
      } else if (brandName.toLowerCase().includes('sustainable')) {
        pitch = 'ESG story angle - sustainability messaging opportunity';
      }
      
      brandMap.set(`wildcard_${index}`, {
        source: 'suggestion',
        id: `wildcard_${index}`,
        name: brandName, // Just the brand name, no brackets
        category: 'Suggested for Cold Outreach',
        tags: ['🚀 Cold Outreach Opportunity', '💡 Creative Suggestion', '🎭 Vibe Match'],
        relevanceScore: 70,
        reason: pitch,
        isWildcard: true
      });
    });
  }
  
  // Convert to array and sort by relevance
  return Array.from(brandMap.values())
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 45); // Limit to top 45 (15+15+10+5)
}

async function handleClaudeSearch(userMessage, projectId, conversationContext, lastProductionContext, knownProjectName) {
  if (!anthropicApiKey) return null;
  
  const intent = await routeUserIntent(userMessage, conversationContext, lastProductionContext);
  if (!intent || intent.tool === 'answer_general_question') return null;

  const mcpThinking = [];

  try {
    switch (intent.tool) {
      case 'find_brands': {
        const { search_term } = intent.args;
        
        // Simple keyword search (under 50 chars)
        if (search_term.length < 50) {
          mcpThinking.push({ type: 'start', text: `🔍 Searching for brands matching "${search_term}"...` });
          const brandsData = await hubspotAPI.searchBrands({ query: search_term, limit: 15 });
          mcpThinking.push({ type: 'complete', text: `✅ Found ${brandsData.results.length} brands.` });
          
          return {
            organizedData: {
              dataType: 'BRAND_SEARCH_RESULTS',
              searchQuery: search_term,
              brandSuggestions: brandsData.results.map(b => ({
                id: b.id,
                name: b.properties.brand_name || '',
                category: b.properties.main_category || 'General',
                subcategories: b.properties.product_sub_category__multi_ || '',
                clientStatus: b.properties.client_status || '',
                partnershipCount: b.properties.partnership_count || '0',
                hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI.portalId}/company/${b.id}`
              }))
            },
            mcpThinking,
            usedMCP: true
          };
        }

        // Full "Four Lists" Synopsis Search
        mcpThinking.push({ type: 'start', text: '🎬 Synopsis detected. Building diverse recommendations...' });
        
        // Extract title if not provided by frontend
        let extractedTitle;
        if (knownProjectName) {
            // If the frontend provided a title, trust it completely
            extractedTitle = knownProjectName;
            mcpThinking.push({ type: 'process', text: `📌 Using known project: "${extractedTitle}"` });
        } else {
            // Only run extraction logic if no title was sent from frontend
            extractedTitle = null; // You can add extraction logic here if needed
        }
        
        // Extract genre and keywords for better matching
        const genre = extractGenreFromSynopsis(search_term);
        const synopsisKeywords = await extractKeywordsForHubSpot(search_term);
        mcpThinking.push({ type: 'process', text: `📊 Detected genre: ${genre || 'general'}` });
        if (synopsisKeywords) {
          mcpThinking.push({ type: 'process', text: `🔑 Keywords extracted: ${synopsisKeywords}` });
        }
        
        // Launch parallel searches for the four lists
        mcpThinking.push({ type: 'search', text: '🎯 List 1: Synopsis-matched brands (15)...' });
        mcpThinking.push({ type: 'search', text: '🎭 List 2: Vibe matches (15)...' });
        mcpThinking.push({ type: 'search', text: '💰 List 3: Active big-budget clients (10)...' });
        mcpThinking.push({ type: 'search', text: '🚀 List 4: Creative exploration (5 cold outreach)...' });
        
        const [synopsisBrands, genreBrands, activeBrands, wildcardBrands] = await Promise.all([
          // List 1: Synopsis-matched brands using extracted keywords (15)
          withTimeout(
            hubspotAPI.searchBrands({
              query: synopsisKeywords || search_term.slice(0, 100),
              limit: 15
            }),
            7000,
            { results: [] }
          ),
          
          // List 2: Random demographic/genre matches (15)
          withTimeout(
            hubspotAPI.searchBrands({
              limit: 15,
              filterGroups: genre ? [{
                filters: [
                  { propertyName: 'client_status', operator: 'IN', values: ['Active', 'In Negotiation', 'Contract', 'Pending'] }
                ]
              }] : undefined,
              sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }]
            }),
            5000,
            { results: [] }
          ),
          
          // List 3: Active clients with big budgets (10)
          withTimeout(
            hubspotAPI.searchBrands({
              limit: 10,
              filterGroups: [{
                filters: [
                  { propertyName: 'client_status', operator: 'IN', values: ['Active', 'Contract'] },
                  { propertyName: 'deals_count', operator: 'GTE', value: '3' }
                ]
              }],
              sorts: [{ propertyName: 'partnership_count', direction: 'DESCENDING' }]
            }),
            5000,
            { results: [] }
          ),
          
          // List 4: Creative wildcard suggestions for cold outreach (5)
          withTimeout(
            generateWildcardBrands(search_term),
            8000,
            []
          )
        ]);

        // Report results
        mcpThinking.push({ type: 'result', text: `✅ Synopsis matches: ${synopsisBrands.results?.length || 0} brands` });
        mcpThinking.push({ type: 'result', text: `✅ Vibe matches: ${genreBrands.results?.length || 0} brands` });
        mcpThinking.push({ type: 'result', text: `✅ Active big-budget: ${activeBrands.results?.length || 0} brands` });
        mcpThinking.push({ type: 'result', text: `✅ Cold outreach ideas: ${wildcardBrands?.length || 0} suggestions` });
        
        // Combine and tag all results
        mcpThinking.push({ type: 'process', text: '🤝 Combining and ranking recommendations...' });
        const taggedBrands = tagAndCombineBrands({
          synopsisBrands,
          genreBrands,
          activeBrands,
          wildcardCategories: wildcardBrands
        });

        // Optional: Get supporting context from meetings/emails
        let supportingContext = { meetings: [], emails: [] };
        if (firefliesApiKey || msftClientId) {
          mcpThinking.push({ type: 'search', text: '📧 Checking for related communications...' });
          const contextKeywords = await extractKeywordsForContextSearch(search_term);
          
          const [firefliesData, emailData] = await Promise.all([
            firefliesApiKey ? withTimeout(searchFireflies(contextKeywords, { limit: 3 }), 5000, { transcripts: [] }) : { transcripts: [] },
            msftClientId ? withTimeout(o365API.searchEmails(contextKeywords, { days: 90, limit: 5 }), 5000, []) : []
          ]);
          
          supportingContext = {
            meetings: firefliesData.transcripts || [],
            emails: emailData || []
          };
          
          if (supportingContext.meetings.length > 0 || supportingContext.emails.length > 0) {
            mcpThinking.push({ type: 'result', text: `📧 Found ${supportingContext.meetings.length} meetings, ${supportingContext.emails.length} emails` });
          }
        }

        mcpThinking.push({ type: 'complete', text: `✨ Prepared ${taggedBrands.length} diverse recommendations` });
        
        return {
          organizedData: {
            dataType: 'BRAND_RECOMMENDATIONS',
            productionContext: search_term,
            projectName: extractedTitle, // Use the definitive title
            brandSuggestions: taggedBrands,
            supportingContext: supportingContext
          },
          mcpThinking,
          usedMCP: true
        };
      }

      case 'get_brand_activity': {
        const { brand_name } = intent.args;
        mcpThinking.push({ type: 'start', text: `🎬 Activity retrieval detected for "${brand_name}"...` });
        
        console.log('[DEBUG get_brand_activity] Starting search for:', brand_name);
        
        // Search for the brand and its activity
        mcpThinking.push({ type: 'search', text: '🔍 Searching HubSpot for brand details...' });
        mcpThinking.push({ type: 'search', text: '🎙️ Searching Fireflies for meetings...' });
        mcpThinking.push({ type: 'search', text: '✉️ Searching O365 for emails...' });
        
        // Run all searches in parallel for better performance
        const [brand, firefliesData, o365Data] = await Promise.all([
          hubspotAPI.searchSpecificBrand(brand_name),
          firefliesApiKey ? searchFireflies(brand_name, { limit: 20 }) : { transcripts: [] },
          msftClientId ? o365API.searchEmails(brand_name, { days: 180, limit: 20 }) : []
        ]);
        
        console.log('[DEBUG get_brand_activity] Brand found:', !!brand);
        console.log('[DEBUG get_brand_activity] Meetings found:', firefliesData.transcripts?.length || 0);
        console.log('[DEBUG get_brand_activity] Emails found:', o365Data?.length || 0);
        
        if (!brand) {
          mcpThinking.push({ type: 'error', text: `❌ Brand "${brand_name}" not found in HubSpot.` });
          // Still return meetings and emails even if brand not in HubSpot
        } else {
          mcpThinking.push({ type: 'result', text: `✅ Found brand in HubSpot.` });
        }
        
        mcpThinking.push({ type: 'result', text: `✅ Found ${firefliesData.transcripts?.length || 0} meeting(s).` });
        mcpThinking.push({ type: 'result', text: `✅ Found ${o365Data?.length || 0} email(s).` });
        
        // Get contacts if brand exists
        let contacts = [];
        if (brand) {
          mcpThinking.push({ type: 'search', text: '👥 Retrieving brand contacts...' });
          contacts = await hubspotAPI.getContactsForBrand(brand.id);
          mcpThinking.push({ type: 'result', text: `✅ Found ${contacts.length} contact(s).` });
        }
        
        // Combine and sort all communications chronologically
        const allCommunications = [];
        
        // Add meetings with type marker
        if (firefliesData.transcripts && firefliesData.transcripts.length > 0) {
          firefliesData.transcripts.forEach(meeting => {
            allCommunications.push({
              type: 'meeting',
              title: meeting.title || 'Untitled Meeting',
              date: new Date(meeting.date || meeting.dateString),
              dateString: meeting.dateString,
              duration: meeting.duration,
              participants: meeting.participants,
              summary: meeting.summary,
              url: meeting.transcript_url
            });
          });
        }
        
        // Add emails with type marker
        if (o365Data && o365Data.length > 0) {
          o365Data.forEach(email => {
            allCommunications.push({
              type: 'email',
              title: email.subject || 'No Subject',
              date: new Date(email.receivedDate),
              dateString: new Date(email.receivedDate).toLocaleDateString(),
              from: email.from,
              fromName: email.fromName,
              preview: email.preview
            });
          });
        }
        
        // Sort by date (most recent first)
        allCommunications.sort((a, b) => b.date - a.date);
        
        console.log('[DEBUG get_brand_activity] Total communications:', allCommunications.length);
        console.log('[DEBUG get_brand_activity] Communications breakdown:');
        allCommunications.forEach((comm, index) => {
          console.log(`  ${index + 1}. [${comm.type}] ${comm.title} - ${comm.dateString}`);
        });
        
        // Verify data integrity
        const meetingCount = allCommunications.filter(c => c.type === 'meeting').length;
        const emailCount = allCommunications.filter(c => c.type === 'email').length;
        console.log('[DEBUG get_brand_activity] Verification - Meetings in communications:', meetingCount);
        console.log('[DEBUG get_brand_activity] Verification - Emails in communications:', emailCount);
        
        mcpThinking.push({ type: 'complete', text: `✨ Activity report generated with ${allCommunications.length} items.` });
        
        return {
          organizedData: {
            dataType: 'BRAND_ACTIVITY', 
            searchQuery: brand_name,
            brand: brand ? brand.properties : null,
            contacts: contacts.map(c => c.properties),
            communications: allCommunications, // Sorted chronologically
            meetings: firefliesData.transcripts || [], // Keep original for backward compatibility
            emails: o365Data || [] // Keep original for backward compatibility
          }, 
          mcpThinking, 
          usedMCP: true
        };
      }

      case 'create_pitches_for_brands': {
        const { brand_names } = intent.args;
        
        // Use the last known project context or create a generic one
        const contextDescription = lastProductionContext ? 'the last discussed project' : 'general integration ideas';
        
        mcpThinking.push({ 
          type: 'start', 
          text: `🔬 Performing deep dive on ${brand_names.length} brand(s) for ${contextDescription}...` 
        });
        
        // Search for each brand's detailed information
        mcpThinking.push({ type: 'search', text: '🔍 Gathering brand details from HubSpot...' });
        
        // First, get all brand details from HubSpot quickly
        const brandDetailsPromises = brand_names.map(name => 
          hubspotAPI.searchSpecificBrand(name)
        );
        
        const brandDetails = await Promise.all(brandDetailsPromises);
        
        // Only search for meetings/emails if we have valid brands and it's 3 or fewer brands
        let meetingsData = [];
        let emailsData = [];
        
        if (brand_names.length <= 3) {
          // For small number of brands, do targeted searches
          mcpThinking.push({ type: 'search', text: '🎙️ Searching for relevant meetings...' });
          mcpThinking.push({ type: 'search', text: '✉️ Searching for relevant emails...' });
          
          // Create a combined search query for all brands
          const combinedSearchQuery = brand_names.join(' OR ');
          
          // Do ONE search for all brands together instead of separate searches
          const [firefliesData, o365Data] = await Promise.all([
            firefliesApiKey ? searchFireflies(combinedSearchQuery, { limit: 5 }) : { transcripts: [] },
            msftClientId ? o365API.searchEmails(combinedSearchQuery, { days: 90, limit: 5 }) : []
          ]);
          
          meetingsData = firefliesData.transcripts || [];
          emailsData = o365Data || [];
          
          mcpThinking.push({ 
            type: 'result', 
            text: `✅ Found ${meetingsData.length} relevant meetings and ${emailsData.length} emails total.` 
          });
        } else {
          // For many brands, skip the slow searches
          mcpThinking.push({ 
            type: 'info', 
            text: `⚡ Skipping detailed communication search for ${brand_names.length} brands (too many for deep dive).` 
          });
        }
        
        // Organize the results
        const organizedBrands = brandDetails.map((brand, index) => {
          if (!brand) {
            mcpThinking.push({ 
              type: 'warning', 
              text: `⚠️ Brand "${brand_names[index]}" not found in HubSpot.` 
            });
            
            // Return a minimal object for brands not in HubSpot
            return {
              name: brand_names[index],
              details: {
                brand_name: brand_names[index],
                client_status: 'Not in Database'
              },
              meetings: [],
              emails: []
            };
          }
          
          // Filter meetings/emails relevant to this specific brand
          const brandMeetings = meetingsData.filter(m => 
            m.title?.toLowerCase().includes(brand_names[index].toLowerCase()) ||
            m.summary?.overview?.toLowerCase().includes(brand_names[index].toLowerCase())
          );
          
          const brandEmails = emailsData.filter(e => 
            e.subject?.toLowerCase().includes(brand_names[index].toLowerCase()) ||
            e.preview?.toLowerCase().includes(brand_names[index].toLowerCase())
          );
          
          return {
            name: brand_names[index],
            details: brand.properties,
            meetings: brandMeetings.slice(0, 2), // Limit to 2 most relevant
            emails: brandEmails.slice(0, 2) // Limit to 2 most relevant
          };
        });

        mcpThinking.push({ 
          type: 'complete', 
          text: `✨ Deep dive completed for ${organizedBrands.length} brand(s).` 
        });

        return {
          organizedData: {
            dataType: 'DEEP_DIVE_ANALYSIS',
            productionContext: lastProductionContext || 'General brand integration analysis',
            brands: organizedBrands,
            requestedBrands: brand_names,
            searchOptimized: brand_names.length > 3 // Flag to indicate if we used optimized search
          },
          mcpThinking,
          usedMCP: true
        };
      }

      default:
        return null;
    }
  } catch (error) {
    console.error(`Error executing tool "${intent.tool}":`, error);
    mcpThinking.push({ type: 'error', text: `❌ Error: ${error.message}` });
    return null;
  }
}

async function generateRunwayVideo({ 
  promptText, 
  promptImage, 
  model = 'gen3_alpha_turbo',
  ratio = '1104:832',
  duration = 5
}) {
  if (!runwayApiKey) {
    throw new Error('RUNWAY_API_KEY not configured');
  }

  try {
    const client = new RunwayML({
      apiKey: runwayApiKey
    });

    let imageToUse = promptImage;
    
    if (!imageToUse || imageToUse.includes('dummyimage.com')) {
      imageToUse = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1280&h=720&fit=crop&q=80';
    }

    const videoTask = await client.imageToVideo.create({
      model: model,
      promptImage: imageToUse,
      promptText: promptText,
      ratio: ratio,
      duration: duration
    });

    let task = videoTask;
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      task = await client.tasks.retrieve(task.id);

      if (task.status === 'SUCCEEDED') {
        const videoUrl = task.output?.[0];
        if (!videoUrl) {
          throw new Error('No video URL in output');
        }

        return {
          url: videoUrl,
          taskId: task.id
        };
      }

      if (task.status === 'FAILED') {
        throw new Error(`Generation failed: ${task.failure || task.error || 'Unknown error'}`);
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
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

async function generateVeo3Video({
  promptText,
  aspectRatio = '16:9',
  duration = 5
}) {
  if (!googleGeminiApiKey) {
    throw new Error('GOOGLE_GEMINI_API_KEY not configured');
  }

  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-preview:generateVideo?key=${googleGeminiApiKey}`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: promptText,
        config: {
          personGeneration: "allow_all",
          aspectRatio: aspectRatio,
          duration: `${duration}s`
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      if (response.status === 401) {
        throw new Error('Invalid API key. Check GOOGLE_GEMINI_API_KEY in environment variables.');
      }
      if (response.status === 404) {
        throw new Error('Veo3 API endpoint not found. The API may not be available in your region or your API key may not have access.');
      }
      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Try again later.');
      }
      
      throw new Error(`Veo3 API error: ${response.status} - ${errorText}`);
    }

    const operation = await response.json();

    if (operation.name) {
      let attempts = 0;
      const maxAttempts = 60;
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${operation.name}?key=${googleGeminiApiKey}`;
        const statusResponse = await fetch(statusUrl);
        
        if (!statusResponse.ok) {
          throw new Error('Failed to check video generation status');
        }
        
        const statusData = await statusResponse.json();
        
        if (statusData.done) {
          if (statusData.error) {
            throw new Error(`Video generation failed: ${statusData.error.message}`);
          }
          
          const videoUrl = statusData.response?.video?.uri || statusData.response?.videoUrl;
          if (!videoUrl) {
            throw new Error('No video URL in response');
          }
          
          return {
            url: videoUrl,
            taskId: operation.name,
            metadata: statusData.response
          };
        }
        
        attempts++;
      }
      
      throw new Error('Video generation timed out');
    } else {
      const videoUrl = operation.video?.uri || operation.videoUrl;
      if (!videoUrl) {
        throw new Error('No video URL in response');
      }
      
      return {
        url: videoUrl,
        taskId: 'direct-response',
        metadata: operation
      };
    }

  } catch (error) {
    throw new Error(`Veo3 is currently in preview and may not be available. ${error.message}`);
  }
}


export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  const wantsStream = req.headers.accept === 'text/event-stream' || (req.body && req.body.stream === true);
  
  if (req.method === 'POST') {
    try {
      if (req.body.generateAudio === true) {
        const { prompt, projectId, sessionId } = req.body;
        if (!prompt) {
          return res.status(400).json({ 
            error: 'Missing required fields',
            details: 'prompt is required'
          });
        }
        if (!elevenLabsApiKey) {
          return res.status(500).json({ 
            error: 'Audio generation service not configured',
            details: 'Please configure ELEVENLABS_API_KEY'
          });
        }
        const projectConfig = getProjectConfig(projectId);
        const { voiceId, voiceSettings } = projectConfig;
        try {
            const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
            
            const elevenLabsResponse = await fetch(elevenLabsUrl, {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg',
                    'Content-Type': 'application/json',
                    'xi-api-key': elevenLabsApiKey
                },
                body: JSON.stringify({
                    text: prompt,
                    model_id: 'eleven_monolingual_v1',
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
            const base64Audio = audioBuffer.toString('base64');
            const audioDataUrl = `data:audio/mpeg;base64,${base64Audio}`;
            return res.status(200).json({
                success: true,
                audioUrl: audioDataUrl,
                voiceUsed: voiceId
            });
            
        } catch (error) {
            return res.status(500).json({ 
                error: 'Failed to generate audio',
                details: error.message 
            });
        }
      }

      if (req.body.generateVideo === true) {
        const { promptText, promptImage, projectId, model, ratio, duration, videoModel } = req.body;

        if (!promptText) {
          return res.status(400).json({ 
            error: 'Missing required fields',
            details: 'promptText is required'
          });
        }

        try {
          let result;
          
          if (videoModel === 'veo3') {
            if (!googleGeminiApiKey) {
              return res.status(500).json({ 
                error: 'Veo3 video generation service not configured',
                details: 'Please configure GOOGLE_GEMINI_API_KEY in environment variables'
              });
            }
            
            let veo3AspectRatio = '16:9';
            if (ratio === '1104:832') veo3AspectRatio = '4:3';
            else if (ratio === '832:1104') veo3AspectRatio = '9:16';
            else if (ratio === '1920:1080') veo3AspectRatio = '16:9';
            
            result = await generateVeo3Video({
              promptText,
              aspectRatio: veo3AspectRatio,
              duration
            });
            
          } else {
            if (!runwayApiKey) {
              return res.status(500).json({ 
                error: 'Runway video generation service not configured',
                details: 'Please configure RUNWAY_API_KEY in environment variables'
              });
            }
            
            if (promptImage && !promptImage.startsWith('http') && !promptImage.startsWith('data:')) {
              return res.status(400).json({
                error: 'Invalid image format',
                details: 'promptImage must be a valid URL or base64 data URL'
              });
            }
            
            let imageToUse = promptImage;
            if (!promptImage || promptImage.includes('dummyimage.com')) {
              imageToUse = 'https://images.unsplash.com/photo-1497215842964-222b430dc094?w=1280&h=720&fit=crop';
            }
            
            result = await generateRunwayVideo({
              promptText,
              promptImage: imageToUse,
              model: model || 'gen4_turbo',
              ratio: ratio || '1104:832',
              duration: duration || 5
            });
          }

          return res.status(200).json({
            success: true,
            videoUrl: result.url,
            taskId: result.taskId,
            model: videoModel || 'runway',
            metadata: result.metadata
          });

        } catch (error) {
          return res.status(500).json({ 
            error: 'Failed to generate video',
            details: error.message 
          });
        }
      }

      if (req.body.generateImage === true) {
        const { prompt, projectId, sessionId, imageModel, dimensions } = req.body;

        if (!prompt) {
          return res.status(400).json({ 
            error: 'Missing required fields',
            details: 'prompt is required'
          });
        }

        if (!openAIApiKey) {
          return res.status(500).json({ 
            error: 'Image generation service not configured',
            details: 'Please configure OPENAI_API_KEY'
          });
        }

        try {
          const model = 'gpt-image-1';
          
          const requestBody = {
            model: model,
            prompt: prompt,
            n: 1
          };
          
          if (dimensions) {
            requestBody.size = dimensions;
          } else {
            requestBody.size = '1536x1024';
          }
          
          const imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openAIApiKey}`
            },
            body: JSON.stringify(requestBody)
          });

          if (!imageResponse.ok) {
            const errorData = await imageResponse.text();
            
            if (imageResponse.status === 401) {
              return res.status(401).json({ 
                error: 'Invalid API key',
                details: 'Check your OpenAI API key configuration'
              });
            }
            
            if (imageResponse.status === 429) {
              return res.status(429).json({ 
                error: 'Rate limit exceeded',
                details: 'Too many requests. Please try again later.'
              });
            }
            
            if (imageResponse.status === 400) {
              let errorDetails = errorData;
              try {
                const errorJson = JSON.parse(errorData);
                errorDetails = errorJson.error?.message || errorData;
              } catch (e) {
              }
              return res.status(400).json({ 
                error: 'Invalid request',
                details: errorDetails
              });
            }
            
            return res.status(imageResponse.status).json({ 
              error: 'Failed to generate image',
              details: errorData
            });
          }

          const data = await imageResponse.json();

          let imageUrl = null;
          
          if (data.data && data.data.length > 0) {
            if (data.data[0].url) {
              imageUrl = data.data[0].url;
            } else if (data.data[0].b64_json) {
              const base64Image = data.data[0].b64_json;
              imageUrl = `data:image/png;base64,${base64Image}`;
            }
          }
          else if (data.url) {
            imageUrl = data.url;
          }
          
          if (imageUrl) {
            return res.status(200).json({
              success: true,
              imageUrl: imageUrl,
              revisedPrompt: data.data?.[0]?.revised_prompt || prompt,
              model: model
            });
          } else {
            throw new Error('No image URL found in response');
          }
          
        } catch (error) {
          return res.status(500).json({ 
            error: 'Failed to generate image',
            details: error.message 
          });
        }
      }
      
      let { userMessage, sessionId, audioData, projectId, projectName } = req.body;

      if (userMessage && userMessage.length > 5000) {
        userMessage = userMessage.slice(0, 5000) + "…";
      }

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
      }
      if (!userMessage && !audioData) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const projectConfig = getProjectConfig(projectId);
      const { baseId, chatTable, knowledgeTable } = projectConfig;

      const knowledgeBaseUrl = `https://api.airtable.com/v0/${baseId}/${knowledgeTable}`;
      const chatUrl = `https://api.airtable.com/v0/${baseId}/${chatTable}`;
      const headersAirtable = { 
        'Content-Type': 'application/json', 
        Authorization: `Bearer ${airtableApiKey}` 
      };

      let conversationContext = '';
      let existingRecordId = null;

      let knowledgeBaseInstructions = '';
      try {
        const kbResponse = await fetch(knowledgeBaseUrl, { headers: headersAirtable });
        if (kbResponse.ok) {
          const knowledgeBaseData = await kbResponse.json();
          const knowledgeEntries = knowledgeBaseData.records.map(record => record.fields.Summary).join('\n\n');
          knowledgeBaseInstructions = knowledgeEntries;
        } else {
        }
      } catch (error) {
      }

      try {
        const searchUrl = `${chatUrl}?filterByFormula=AND(SessionID="${sessionId}",ProjectID="${projectId}")`;
        const historyResponse = await fetch(searchUrl, { headers: headersAirtable });
        if (historyResponse.ok) {
          const result = await historyResponse.json();
          if (result.records.length > 0) {
            conversationContext = result.records[0].fields.Conversation || '';
            existingRecordId = result.records[0].id;

            if (conversationContext.length > 3000) {
              conversationContext = conversationContext.slice(-3000);
            }
          }
        }
      } catch (error) {
      }

      const shouldSearchDatabases = await shouldUseSearch(userMessage, conversationContext);
      
      let mcpRawOutput = [];
      let mcpStartTime = Date.now();
      
      if (shouldSearchDatabases) {
        mcpRawOutput.push({
          text: '🎬 Production context detected - search needed',
          timestamp: Date.now() - mcpStartTime
        });
      }
      
      if (shouldSearchDatabases) {
        mcpRawOutput.push({
          text: `🔍 Brand matching detection: ${shouldSearchDatabases ? 'YES' : 'NO'}`,
          timestamp: Date.now() - mcpStartTime
        });
      }

      if (audioData) {
        try {
          const audioBuffer = Buffer.from(audioData, 'base64');
          const openaiWsUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';

          const openaiWs = new WebSocket(openaiWsUrl, {
            headers: {
              Authorization: `Bearer ${openAIApiKey}`,
              'OpenAI-Beta': 'realtime=v1',
            },
          });

          let systemMessageContent = knowledgeBaseInstructions || "You are a helpful assistant specialized in AI & Automation.";
          if (conversationContext) {
            systemMessageContent += `\n\nConversation history: ${conversationContext}`;
          }
          systemMessageContent += `\n\nCurrent time in PDT: ${getCurrentTimeInPDT()}.`;
          if (projectId && projectId !== 'default') {
            systemMessageContent += ` You are assisting with the ${projectId} project.`;
          }

          openaiWs.on('open', () => {
            openaiWs.send(JSON.stringify({
              type: 'session.update',
              session: { instructions: systemMessageContent },
            }));
            openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: audioBuffer.toString('base64') }));
            openaiWs.send(JSON.stringify({
              type: 'response.create',
              response: { modalities: ['text'], instructions: 'Please respond to the user.' },
            }));
          });

          openaiWs.on('message', async (message) => {
            const event = JSON.parse(message);
            if (event.type === 'conversation.item.created' && event.item.role === 'assistant') {
              const aiReply = event.item.content.filter(content => content.type === 'text').map(content => content.text).join('');
              if (aiReply) {
                updateAirtableConversation(
                  sessionId, 
                  projectId, 
                  chatUrl, 
                  headersAirtable, 
                  `${conversationContext}\nUser: [Voice Message]\nAI: ${aiReply}`, 
                  existingRecordId
                ).catch(err => console.error('Airtable update error:', err));
                
                res.json({ 
                  reply: aiReply,
                  mcpThinking: null,
                  usedMCP: false
                });
              } else {
                res.status(500).json({ error: 'No valid reply received from OpenAI.' });
              }
              openaiWs.close();
            }
          });

          openaiWs.on('error', (error) => {
            res.status(500).json({ error: 'Failed to communicate with OpenAI' });
          });
          
        } catch (error) {
          res.status(500).json({ error: 'Error processing audio data.', details: error.message });
        }
      // This is the complete and final code to paste inside the 'else if (userMessage) { ... }' block
} else if (userMessage) {
        console.log('[DEBUG] Starting message processing for:', userMessage);
        try {
          // --- FIX APPLIED HERE ---
          // Timer and MCP steps are initialized at the very start of processing.
          const mcpStartTime = Date.now();
          let mcpSteps = []; 
          // --- END FIX ---

          let aiReply = '';
          let usedMCP = false;
          let structuredData = null;

          console.log('[DEBUG] Calling handleClaudeSearch...');
          
          // Extract the last production context for follow-up questions
          const lastProductionContext = extractLastProduction(conversationContext);
          
          const claudeResult = await handleClaudeSearch(
              userMessage,
              projectId,
              conversationContext,
              lastProductionContext,
              projectName // Pass the known name from the request body
          );
          console.log('[DEBUG] handleClaudeSearch returned:', claudeResult ? 'data' : 'null');

          if (claudeResult) {
              // A tool was successfully used!
              usedMCP = true;
              mcpSteps = claudeResult.mcpThinking.map(step => ({
                    ...step,
                    timestamp: Date.now() - mcpStartTime // Recalculate timestamp relative to the handler start
                })) || [];
              structuredData = claudeResult.organizedData;

              console.log('[DEBUG] Generating text summary with OpenAI...');
              let systemMessageContent = knowledgeBaseInstructions || `You are an expert assistant specialized in brand integration for Hollywood entertainment.`;
              
              // Special formatting for BRAND_ACTIVITY responses
              if (structuredData.dataType === 'BRAND_ACTIVITY') {
                // Count the actual items in the data
                const totalCommunications = structuredData.communications?.length || 0;
                const actualMeetings = structuredData.communications?.filter(c => c.type === 'meeting').length || 0;
                const actualEmails = structuredData.communications?.filter(c => c.type === 'email').length || 0;
                
                console.log('[DEBUG Text Generation] Total communications to display:', totalCommunications);
                console.log('[DEBUG Text Generation] Meetings to display:', actualMeetings);
                console.log('[DEBUG Text Generation] Emails to display:', actualEmails);
                
                // Log first few items to verify data
                if (structuredData.communications && structuredData.communications.length > 0) {
                  console.log('[DEBUG Text Generation] First 3 items:');
                  structuredData.communications.slice(0, 3).forEach((item, idx) => {
                    console.log(`  ${idx + 1}. [${item.type}] ${item.title}`);
                  });
                }
                
                systemMessageContent += `\n\nYou have retrieved activity data for a brand. Format your response EXACTLY as follows:

**ABSOLUTE REQUIREMENT: Display ALL ${totalCommunications} items from the communications array**

The data contains:
- ${actualMeetings} meetings
- ${actualEmails} emails
- Total: ${totalCommunications} items

YOU MUST DISPLAY ALL ${totalCommunications} ITEMS. If you skip ANY items, the system will fail.

**FORMATTING RULES:**
1. Start with "Based on the search results, here's the activity summary for [Brand Name]:"
2. List ALL ${totalCommunications} items in the EXACT order from the communications array
3. Number them 1 through ${totalCommunications}
4. Format each item:
   - Meetings: "[MEETING url='url_if_exists'] Title - Date" or "[MEETING] Title - Date"
   - Emails: "[EMAIL] Subject - Date"
5. Include bullet points with details for each item

**VERIFICATION CHECKLIST:**
☐ Did you display item 1? ${structuredData.communications?.[0]?.title || 'N/A'}
☐ Did you display item 2? ${structuredData.communications?.[1]?.title || 'N/A'}
☐ Did you display item 3? ${structuredData.communications?.[2]?.title || 'N/A'}
[Continue for all ${totalCommunications} items...]

**EXAMPLE (if there were 21 items):**
Based on the search results, here's the activity summary for [Brand Name]:

1. [EMAIL] Re: Additional Order - PEAK Daytona Helmet - 8/15/2024
   • From: Sarah Kistler
   • Follow-up on PEAK helmets timing

2. [MEETING url="https://fireflies.ai/xxx"] Peak Warner Meeting - 8/10/2024
   • Discussion of marketing efforts
   • Duration: 45 minutes

[... MUST CONTINUE THROUGH ALL 21 ITEMS ...]

21. [EMAIL] Initial Contact - 1/5/2024
   • First outreach email
   • From: Marketing Team

Key Contacts:
- [List any contacts]

**CRITICAL**: The MCP system found ${actualMeetings} meetings and ${actualEmails} emails.
You MUST display ALL of them or the numbers won't match and user trust will be lost.
Count your items before submitting - there should be EXACTLY ${totalCommunications} numbered items.`;
              } else {
                systemMessageContent += `\n\nA search has been performed and the structured results are below in JSON format. Your task is to synthesize this data into a helpful, conversational, and insightful summary for the user. Do not just list the data; explain what it means. Ensure all links are clickable in markdown.

**CRITICAL RULE: If the search results in the JSON are empty or contain no relevant information, you MUST state that you couldn't find any matching results. DO NOT, under any circumstances, invent or hallucinate information, brands, or meeting details.**

For brand recommendations, organize your response clearly:
- Start with a brief overview of what was found
- Group brands by their tags (Active Clients, New Opportunities, Genre Matches, Creative Suggestions)
- For each brand, mention key details like status, category, and why it's relevant
- If there are wildcard suggestions, explain these are creative ideas to explore

Keep the tone helpful and strategic, focusing on actionable insights.`;
              }

              systemMessageContent += '\n\n```json\n';
              systemMessageContent += JSON.stringify(structuredData, null, 2);
              systemMessageContent += '\n```';
              
              // Add verification instruction for BRAND_ACTIVITY
              if (structuredData.dataType === 'BRAND_ACTIVITY') {
                const totalItems = structuredData.communications?.length || 0;
                const meetingCount = structuredData.communications?.filter(c => c.type === 'meeting').length || 0;
                const emailCount = structuredData.communications?.filter(c => c.type === 'email').length || 0;
                
                // Log what we're sending to AI
                console.log('[DEBUG Final Verification] Sending to AI:');
                console.log('- Total items in communications array:', totalItems);
                console.log('- Meetings:', meetingCount);
                console.log('- Emails:', emailCount);
                console.log('- First email title:', structuredData.communications?.find(c => c.type === 'email')?.title);
                console.log('- All email titles:', structuredData.communications?.filter(c => c.type === 'email').map(e => e.title));
                
                systemMessageContent += `\n\n**FINAL VERIFICATION BEFORE YOU RESPOND**: 
                - The communications array has ${totalItems} items total
                - Specifically: ${meetingCount} meetings and ${emailCount} emails
                - You MUST display ALL ${totalItems} items numbered 1 through ${totalItems}
                - Each email MUST start with [EMAIL]
                - Each meeting MUST start with [MEETING] or [MEETING url="..."]
                - Count your response: it should have EXACTLY ${totalItems} numbered items
                - DO NOT skip items even if they seem similar
                - The user sees "${meetingCount} meetings and ${emailCount} emails" in the status, so you MUST show all of them`;
              }

              aiReply = await getTextResponseFromClaude(userMessage, sessionId, systemMessageContent);
              console.log('[DEBUG] Claude response received');

          } else {
              // No tool was used, so it's a general conversation.
              console.log('[DEBUG] No tool used, generating general response...');
              usedMCP = false;
              let systemMessageContent = knowledgeBaseInstructions || "You are a helpful assistant specialized in brand integration into Hollywood entertainment.";
              if (conversationContext) {
                  systemMessageContent += `\n\nConversation history: ${conversationContext}`;
              }
              aiReply = await getTextResponseFromClaude(userMessage, sessionId, systemMessageContent);
          }

          if (aiReply) {
              console.log('[DEBUG] Updating Airtable conversation...');
              updateAirtableConversation(
                  sessionId, projectId, chatUrl, headersAirtable,
                  `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`,
                  existingRecordId
              ).catch(err => console.error('[DEBUG] Airtable update error:', err));

              console.log('[DEBUG] Sending successful response');
              // The final response now includes mcpSteps for the frontend
              return res.json({
                  reply: aiReply,
                  structuredData: structuredData,
                  mcpSteps: mcpSteps, // Clean array with text and timestamp for each step
                  usedMCP: usedMCP,
                  // Add metadata for frontend parsing (only for BRAND_ACTIVITY)
                  activityMetadata: structuredData?.dataType === 'BRAND_ACTIVITY' ? {
                    totalCommunications: structuredData.communications?.length || 0,
                    meetingCount: structuredData.communications?.filter(c => c.type === 'meeting').length || 0,
                    emailCount: structuredData.communications?.filter(c => c.type === 'email').length || 0,
                    communications: structuredData.communications // Raw data with type field
                  } : null
              });
          } else {
              console.error('[DEBUG] No AI reply received');
              return res.status(500).json({ error: 'No text reply received.' });
          }
        } catch (error) {
          console.error("[CRASH DETECTED IN HANDLER]:", error);
          console.error("[STACK TRACE]:", error.stack);
          return res.status(500).json({ 
            error: 'Internal server error', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
          });
        }
      }
    } catch (error) {
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  } else {
    res.setHeader("Allow", ["POST", "OPTIONS"]);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
}

async function shouldUseSearch(userMessage, conversationContext) {
  // Simple keyword-based check for now
  const searchKeywords = ['brand', 'production', 'show', 'movie', 'series', 'find', 'search', 'recommend', 'suggestion', 'partner'];
  const messageLower = userMessage.toLowerCase();
  return searchKeywords.some(keyword => messageLower.includes(keyword));
}

async function getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent) {
  try {
    const messages = [
      { role: 'system', content: systemMessageContent },
      { role: 'user', content: userMessage }
    ];
    
    const totalLength = systemMessageContent.length + userMessage.length;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAIApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: messages,
        max_tokens: 1000,
        temperature: 0.7
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content;
    } else {
      return null;
    }
  } catch (error) {
    throw error;
  }
}

async function getTextResponseFromClaude(userMessage, sessionId, systemMessageContent) {
  try {
    // Special handling for BRAND_ACTIVITY to ensure all items are displayed
    let claudeSystemPrompt = `<role>You are an expert brand partnership analyst for Hollywood entertainment. You provide honest, nuanced analysis while being helpful and conversational.</role>

${systemMessageContent}`;
    
    // Check if this is a BRAND_ACTIVITY response
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
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000, // Increased to ensure we don't cut off long lists
        temperature: 0.3, // Lower temperature for more consistent following of instructions
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
    if (data.content && data.content.length > 0) {
      return data.content[0].text;
    } else {
      return null;
    }
  } catch (error) {
    // Fallback to OpenAI if Claude fails
    console.error('Claude failed, falling back to OpenAI:', error);
    if (openAIApiKey) {
      return getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent);
    }
    throw error;
  }
}

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
  }
}

