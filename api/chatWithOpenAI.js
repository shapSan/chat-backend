import dotenv from 'dotenv';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import RunwayML from '@runwayml/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
const hubspotApiKey = process.env.HUBSPOT_API_KEY;
const googleGeminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;
const firefliesApiKey = process.env.FIREFLIES_API_KEY || 'e88b1a60-3390-4dca-9605-20e533727717';
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

const hubspotAPI = {
  baseUrl: 'https://api.hubapi.com',
  portalId: '2944980',
  
  OBJECTS: {
    BRANDS: '2-26628489',
    PARTNERSHIPS: '2-27025032',
    DEALS: 'deals',
    COMPANIES: 'companies',
    CONTACTS: 'contacts'
  },
  
async searchBrands(filters = {}) {
  console.log('[DEBUG searchBrands] Starting with filters:', filters);
  try {
    let searchBody = {
      properties: [
        'id',
        'brand_name', 
        'client_status', 
        'client_type',
        'main_category',
        'product_sub_category__multi_',
        'partnership_count',
        'deals_count',
        'target_gender_',
        'target_geography',
        'hs_lastmodifieddate'
      ],
      limit: filters.limit || 50,
      sorts: [{ 
        propertyName: 'partnership_count', 
        direction: 'DESCENDING' 
      }]
    };

    // If a query (like a synopsis) is passed, use category matching
    if (filters.query && filters.query.length > 50) {
      console.log('[DEBUG searchBrands] Detected synopsis, extracting genre...');
      
      // Extract genre from synopsis for category matching
      const genreMap = {
        'action': ['Automotive', 'Electronics & Appliances', 'Sports & Fitness'],
        'comedy': ['Food & Beverage', 'Entertainment'],
        'drama': ['Fashion & Apparel', 'Health & Beauty', 'Home & Garden'],
        'romance': ['Floral', 'Fashion & Apparel', 'Health & Beauty'],
        'family': ['Food & Beverage', 'Baby Care', 'Entertainment'],
        'horror': ['Entertainment', 'Gaming'],
        'crime': ['Automotive', 'Security', 'Electronics & Appliances'],
        'thriller': ['Automotive', 'Security', 'Electronics & Appliances'],
        'sci-fi': ['Electronics & Appliances', 'Gaming', 'Automotive']
      };
      
      // Simple genre detection
      const queryLower = filters.query.toLowerCase();
      let categories = [];
      
      for (const [genre, cats] of Object.entries(genreMap)) {
        if (queryLower.includes(genre)) {
          categories = [...categories, ...cats];
        }
      }
      
      // Remove duplicates
      categories = [...new Set(categories)];
      
      // Build filter groups - MUST have active status
      searchBody.filterGroups = [
        {
          filters: [
            {
              propertyName: 'client_status',
              operator: 'IN',
              values: ['Active', 'In Negotiation', 'Contract']
            }
          ]
        }
      ];
      
      // Add category filter if we found matching categories
      if (categories.length > 0) {
        searchBody.filterGroups.push({
          filters: [{
            propertyName: 'main_category',
            operator: 'IN',
            values: categories
          }]
        });
      }
      
    } else if (filters.query) {
      // Short keyword search - search by brand name
      searchBody.query = filters.query;
      searchBody.filterGroups = [
        {
          filters: [
            {
              propertyName: 'client_status',
              operator: 'IN',
              values: ['Active', 'In Negotiation', 'Contract', 'Pending']
            }
          ]
        }
      ];
    } else {
      // Default: Get low hanging fruit - active brands with high activity
      searchBody.filterGroups = [
        {
          filters: [
            {
              propertyName: 'client_status',
              operator: 'IN',
              values: ['Active', 'Contract']
            },
            {
              propertyName: 'partnership_count',
              operator: 'GTE',
              value: '5'
            }
          ]
        }
      ];
      
      // Sort by deals count for commercial opportunities
      searchBody.sorts = [{ 
        propertyName: 'deals_count', 
        direction: 'DESCENDING' 
      }];
    }

    console.log('[DEBUG searchBrands] Making HubSpot API request...');
    const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.BRANDS}/search`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hubspotApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(searchBody)
    });
    
    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[DEBUG searchBrands] HubSpot API error:', response.status, errorBody);
      throw new Error(`HubSpot API error: ${response.status} - ${errorBody}`);
    }
    
    const result = await response.json();
    console.log('[DEBUG searchBrands] Success, got', result.results?.length || 0, 'brands');
    
    // Include the search context in the result
    if (filters.query && result.results) {
      // Attach the genre categories that were used (if any)
      const queryLower = filters.query.toLowerCase();
      const genreMap = {
        'action': ['Automotive', 'Electronics & Appliances', 'Sports & Fitness'],
        'comedy': ['Food & Beverage', 'Entertainment'],
        'drama': ['Fashion & Apparel', 'Health & Beauty', 'Home & Garden'],
        'romance': ['Floral', 'Fashion & Apparel', 'Health & Beauty'],
        'thriller': ['Automotive', 'Security', 'Electronics & Appliances']
      };
      
      let detectedGenres = [];
      for (const [genre, cats] of Object.entries(genreMap)) {
        if (queryLower.includes(genre)) {
          detectedGenres.push(genre);
        }
      }
      
      if (detectedGenres.length > 0) {
        result.searchContext = detectedGenres.join(', ');
      }
    }
    
    return result;
  } catch (error) {
    console.error("[DEBUG searchBrands] Error:", error);
    console.error("[DEBUG searchBrands] Stack trace:", error.stack);
    return { results: [] };
  }
},

  async searchProductions(filters = {}) {
    try {
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.PARTNERSHIPS}/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filterGroups: filters.filterGroups || [
            {
              filters: []
            }
          ],
          properties: [
            'partnership_name',
            'production_name',
            'partnership_status',
            'hs_pipeline_stage',
            'synopsis',
            'content_type',
            'distributor',
            'brand_name',
            'amount',
            'hollywood_branded_fee',
            'closedate',
            'contract_sent_date',
            'num_associated_contacts',
            'hubspot_owner_id',
            'hs_lastmodifieddate'
          ],
          limit: filters.limit || 30,
          sorts: [{ 
            propertyName: 'hs_lastmodifieddate', 
            direction: 'DESCENDING' 
          }]
        })
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      return { results: [] };
    }
  },

  async searchDeals(filters = {}) {
    try {
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.DEALS}/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filterGroups: filters.filterGroups || [
            {
              filters: []
            }
          ],
          properties: [
            'dealname',
            'amount',
            'closedate',
            'dealstage',
            'pipeline',
            'dealtype',
            'hubspot_owner_id',
            'hs_lastmodifieddate'
          ],
          limit: filters.limit || 30,
          sorts: [{ 
            propertyName: 'hs_lastmodifieddate', 
            direction: 'DESCENDING' 
          }]
        })
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      return { results: [] };
    }
  },

  async getContactsForBrand(brandId) {
    try {
      const response = await fetch(
        `${this.baseUrl}/crm/v3/objects/${this.OBJECTS.BRANDS}/${brandId}/associations/${this.OBJECTS.CONTACTS}`,
        {
          headers: {
            'Authorization': `Bearer ${hubspotApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        return [];
      }
      
      const associations = await response.json();
      
      if (associations.results && associations.results.length > 0) {
        const contactIds = associations.results.slice(0, 3).map(r => r.id);
        const batchResponse = await fetch(`${this.baseUrl}/crm/v3/objects/contacts/batch/read`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hubspotApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            inputs: contactIds.map(id => ({ id })),
            properties: ['firstname', 'lastname', 'email', 'jobtitle']
          })
        });
        
        if (batchResponse.ok) {
          const contactData = await batchResponse.json();
          return contactData.results || [];
        }
      }
      
      return [];
    } catch (error) {
      return [];
    }
  },

  async searchSpecificBrand(brandName) {
    try {
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.BRANDS}/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: brandName,
          properties: [
            'brand_name',
            'client_status',
            'client_type',
            'brand_website_url',
            'num_associated_contacts',
            'partner_agency_name',
            'hubspot_owner_id',
            'domain',
            'phone'
          ],
          limit: 5
        })
      });
      
      if (!response.ok) {
        throw new Error(`HubSpot API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      const exactMatch = data.results?.find(r => 
        r.properties.brand_name?.toLowerCase() === brandName.toLowerCase()
      );
      
      return exactMatch || data.results?.[0] || null;
    } catch (error) {
      return null;
    }
  },
  
  async testConnection() {
    try {
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.BRANDS}?limit=1`, {
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        return false;
      }
      
      return true;
    } catch (error) {
      return false;
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
      if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
        return this.accessToken;
      }
      
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
        throw new Error(`Microsoft auth failed: ${response.status}`);
      }
      
      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = new Date(Date.now() + (data.expires_in - 300) * 1000);
      
      return this.accessToken;
    } catch (error) {
      throw error;
    }
  },
  
  async searchEmails(query, options = {}) {
    try {
      if (!msftClientId || !msftClientSecret || !msftTenantId) {
        return [];
      }
      
      const accessToken = await this.getAccessToken();
      const userEmail = options.userEmail || 'stacy@hollywoodbranded.com';
      
      // If query is an array, it's pre-extracted keywords
      let searchTerms;
      if (Array.isArray(query)) {
        searchTerms = query;
      } else {
        // Legacy support - extract keywords if string passed
        searchTerms = await extractKeywordsForContextSearch(query);
        if (!searchTerms.includes(query) && query.length < 50) {
          searchTerms.push(query);
        }
      }
      
      // If no terms, use original query
      if (searchTerms.length === 0 && !Array.isArray(query)) {
        searchTerms = [query];
      }
      
      let allEmails = new Map();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - (options.days || 30));
      const dateFilter = fromDate.toISOString();
      
      // Search for each term
      for (const term of searchTerms.slice(0, 5)) { // Limit to 5 terms
        try {
          const searchTerm = term.replace(/'/g, "''").slice(0, 50);
          // Search in both subject and body
          const filter = `receivedDateTime ge ${dateFilter} and (contains(subject,'${searchTerm}') or contains(body/content,'${searchTerm}'))`;
          
          const messagesUrl = `https://graph.microsoft.com/v1.0/users/${userEmail}/messages?$filter=${encodeURIComponent(filter)}&$top=5&$select=id,subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc`;
          
          const response = await fetch(messagesUrl, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            (data.value || []).forEach(email => allEmails.set(email.id, email));
          }
        } catch (error) {
          // Continue with other terms if one fails
          console.error(`Error searching O365 for term "${term}":`, error);
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
      return formattedEmails
        .sort((a, b) => new Date(b.receivedDate) - new Date(a.receivedDate))
        .slice(0, options.limit || 10);
      
    } catch (error) {
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

const firefliesAPI = {
  baseUrl: 'https://api.fireflies.ai/graphql',
  
  async searchTranscripts(filters = {}) {
    try {
      const graphqlQuery = `
        query SearchTranscripts($keyword: String, $limit: Int, $fromDate: DateTime) {
          transcripts(
            keyword: $keyword, 
            limit: $limit,
            fromDate: $fromDate
          ) {
            id
            title
            date
            dateString
            duration
            organizer_email
            participants
            transcript_url
            summary {
              keywords
              action_items
              overview
              topics_discussed
            }
          }
        }
      `;
      
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firefliesApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: graphqlQuery,
          variables: {
            keyword: filters.keyword || '',
            limit: filters.limit || 10,
            fromDate: filters.fromDate
          }
        })
      });
      
      if (!response.ok) {
        return [];
      }
      
      const data = await response.json();
      return data.data?.transcripts || [];
    } catch (error) {
      return [];
    }
  },
  
  async getTranscript(transcriptId) {
    try {
      const graphqlQuery = `
        query GetTranscript($transcriptId: String!) {
          transcript(id: $transcriptId) {
            id
            title
            date
            dateString
            duration
            host_email
            organizer_email
            participants
            meeting_attendees {
              email
            }
            transcript_url
            audio_url
            video_url
            summary {
              keywords
              action_items
              outline
              shorthand_bullet
              overview
              bullet_gist
              gist
              short_summary
              short_overview
              meeting_type
              topics_discussed
              transcript_chapters
            }
            sentences {
              index
              speaker_name
              text
              start_time
            }
          }
        }
      `;
      
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firefliesApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: graphqlQuery,
          variables: { transcriptId }
        })
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Fireflies API error: ${response.status}`);
      }
      
      const data = await response.json();
      return data.data?.transcript || null;
    } catch (error) {
      return null;
    }
  },
  
  async testConnection() {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firefliesApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `query { user { email name } }`
        })
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
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
    return { transcripts: [] };
  }
  
  try {
    const isConnected = await firefliesAPI.testConnection();
    if (!isConnected) {
      return { transcripts: [] };
    }
    
    // If query is an array, it's pre-extracted keywords
    let searchTerms;
    if (Array.isArray(query)) {
      searchTerms = query;
    } else {
      // Legacy support - extract keywords if string passed
      searchTerms = await extractKeywordsForContextSearch(query);
      if (!searchTerms.includes(query) && query.length < 50) {
        searchTerms.push(query);
      }
    }
    
    // If no terms, use original query
    if (searchTerms.length === 0 && !Array.isArray(query)) {
      searchTerms = [query];
    }
    
    let allTranscripts = new Map();
    
    // Search for each term and combine results
    for (const term of searchTerms.slice(0, 5)) { // Limit to 5 terms
      try {
        const filters = {
          keyword: term,
          limit: options.limit || 3
        };
        
        // Add date filter if needed
        if (options.fromDate) {
          filters.fromDate = options.fromDate;
        }
        
        const results = await firefliesAPI.searchTranscripts(filters);
        results.forEach(t => allTranscripts.set(t.id, t));
      } catch (error) {
        // Continue with other terms if one fails
        console.error(`Error searching Fireflies for term "${term}":`, error);
      }
    }
    
    return {
      transcripts: Array.from(allTranscripts.values())
    };
    
  } catch (error) {
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
          { role: 'system', content: "Extract 2-4 industry/category keywords that brands would use. Focus on: product categories (luxury, fashion, automotive, tech, beverage), target demographics (family, youth, professional), or brand attributes (premium, eco-friendly, innovative). Examples: 'luxury fashion jewelry', 'automotive tech', 'premium beverage', 'family entertainment'. Return ONLY keywords, no names or locations." },
          { role: 'user', content: synopsis }
        ],
        temperature: 0, max_tokens: 30
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

    const systemPrompt = `You are an expert brand partnership strategist. Analyze brands for production fit. Return JSON with "results" array of top 15 brands. Consider: category match to content genre, partnership/deal history, client status/type. Each result needs: "id", "relevanceScore" (0-100), "tags" (descriptive strings), "reason" (concise explanation).`;
    
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

    console.log('[DEBUG narrowWithIntelligentTags] Calling OpenAI for ranking...');
    
    // Add timeout using AbortController
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 1000 // Limit response size
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeout);

      if (!response.ok) {
        console.error('[DEBUG narrowWithIntelligentTags] OpenAI API error:', response.status);
        throw new Error(`AI ranking API error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('[DEBUG narrowWithIntelligentTags] OpenAI response received');
      
      let rankedData;
      try {
        rankedData = JSON.parse(data.choices[0].message.content);
      } catch (parseError) {
        console.error('[DEBUG narrowWithIntelligentTags] JSON parse error:', parseError);
        console.error('[DEBUG narrowWithIntelligentTags] Raw response:', data.choices[0].message.content);
        // Try to extract results with regex as fallback
        const resultsMatch = data.choices[0].message.content.match(/"results"\s*:\s*\[([\s\S]*?)\]/);
        if (resultsMatch) {
          try {
            rankedData = { results: JSON.parse(`[${resultsMatch[1]}]`) };
          } catch (e) {
            throw parseError; // Re-throw original error if regex fallback fails
          }
        } else {
          throw parseError;
        }
      }
      
      const rankedResults = rankedData.results || [];
      console.log('[DEBUG narrowWithIntelligentTags] AI ranked', rankedResults.length, 'brands');

      const taggedBrands = rankedResults.map(rankedBrand => {
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
        console.error('[DEBUG narrowWithIntelligentTags] OpenAI request timed out');
      } else {
        console.error('[DEBUG narrowWithIntelligentTags] OpenAI request failed:', fetchError.message);
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
        description: 'Use this tool when the user asks to find, search for, or get recommendations for brands. This includes simple keyword searches (e.g., "beverage brands") and complex requests that include a full production synopsis.',
        parameters: {
          type: 'object',
          properties: {
            search_term: { type: 'string', description: 'The user\'s full request, including any keywords or synopsis text.' }
          },
          required: ['search_term']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_brand_activity',
        description: 'Use this tool for any request about a specific brand\'s activity. This includes asking for meetings, emails, calls, contacts, or general status updates like "what\'s new with...", "have we talked to...", "pull the file for...", "show me activity for...", "any updates on...", or "what\'s happening with...".',
        parameters: {
          type: 'object',
          properties: {
            brand_name: { type: 'string', description: 'The name of the brand to look up, e.g., "Nike" or "Paramount".' }
          },
          required: ['brand_name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_pitches_for_brands',
        description: 'Use this when the user asks to "create pitches", "generate ideas", "do a deep dive", or "create integration ideas" for one or more specific brand names.',
        parameters: {
          type: 'object',
          properties: {
            brand_names: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'An array of the specific brand names the user mentioned.' 
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
        description: 'Use for any general conversation or questions that do not require searching internal databases.',
        parameters: { type: 'object', properties: {} }
      }
    }
  ];

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert at routing a user request to the correct tool. If the user mentions ANY of these: synopsis, production, show, movie, series, script, story, plot, genre, mood, vibe, or asks to convert/analyze content for brand matching, use find_brands. If the user\'s request seems to refer to a previous topic (e.g., "for this project", "this production", "it"), you MUST use the provided "Last Production Context" to inform the tool call.' 
          },
          { 
            role: 'user', 
            content: `Last Production Context:\n"""\n${lastProductionContext || 'None'}\n"""\n\nUser's New Request:\n"""\n${userMessage}\n"""`
          }
        ],
        tools: tools,
        tool_choice: 'auto'
      })
    });

    if (!response.ok) throw new Error('AI router failed');
    const data = await response.json();
    const toolCall = data.choices[0].message.tool_calls?.[0];

    if (toolCall) {
      const args = JSON.parse(toolCall.function.arguments);
      // If referencing previous context and no explicit search term, use the context
      if (toolCall.function.name === 'find_brands' && !args.search_term && lastProductionContext) {
          args.search_term = lastProductionContext;
      }
      return { tool: toolCall.function.name, args: args };
    }
    return { tool: 'answer_general_question' };
  } catch (error) {
    console.error('Error in AI router:', error);
    return { tool: 'answer_general_question' };
  }
}

