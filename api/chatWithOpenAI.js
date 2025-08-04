import dotenv from 'dotenv';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import RunwayML from '@runwayml/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Load environment variables first
dotenv.config();

// Verify environment variables are loaded
console.log('[ENV CHECK] Environment loaded:', {
  NODE_ENV: process.env.NODE_ENV,
  hasEnvFile: !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY,
  envKeys: Object.keys(process.env).filter(key => key.includes('API_KEY')).length
});

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

// Debug: Log API key status at startup
console.log('[STARTUP] API Keys Status:', {
  hasOpenAI: !!openAIApiKey,
  hasAnthropic: !!anthropicApiKey,
  hasHubspot: !!hubspotApiKey,
  hasFireflies: !!firefliesApiKey,
  hasMicrosoft: !!msftClientId
});

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
    try {
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.BRANDS}/search`, {
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
            'brand_name',
            'client_status',
            'client_type',
            'brand_website_url',
            'brand_category',
            'media_spend_m_',
            'partner_agency_name',
            'notes_last_contacted',
            'notes_last_updated',
            'num_associated_contacts',
            'description',
            'industry',
            'domain',
            'hubspot_owner_id',
            'hs_lastmodifieddate'
          ],
          limit: filters.limit || 50,
          sorts: [{ 
            propertyName: 'hs_lastmodifieddate', 
            direction: 'DESCENDING' 
          }]
        })
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error: ${response.status} - ${errorBody}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
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
      console.log('[HubSpot] Testing connection...');
      const startTime = Date.now();
      
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.BRANDS}?limit=1`, {
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      const success = response.ok;
      console.log('[HubSpot] Connection test:', {
        success,
        status: response.status,
        duration: Date.now() - startTime + 'ms'
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        console.error('[HubSpot] Connection test failed:', errorBody);
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('[HubSpot] Connection test error:', error);
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
      
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 30);
      const dateFilter = fromDate.toISOString();
      
      let filter = `receivedDateTime ge ${dateFilter}`;
      if (query && query.length > 2) {
        const searchTerm = query.replace(/'/g, "''").slice(0, 50);
        filter += ` and contains(subject,'${searchTerm}')`;
      }
      
      const messagesUrl = `https://graph.microsoft.com/v1.0/users/${userEmail}/messages?$filter=${encodeURIComponent(filter)}&$top=5&$select=subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc`;
      
      const response = await fetch(messagesUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        return [];
      }
      
      const data = await response.json();
      const emails = data.value || [];
      
      return emails.map(email => ({
        subject: email.subject,
        from: email.from?.emailAddress?.address,
        fromName: email.from?.emailAddress?.name,
        receivedDate: email.receivedDateTime,
        preview: email.bodyPreview?.slice(0, 200)
      }));
      
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
    
    const queryLower = query.toLowerCase();
    const filters = {
      keyword: query,
      limit: options.limit || 10
    };
    
    if (queryLower.includes('last 3 months') || queryLower.includes('past 3 months')) {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      filters.fromDate = threeMonthsAgo.toISOString().split('T')[0];
    }
    
    const transcripts = await firefliesAPI.searchTranscripts(filters);
    
    return {
      transcripts: transcripts
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

async function narrowWithOpenAI(airtableBrands, hubspotBrands, meetings, firefliesTranscripts, userMessage) {
  try {
    const allBrands = [...hubspotBrands];
    const result = await narrowWithIntelligentTags(allBrands, firefliesTranscripts || [], [], userMessage);
    return {
      topBrands: result.topBrands || [],
      scores: {}
    };
  } catch (error) {
    console.error('[narrowWithOpenAI] Error:', error);
    return { topBrands: [], scores: {} };
  }
}

async function searchHubSpot(query, projectId, limit = 50) {
  console.log('[searchHubSpot] Starting search:', { 
    hasApiKey: !!hubspotApiKey, 
    query: query?.substring(0, 50) + '...',
    limit 
  });
  
  if (!hubspotApiKey) {
    console.error('[searchHubSpot] No HubSpot API key configured');
    return { brands: [], productions: [] };
  }
  
  try {
    const isConnected = await hubspotAPI.testConnection();
    if (!isConnected) {
      console.error('[searchHubSpot] HubSpot connection test failed');
      return { brands: [], productions: [] };
    }
    
    // Check HubSpot API health
    const hubspotHealthStart = Date.now();
    const isHubSpotConnected = await hubspotAPI.testConnection();
    console.log('[handleClaudeSearch] HubSpot health check:', {
      connected: isHubSpotConnected,
      duration: Date.now() - hubspotHealthStart + 'ms'
    });
    
    const searchTerm = await extractSearchKeyword(query);
    
    let brandFilters = {};
    
    if (searchTerm) {
      brandFilters = {
        query: searchTerm
      };
    } else {
      brandFilters = {
        filterGroups: [
          {
            filters: [
              { 
                propertyName: 'brand_name', 
                operator: 'HAS_PROPERTY' 
              }
            ]
          },
          {
            filters: [
              { 
                propertyName: 'lifecyclestage', 
                operator: 'IN',
                values: ['customer', 'opportunity', 'salesqualifiedlead']
              }
            ]
          }
        ]
      };
    }

    const brandsData = await hubspotAPI.searchBrands({
      ...brandFilters,
      limit
    });

    const productionsData = await hubspotAPI.searchProductions({ limit });

    console.log('[searchHubSpot] Results:', {
      brandsFound: brandsData.results?.length || 0,
      productionsFound: productionsData.results?.length || 0
    });

    return {
      brands: brandsData.results || [],
      productions: productionsData.results || []
    };

  } catch (error) {
    console.error('[searchHubSpot] Error:', error);
    return { brands: [], productions: [] };
  }
}

async function narrowWithIntelligentTags(hubspotBrands, firefliesTranscripts, emails, userMessage) {
  try {
    const productionContext = extractProductionContext(userMessage);
    
    const taggedBrands = hubspotBrands.map(b => {
      const brand = {
        source: 'hubspot',
        id: b.id,
        name: b.properties.brand_name || b.properties.name || '',
        category: b.properties.brand_category || b.properties.industry || 'General',
        budget: b.properties.media_spend_m_ ? `${b.properties.media_spend_m_}M` : 'TBD',
        summary: (b.properties.description || '').slice(0, 100),
        lastActivity: b.properties.notes_last_contacted || b.properties.notes_last_updated || b.properties.hs_lastmodifieddate,
        hasPartner: !!b.properties.partner_agency_name,
        partnerAgency: b.properties.partner_agency_name,
        website: b.properties.domain,
        lifecyclestage: b.properties.lifecyclestage,
        clientStatus: b.properties.client_status,
        clientType: b.properties.client_type,
        numContacts: b.properties.num_associated_contacts || '0',
        hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI.portalId}/company/${b.id}`,
        tags: [],
        relevanceScore: 0,
        reason: ''
      };
      
      const tags = [];
      let score = 0;
      let primaryReason = '';
      
      const brandNameLower = brand.name.toLowerCase();
      const categoryLower = brand.category.toLowerCase();
      const synopsisLower = (productionContext.synopsis || userMessage).toLowerCase();
      let meetingMention = null;
      let emailMention = null;
      
      // Check for mentions in meetings/emails
      const mentionedInFireflies = firefliesTranscripts && firefliesTranscripts.some(t => {
        const overview = (t.summary?.overview || '').toLowerCase();
        const title = (t.title || '').toLowerCase();
        const topics = (t.summary?.topics_discussed || '').toLowerCase();
        const actionItems = (t.summary?.action_items || []).join(' ').toLowerCase();
        
        const searchText = `${title} ${overview} ${topics} ${actionItems}`;
        const brandNameClean = brand.name.toLowerCase()
          .replace(/\s*(inc\.?|llc|ltd|corp|corporation|company|co\.?)\s*$/i, '')
          .replace(/[''\'s]/g, '')
          .trim();
        
        if (!brandNameClean.includes(' ')) {
          if (searchText.includes(` ${brandNameClean} `) || 
              searchText.includes(` ${brandNameClean}.`) ||
              searchText.includes(` ${brandNameClean},`)) {
            meetingMention = {
              title: t.title,
              url: t.transcript_url,
              context: overview.slice(0, 150) || actionItems[0] || `Discussed ${brand.name}`,
              date: t.dateString || t.date,
              actionItems: actionItems[0] || null
            };
            return true;
          }
        } else {
          const coreBrandName = brandNameClean.split(' ')[0];
          if (coreBrandName.length > 3 && searchText.includes(coreBrandName)) {
            const contextCheck = searchText.includes(`${coreBrandName} brand`) ||
                                searchText.includes(`${coreBrandName} partnership`) ||
                                searchText.includes(`${coreBrandName} integration`) ||
                                searchText.includes(`${coreBrandName} deal`);
            if (contextCheck || searchText.includes(brandNameClean)) {
              meetingMention = {
                title: t.title,
                url: t.transcript_url,
                context: overview.slice(0, 150) || actionItems[0] || `Mentioned ${brand.name}`,
                date: t.dateString || t.date,
                actionItems: actionItems[0] || null
              };
              return true;
            }
          }
        }
        
        return false;
      });
      
      const mentionedInEmails = emails && emails.some(e => {
        const subject = (e.subject || '').toLowerCase();
        const preview = (e.preview || '').toLowerCase();
        const brandNameClean = brand.name.toLowerCase()
          .replace(/\s*(inc\.?|llc|ltd|corp|corporation|company|co\.?)\s*$/i, '')
          .trim();
        
        if (subject.includes(brandNameClean) || 
            (brandNameClean.includes(' ') && subject.includes(brandNameClean.split(' ')[0]))) {
          emailMention = {
            subject: e.subject,
            preview: preview.slice(0, 150),
            from: e.fromName || e.from,
            date: e.receivedDate,
            webLink: e.webLink || null
          };
          return true;
        }
        
        const contextWords = ['partnership', 'integration', 'brand', 'deal', 'proposal', 'opportunity'];
        if (preview.includes(brandNameClean) || 
            (brandNameClean.length > 4 && contextWords.some(ctx => preview.includes(`${brandNameClean.split(' ')[0]} ${ctx}`)))) {
          emailMention = {
            subject: e.subject,
            preview: preview.slice(0, 150),
            from: e.fromName || e.from,
            date: e.receivedDate,
            webLink: e.webLink || null
          };
          return true;
        }
        
        return false;
      });
      
      // PRIORITY 1: CONTEXTUAL MATCHING (Smart, not hardcoded)
      let contextScore = 0;
      const contextReasons = [];
      
      // Extract keywords from synopsis dynamically
      const importantWords = synopsisLower.match(/\b\w{4,}\b/g) || [];
      const uniqueWords = [...new Set(importantWords)].filter(word => 
        !['that', 'this', 'with', 'from', 'into', 'about', 'their', 'there', 'would', 'could', 'should', 'which', 'where', 'when'].includes(word)
      );
      
      // Check if brand name or category contains any important words from synopsis
      for (const word of uniqueWords) {
        if ((brandNameLower.includes(word) || categoryLower.includes(word)) && word.length > 5) {
          contextScore += 40;
          contextReasons.push(`Matches ${word} theme`);
          break;
        }
      }
      
      // Smart category matching based on synopsis content
      if (synopsisLower.includes('music') || synopsisLower.includes('singer') || synopsisLower.includes('band')) {
        if (categoryLower.includes('audio') || categoryLower.includes('music') || 
            categoryLower.includes('streaming') || categoryLower.includes('entertainment')) {
          contextScore += 50;
          contextReasons.push('Perfect for music content');
          tags.push('Music Fit');
        }
      }
      
      if (synopsisLower.includes('young') || synopsisLower.includes('teen') || synopsisLower.includes('student')) {
        if (categoryLower.includes('social') || categoryLower.includes('app') || 
            categoryLower.includes('youth') || categoryLower.includes('gen')) {
          contextScore += 40;
          contextReasons.push('Youth demographic match');
          tags.push('Youth Brand');
        }
      }
      
      if (synopsisLower.includes('luxury') || synopsisLower.includes('high-end') || synopsisLower.includes('premium')) {
        if (categoryLower.includes('luxury') || categoryLower.includes('premium') || 
            brand.budget && parseFloat(brand.budget) > 20) {
          contextScore += 45;
          contextReasons.push('Premium brand alignment');
          tags.push('Luxury Match');
        }
      }
      
      // PRIORITY 2: CREATIVE/GENRE MATCH
      if (productionContext.genre && brand.category) {
        const genreMatch = checkGenreMatch(productionContext.genre, brand.category);
        if (genreMatch && contextScore === 0) {
          tags.push('Genre Match');
          score += 35;
          primaryReason = `${brand.category} fits ${productionContext.genre} content`;
        }
      }
      
      // Apply context score FIRST if it exists
      if (contextScore > 0) {
        score += contextScore;
        primaryReason = contextReasons[0];
        if (!tags.length) {
          tags.push('Perfect Fit');
        }
      }
      
      // PRIORITY 3: RECENT REAL ACTIVITY
      if (meetingMention) {
        const meetingDate = new Date(meetingMention.date);
        const daysSinceMeeting = (new Date() - meetingDate) / (1000 * 60 * 60 * 24);
        
        if (daysSinceMeeting < 7) {
          tags.push('This Week');
          score += 25;
          if (!primaryReason) {
            primaryReason = `Meeting: "${meetingMention.title}" on ${meetingDate.toLocaleDateString()}`;
          }
        } else if (daysSinceMeeting < 30) {
          tags.push('Recent Activity');
          score += 20;
          if (!primaryReason) {
            primaryReason = `Discussed in "${meetingMention.title}"`;
          }
        }
        brand.meetingContext = meetingMention;
      }
      
      if (emailMention) {
        const emailDate = new Date(emailMention.date);
        const daysSinceEmail = (new Date() - emailDate) / (1000 * 60 * 60 * 24);
        
        if (daysSinceEmail < 7 && !tags.includes('This Week')) {
          tags.push('This Week');
          score += 20;
          if (!primaryReason) {
            primaryReason = `Email: "${emailMention.subject}"`;
          }
        }
        brand.emailContext = emailMention;
      }
      
      // Big Budget (but lower priority)
      if (brand.budget && brand.budget !== 'TBD') {
        const budgetValue = parseFloat(brand.budget.match(/\d+\.?\d*/)?.[0] || 0);
        if (budgetValue > 10) {
          tags.push('Big Spender');
          score += 20;
          if (!primaryReason) {
            primaryReason = `${brand.budget} budget available`;
          }
        }
      }
      
      // Active deals with action items
      if (meetingMention?.actionItems) {
        tags.push('Action Pending');
        score += 25;
        if (!primaryReason) {
          primaryReason = `Action needed: ${meetingMention.actionItems}`;
        }
      }
      
      // Current Client (low priority unless they have other good attributes)
      if (brand.clientStatus === 'Active' && score > 20) {
        tags.push('Active');
        score += 5;
      }
      
      // If no tags yet, look for any interesting signal
      if (tags.length === 0) {
        if (brand.hasPartner) {
          tags.push('Agency Backed');
          score += 10;
          primaryReason = `Represented by ${brand.partnerAgency}`;
        } else if (isEmergingCategory(brand.category)) {
          tags.push('Trending');
          score += 15;
          primaryReason = `Emerging ${brand.category} brand`;
        } else {
          tags.push('Explore');
          score += 5;
          primaryReason = 'Worth exploring';
        }
      }
      
      brand.tags = tags;
      brand.relevanceScore = score;
      brand.reason = primaryReason;
      
      return brand;
    });
    
    // Smart sorting that ensures variety
    const sortedBrands = taggedBrands
      .filter(b => b.relevanceScore > 0)
      .sort((a, b) => {
        // If one has context match and other doesn't, context wins
        const aHasContext = a.tags.some(t => ['Perfect Fit', 'Music Fit', 'Youth Brand', 'Luxury Match'].includes(t));
        const bHasContext = b.tags.some(t => ['Perfect Fit', 'Music Fit', 'Youth Brand', 'Luxury Match'].includes(t));
        
        if (aHasContext && !bHasContext) return -1;
        if (!aHasContext && bHasContext) return 1;
        
        return b.relevanceScore - a.relevanceScore;
      });
    
    // Ensure variety - don't let one category dominate
    const finalBrands = [];
    const categoryCount = {};
    const usedBrands = new Set();
    
    for (const brand of sortedBrands) {
      const category = brand.category.toLowerCase();
      const baseName = brand.name.split(' ')[0].toLowerCase();
      
      if (!categoryCount[category]) categoryCount[category] = 0;
      
      // Skip if we already have a very similar brand
      if (usedBrands.has(baseName)) continue;
      
      // Allow max 3 per category, but be more flexible for high scorers
      if (categoryCount[category] < 3 || brand.relevanceScore > 50) {
        finalBrands.push(brand);
        categoryCount[category]++;
        usedBrands.add(baseName);
      }
      
      if (finalBrands.length >= 15) break;
    }
    
    // If we don't have enough, add some more diverse options
    if (finalBrands.length < 15) {
      for (const brand of sortedBrands) {
        if (!finalBrands.includes(brand)) {
          finalBrands.push(brand);
          if (finalBrands.length >= 15) break;
        }
      }
    }
    
    return { topBrands: finalBrands, taggedBrands };
    
  } catch (error) {
    console.error('[narrowWithIntelligentTags] Error:', error);
    return { topBrands: hubspotBrands.slice(0, 15), taggedBrands: [] };
  }
}

function extractProductionContext(message) {
  if (!message || typeof message !== 'string') {
    return {
      title: null,
      genre: null,
      budget: null,
      distributor: null,
      targetDemo: null
    };
  }
  
  const context = {
    title: null,
    genre: null,
    budget: null,
    distributor: null,
    targetDemo: null
  };
  
  const titlePatterns = [
    /Title:\s*([^\n]+)/i,
    /Production:\s*([^\n]+)/i,
    /Film:\s*([^\n]+)/i,
    /Show:\s*([^\n]+)/i,
    /Project:\s*([^\n]+)/i,
    /^([A-Z][^:\n]+)[\n\s]+Synopsis:/im,
    /for\s+["']([^"']+)["']/i,
    /(?:the\s+production\s+)?["']([^"']+)["']/i
  ];
  
  for (const pattern of titlePatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      context.title = match[1].trim();
      break;
    }
  }
  
  const synopsisMatch = message.match(/Synopsis:\s*([\s\S]+?)(?:\n\n|$)/i);
  const synopsisText = synopsisMatch ? synopsisMatch[1] : message;
  
  const genrePatterns = {
    action: /\b(action|fight|chase|explosion|battle|war|combat|hero|villain)\b/i,
    comedy: /\b(comedy|funny|humor|hilarious|laugh|sitcom|comedic)\b/i,
    drama: /\b(drama|emotional|family|relationship|struggle|journey)\b/i,
    horror: /\b(horror|scary|terror|thriller|suspense|supernatural)\b/i,
    documentary: /\b(documentary|docu|non-fiction|true story|real|factual)\b/i,
    sports: /\b(sports|athletic|fitness|game|match|competition|championship)\b/i,
    scifi: /\b(sci-fi|science fiction|future|space|alien|technology|dystopian)\b/i,
    romance: /\b(romance|love|romantic|relationship|dating)\b/i,
    crime: /\b(crime|detective|investigation|murder|police|criminal|con\s*artist|con\s*woman|heist)\b/i,
    thriller: /\b(thriller|suspense|psychological|mystery|twist)\b/i
  };
  
  for (const [genre, pattern] of Object.entries(genrePatterns)) {
    if (pattern.test(synopsisText)) {
      context.genre = genre;
      break;
    }
  }
  
  const budgetMatch = message.match(/(?:budget|fee).*?\$(\d+)([MmKk])?/i);
  if (budgetMatch) {
    context.budget = budgetMatch[0];
  }
  
  const distributorMatch = message.match(/Distributor:\s*([^\n]+)/i);
  if (distributorMatch) {
    context.distributor = distributorMatch[1].trim();
  }
  
  return context;
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
    crime: /\b(crime|detective|investigation|murder|police|criminal)\b/i,
    music: /\b(music|singer|band|concert|song|album|musician|musical)\b/i,
    reality: /\b(reality|competition|contest|show)\b/i
  };
  
  for (const [genre, pattern] of Object.entries(genrePatterns)) {
    if (pattern.test(synopsis)) {
      return genre;
    }
  }
  
  return 'general';
}

function checkGenreMatch(productionGenre, brandCategory) {
  const genreMap = {
    sports: ['athletic', 'fitness', 'sports', 'energy', 'nutrition', 'wellness', 'performance', 'athletic wear', 'sportswear'],
    comedy: ['snack', 'beverage', 'casual', 'youth', 'entertainment', 'social', 'fun', 'food', 'candy'],
    action: ['automotive', 'technology', 'gaming', 'energy', 'extreme', 'adventure', 'performance', 'electronics', 'motorcycle'],
    drama: ['fashion', 'beauty', 'lifestyle', 'home', 'family', 'luxury', 'wellness', 'jewelry', 'furniture'],
    documentary: ['education', 'health', 'environment', 'social', 'tech', 'nonprofit', 'sustainability', 'organic'],
    thriller: ['tech', 'security', 'automotive', 'insurance', 'home security', 'financial', 'surveillance'],
    romance: ['jewelry', 'fashion', 'beauty', 'travel', 'hospitality', 'dining', 'luxury', 'flowers', 'chocolate'],
    scifi: ['technology', 'gaming', 'electronics', 'automotive', 'innovation', 'future', 'ai', 'vr', 'computer'],
    crime: ['security', 'insurance', 'automotive', 'tech', 'financial', 'legal', 'surveillance'],
    music: ['audio', 'headphones', 'streaming', 'instruments', 'fashion', 'youth brands', 'beverage', 'energy'],
    reality: ['beauty', 'fashion', 'social media', 'cosmetics', 'lifestyle', 'food', 'beverage']
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
    if (['drama', 'romance', 'comedy', 'reality'].includes(productionGenre) && 
        (categoryLower.includes('lifestyle') || categoryLower.includes('consumer'))) {
      return true;
    }
    
    // Youth/Gen Z brands for music and reality
    if (['music', 'reality'].includes(productionGenre) && 
        (categoryLower.includes('youth') || categoryLower.includes('gen z') || categoryLower.includes('social'))) {
      return true;
    }
  }
  
  return false;
}

async function extractSearchKeyword(query) {
  if (!openAIApiKey) return '';
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAIApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'system',
          content: 'Extract the search keyword from this query about meetings. If asking about "latest meeting" with no specific topic, return empty string. If asking about a specific brand/person/topic, return just that term. Return ONLY the keyword or empty string, nothing else.'
        }, {
          role: 'user',
          content: query
        }],
        temperature: 0,
        max_tokens: 20
      }),
    });
    
    const data = await response.json();
    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
      const keyword = data.choices[0].message.content.trim();
      return keyword;
    }
    
    return '';
    
  } catch (error) {
    console.error('[extractSearchKeyword] Error:', error);
    return '';
  }
}

async function handleClaudeSearch(userMessage, knowledgeBaseInstructions, projectId, sessionId, conversationContext) {
  console.log('[handleClaudeSearch] Starting...');

  if (!anthropicApiKey) {
    console.error('[handleClaudeSearch] No Anthropic API key available');
    return null;
  }
  
  try {
    const mcpThinking = [];
    
    // 1. PRODUCTION SHARED - Title & Synopsis provided
    const productionMatch = userMessage.match(/Title:\s*([^\n]+)[\s\S]*Synopsis:\s*([\s\S]+)/i);
    if (productionMatch) {
      const title = productionMatch[1].trim();
      const synopsis = productionMatch[2].trim();
      
      mcpThinking.push(`🎬 Production: "${title}"`);
      
      // Extract genre and keywords from synopsis
      const genre = extractGenreFromSynopsis(synopsis);
      const keywords = synopsis.match(/\b\w{5,}\b/g)?.slice(0, 5) || [];
      
      // Search HubSpot for brands
      const hubspotBrands = await hubspotAPI.searchBrands({ limit: 30 });
      mcpThinking.push(`✅ Found ${hubspotBrands.results?.length || 0} brands in HubSpot`);
      
      // Search for the production itself in HubSpot partnerships
      const partnershipSearch = await hubspotAPI.searchProductions({
        filterGroups: [{
          filters: [{
            propertyName: 'partnership_name',
            operator: 'CONTAINS_TOKEN',
            value: title
          }]
        }],
        limit: 5
      });
      
      // Search Fireflies for meetings about this production or genre
      const firefliesData = await searchFireflies(title, { limit: 10 });
      const genreMeetings = genre ? await searchFireflies(genre, { limit: 5 }) : { transcripts: [] };
      mcpThinking.push(`✅ Found ${firefliesData.transcripts?.length || 0} meetings`);
      
      // Search emails for production name and top brand names
      const emailSearches = await Promise.all([
        o365API.searchEmails(title, { days: 60 }),
        ...hubspotBrands.results.slice(0, 10).map(b => 
          o365API.searchEmails(b.properties.brand_name, { days: 30 })
        )
      ]);
      const allEmails = emailSearches.flat().filter(Boolean);
      mcpThinking.push(`✅ Found ${allEmails.length} relevant emails`);
      
      // Narrow down to top 15 brands
      const { topBrands } = await narrowWithIntelligentTags(
        hubspotBrands.results || [],
        firefliesData.transcripts || [],
        allEmails || [],
        `${title}\n${synopsis}`
      );
      
      return {
        organizedData: {
          type: 'production_analysis',
          production: {
            title,
            synopsis,
            genre,
            partnershipDetails: partnershipSearch.results?.[0] || null
          },
          // Structured data for frontend
          structuredData: {
            brands: topBrands.slice(0, 15).map(b => ({
              id: b.id,
              name: b.name,
              hubspotUrl: b.hubspotUrl,
              tags: b.tags,
              reason: b.reason
            })),
            meetings: firefliesData.transcripts?.slice(0, 5).map(m => ({
              id: m.id,
              title: m.title,
              date: m.dateString,
              url: m.transcript_url
            })),
            emails: allEmails.slice(0, 5).map(e => ({
              subject: e.subject,
              from: e.fromName || e.from,
              date: e.receivedDate
            }))
          },
          // Full data for OpenAI
          fullReport: {
            topBrands: topBrands.slice(0, 15),
            meetings: firefliesData.transcripts?.slice(0, 5) || [],
            emails: allEmails.slice(0, 5) || [],
            productionContext: { title, synopsis, genre }
          }
        },
        mcpThinking,
        usedMCP: true
      };
    }
    
    // 2. BRAND/MEETING/EMAIL LOOKUP - Intelligent detection
    const lookupPatterns = [
      /(?:find|show|get|list|what|any).*?(?:meetings?|calls?|emails?).*?(?:with|for|about|regarding)\s+([A-Z][^\?\.,]+)/i,
      /(?:meetings?|emails?|calls?).*?(?:with|for|about)\s+([A-Z][^\?\.,]+)/i,
      /^\/(?:meetings?|emails?)\s+(.+)/i
    ];
    
    let brandName = null;
    for (const pattern of lookupPatterns) {
      const match = userMessage.match(pattern);
      if (match) {
        brandName = match[1].trim();
        break;
      }
    }
    
    if (