async function handleClaudeSearch(userMessage, projectId, conversationContext, lastProductionContext) {
  if (!anthropicApiKey) return null;

  const intent = await routeUserIntent(userMessage, conversationContext, lastProductionContext);

  if (!intent || intent.tool === 'answer_general_question') {
    return null;
  }
  
  const mcpThinking = [];

  try {
    switch (intent.tool) {
      
      case 'find_brands': {
        const { search_term } = intent.args;
        if (search_term.length > 50) {
            mcpThinking.push({ type: 'start', text: '🎬 Synopsis detected. Finding "no-brainer" matches...' });
            
            // Extract keywords once at the start
            const contextKeywords = await extractKeywordsForContextSearch(search_term);
            if (contextKeywords.length > 0) {
              mcpThinking.push({ type: 'process', text: `🧠 Extracted keywords: ${contextKeywords.slice(0, 5).join(', ')}` });
            }
            
            // Launch searches in parallel with timeouts
            mcpThinking.push({ type: 'search', text: '🔥 Searching HubSpot for active brands...' });
            mcpThinking.push({ type: 'search', text: '🎙️ Searching Fireflies for meeting context...' });
            mcpThinking.push({ type: 'search', text: '✉️ Searching Office 365 for relevant emails...' });
            
            const [
              hotBrandsData, firefliesContext, emailContext
            ] = await Promise.all([
              withTimeout(hubspotAPI.searchBrands({ limit: 100 }), 5000, { results: [] }), // Get larger pool
              withTimeout(searchFireflies(contextKeywords, { limit: 10 }), 8000, { transcripts: [] }),
              withTimeout(o365API.searchEmails(contextKeywords, { days: 180 }), 8000, [])
            ]);

            // Report initial results
            mcpThinking.push({ type: 'result', text: `✅ Found ${hotBrandsData.results.length} active brands.` });
            mcpThinking.push({ type: 'result', text: `✅ Found ${firefliesContext.transcripts?.length || 0} relevant meeting(s).` });
            mcpThinking.push({ type: 'result', text: `✅ Found ${emailContext?.length || 0} relevant email(s).` });

            // Pre-filter brands for "no-brainer" matches
            const preFilteredBrands = hotBrandsData.results.filter(brand => {
                const isRecentClient = brand.properties.client_status === 'Active' || 
                                     brand.properties.client_status === 'Contract';
                const isVibe = isVibeMatch(search_term, brand.properties.main_category || brand.properties.brand_category);
                const hasHighActivity = parseInt(brand.properties.partnership_count || 0) >= 5;
                
                // Check if brand appears in recent meetings
                const brandName = brand.properties.brand_name?.toLowerCase() || '';
                const hasRecentMeeting = firefliesContext.transcripts?.some(t => 
                    (t.summary?.overview || t.title || '').toLowerCase().includes(brandName)
                ) || false;
                
                // A brand is a "no-brainer" if it matches any of these criteria
                return isVibe || isRecentClient || hasRecentMeeting || hasHighActivity;
            });

            if (preFilteredBrands.length === 0) {
                mcpThinking.push({ type: 'error', text: '⚠️ No strong initial matches found. Expanding search...' });
                // Fall back to top active brands
                const fallbackBrands = hotBrandsData.results
                    .filter(b => b.properties.client_status === 'Active')
                    .slice(0, 20);
                
                if (fallbackBrands.length === 0) {
                    return { 
                        organizedData: { 
                            dataType: 'BRAND_RECOMMENDATIONS',
                            error: "Couldn't find any suitable brands for this project.",
                            brandSuggestions: []
                        }, 
                        mcpThinking, 
                        usedMCP: true 
                    };
                }
                
                // Use fallback brands for ranking
                mcpThinking.push({ type: 'process', text: `🧠 Analyzing ${fallbackBrands.length} active brands...` });
                
                const rankingResult = await withTimeout(
                  narrowWithIntelligentTags(fallbackBrands, firefliesContext.transcripts || [], emailContext || [], search_term),
                  15000,
                  { 
                    topBrands: fallbackBrands.slice(0, 15).map(b => ({
                      source: 'hubspot',
                      id: b.id,
                      name: b.properties.brand_name || '',
                      category: b.properties.main_category || 'General',
                      subcategories: b.properties.product_sub_category__multi_ || '',
                      clientStatus: b.properties.client_status || '',
                      clientType: b.properties.client_type || '',
                      partnershipCount: b.properties.partnership_count || '0',
                      dealsCount: b.properties.deals_count || '0',
                      lastActivity: b.properties.hs_lastmodifieddate,
                      hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI.portalId}/company/${b.id}`,
                      relevanceScore: 50,
                      tags: ['Active Brand'],
                      reason: 'Selected from active brands'
                    }))
                  }
                );
                
                const { topBrands } = rankingResult;
                
                mcpThinking.push({ type: 'complete', text: `✨ Prepared ${topBrands.length} recommendations from active brands.` });
                return {
                  organizedData: {
                    dataType: 'BRAND_RECOMMENDATIONS', 
                    productionContext: search_term,
                    brandSuggestions: topBrands.slice(0, 15),
                    supportingContext: { meetings: firefliesContext.transcripts || [], emails: emailContext || [] }
                  },
                  mcpThinking, usedMCP: true
                };
            }

            mcpThinking.push({ type: 'process', text: `🧠 Found ${preFilteredBrands.length} strong candidates. Sending to AI for final ranking...` });
            
            // Use timeout for AI ranking
            const rankingResult = await withTimeout(
              narrowWithIntelligentTags(
                preFilteredBrands, // Send the pre-filtered list
                firefliesContext.transcripts || [],
                emailContext || [],
                search_term
              ),
              15000,
              { 
                topBrands: preFilteredBrands.slice(0, 15).map(b => ({
                  source: 'hubspot',
                  id: b.id,
                  name: b.properties.brand_name || '',
                  category: b.properties.main_category || 'General',
                  subcategories: b.properties.product_sub_category__multi_ || '',
                  clientStatus: b.properties.client_status || '',
                  clientType: b.properties.client_type || '',
                  partnershipCount: b.properties.partnership_count || '0',
                  dealsCount: b.properties.deals_count || '0',
                  lastActivity: b.properties.hs_lastmodifieddate,
                  hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI.portalId}/company/${b.id}`,
                  relevanceScore: 75,
                  tags: ['Strong Match'],
                  reason: 'Pre-filtered as strong candidate'
                }))
              }
            );
            
            const { topBrands } = rankingResult;
            
            mcpThinking.push({ type: 'complete', text: `✨ Prepared ${topBrands.length} tailored recommendations.` });
            return {
              organizedData: {
                dataType: 'BRAND_RECOMMENDATIONS', 
                productionContext: search_term,
                brandSuggestions: topBrands.slice(0, 15),
                supportingContext: { meetings: firefliesContext.transcripts || [], emails: emailContext || [] }
              },
              mcpThinking, usedMCP: true
            };
        } else {
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
              mcpThinking, usedMCP: true
            };
        }
      }

      case 'get_brand_activity': {
        const { brand_name } = intent.args;
        mcpThinking.push({ type: 'start', text: `🎬 Activity retrieval detected for "${brand_name}"...` });
        
        // Search for the brand and its activity
        mcpThinking.push({ type: 'search', text: '🔍 Searching HubSpot for brand details...' });
        mcpThinking.push({ type: 'search', text: '🎙️ Searching Fireflies for meetings...' });
        
        const [brand, firefliesData] = await Promise.all([
          hubspotAPI.searchSpecificBrand(brand_name),
          firefliesApiKey ? searchFireflies(brand_name, { limit: 5 }) : { transcripts: [] }
        ]);
        
        if (!brand) {
          mcpThinking.push({ type: 'error', text: `❌ Brand "${brand_name}" not found in HubSpot.` });
          return { organizedData: { error: `Brand "${brand_name}" not found.` }, mcpThinking, usedMCP: true };
        }
        
        mcpThinking.push({ type: 'result', text: `✅ Found brand in HubSpot.` });
        mcpThinking.push({ type: 'result', text: `✅ Found ${firefliesData.transcripts?.length || 0} meeting(s).` });
        
        // Get contacts and emails
        mcpThinking.push({ type: 'search', text: '👥 Retrieving brand contacts...' });
        mcpThinking.push({ type: 'search', text: '✉️ Searching O365 for emails...' });
        
        const [contacts, o365Data] = await Promise.all([
            hubspotAPI.getContactsForBrand(brand.id),
            msftClientId ? o365API.searchEmails(brand_name, { days: 90 }) : []
        ]);
        
        mcpThinking.push({ type: 'result', text: `✅ Found ${contacts.length} contact(s).` });
        mcpThinking.push({ type: 'result', text: `✅ Found ${o365Data?.length || 0} email(s).` });
        mcpThinking.push({ type: 'complete', text: '✨ Activity report generated.' });
        
        return {
          organizedData: {
            dataType: 'BRAND_ACTIVITY', 
            brand: brand.properties,
            contacts: contacts.map(c => c.properties),
            meetings: firefliesData.transcripts || [], 
            emails: o365Data || []
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
        mcpThinking.push({ type: 'search', text: '🎙️ Searching for relevant meetings in Fireflies...' });
        mcpThinking.push({ type: 'search', text: '✉️ Searching for relevant emails in O365...' });
        
        const brandDataPromises = brand_names.map(name => 
          Promise.all([
            hubspotAPI.searchSpecificBrand(name),
            firefliesApiKey ? searchFireflies(`${name} ${lastProductionContext || ''}`, { limit: 5 }) : { transcripts: [] },
            msftClientId ? o365API.searchEmails(`${name} ${lastProductionContext || ''}`, { days: 180 }) : []
          ])
        );

        const allBrandData = await Promise.all(brandDataPromises);

        const organizedBrands = allBrandData.map(([brand, firefliesData, o365Data], index) => {
          if (!brand) {
            mcpThinking.push({ 
              type: 'error', 
              text: `❌ Brand "${brand_names[index]}" not found in HubSpot.` 
            });
            return null;
          }
          
          mcpThinking.push({ 
            type: 'result', 
            text: `✅ Found ${firefliesData.transcripts?.length || 0} meetings and ${o365Data?.length || 0} emails for ${brand_names[index]}.` 
          });
          
          return {
            details: brand.properties,
            meetings: firefliesData.transcripts || [],
            emails: o365Data || []
          };
        }).filter(Boolean);

        mcpThinking.push({ 
          type: 'complete', 
          text: `✨ Deep dive completed for ${organizedBrands.length} brand(s).` 
        });

        return {
          organizedData: {
            dataType: 'DEEP_DIVE_ANALYSIS',
            productionContext: lastProductionContext || 'General brand integration analysis',
            brands: organizedBrands,
            requestedBrands: brand_names
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
      
      let { userMessage, sessionId, audioData, projectId } = req.body;

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
          let aiReply = '';
          let mcpSteps = [];
          let usedMCP = false;
          let structuredData = null;

          console.log('[DEBUG] Calling handleClaudeSearch...');
          
          // Extract the last production context for follow-up questions
          const lastProductionContext = extractLastProduction(conversationContext);
          
          const claudeResult = await handleClaudeSearch(
              userMessage,
              projectId,
              conversationContext,
              lastProductionContext
          );
          console.log('[DEBUG] handleClaudeSearch returned:', claudeResult ? 'data' : 'null');

          if (claudeResult) {
              // A tool was successfully used!
              usedMCP = true;
              mcpSteps = claudeResult.mcpThinking || [];
              structuredData = claudeResult.organizedData;

              console.log('[DEBUG] Generating text summary with OpenAI...');
              let systemMessageContent = knowledgeBaseInstructions || `You are an expert assistant specialized in brand integration for Hollywood entertainment.`;
              systemMessageContent += `\n\nA search has been performed and the structured results are below in JSON format. Your task is to synthesize this data into a helpful, conversational, and insightful summary for the user. Do not just list the data; explain what it means. Ensure all links are clickable in markdown.

**CRITICAL RULE: If the search results in the JSON are empty or contain no relevant information, you MUST state that you couldn't find any matching results. DO NOT, under any circumstances, invent or hallucinate information, brands, or meeting details.**`;

              systemMessageContent += '\n\n```json\n';
              systemMessageContent += JSON.stringify(structuredData, null, 2);
              systemMessageContent += '\n```';

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
                  usedMCP: usedMCP
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
    // Claude prefers system content in the first user message
    const claudeSystemPrompt = `<role>You are an expert brand partnership analyst for Hollywood entertainment. You provide honest, nuanced analysis while being helpful and conversational.</role>

${systemMessageContent}`;
    
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
        temperature: 0.7,
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
