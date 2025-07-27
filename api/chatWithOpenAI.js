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
const microsoftTenantId = process.env.MICROSOFT_TENANT_ID;
const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;
const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;

// Project configuration mapping
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

// HubSpot API Helper Functions
const hubspotAPI = {
  baseUrl: 'https://api.hubapi.com',
  
  async searchBrands(filters = {}) {
    try {
      console.log('🔍 HubSpot searchBrands called with filters:', filters);
      
      // Search for companies that are actual brands
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/companies/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filterGroups: [
            {
              // Look for companies that have brand_name filled
              filters: [
                { 
                  propertyName: 'brand_name', 
                  operator: 'HAS_PROPERTY' 
                }
              ]
            },
            {
              // OR companies that are customers/opportunities (likely brands)
              filters: [
                { 
                  propertyName: 'lifecyclestage', 
                  operator: 'IN',
                  values: ['customer', 'opportunity', 'salesqualifiedlead']
                }
              ]
            }
          ],
          properties: [
            'name',
            'brand_name',
            'company_type',
            'brand_category',
            'lifecyclestage',
            'media_spend_m_',
            'partner_agency_name',
            'notes_last_contacted',
            'num_associated_contacts',
            'description',
            'industry',
            'annualrevenue',
            'numberofemployees',
            'website',
            'hs_lastmodifieddate',
            // Additional fields you mentioned
            'client_status',
            'target_generation',
            'target_income',
            'playbook'
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
        console.error('❌ HubSpot API error:', response.status, errorBody);
        throw new Error(`HubSpot API error: ${response.status} - ${errorBody}`);
      }
      
      const data = await response.json();
      console.log(`✅ HubSpot search returned ${data.results?.length || 0} companies`);
      
      return data;
    } catch (error) {
      console.error('❌ Error searching HubSpot brands:', error);
      console.error('Stack trace:', error.stack);
      return { results: [] };
    }
  },

  async searchProductions(filters = {}) {
    try {
      console.log('🔍 HubSpot searchProductions called (searching Deals)');
      
      // Productions/Partnerships are stored as Deals
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/deals/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filterGroups: [{
            filters: [
              { 
                propertyName: 'dealname', 
                operator: 'HAS_PROPERTY' 
              }
            ]
          }],
          properties: [
            'dealname',  // This is the Production/Partnership Name
            'content_type',
            'description',  // This might be Synopsis
            'dealstage',  // Partnership pipeline stage
            'closedate',
            'amount',
            'pipeline',
            'distributor',
            'brand_name',
            'hs_lastmodifieddate',
            'hubspot_owner_id',  // Owner
            // Try to get custom fields that might exist
            'production_scale',
            'talent',
            'have_contact',
            'synopsis',
            'partnership_overview'
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
        console.error('❌ HubSpot Productions API error:', response.status, errorBody);
        throw new Error(`HubSpot API error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log(`✅ HubSpot search returned ${data.results?.length || 0} productions/partnerships`);
      
      return data;
    } catch (error) {
      console.error('❌ Error searching HubSpot productions:', error);
      return { results: [] };
    }
  },

  async searchDeals(filters = {}) {
    // Alias for searchProductions since they're the same thing
    return this.searchProductions(filters);
  },

  async getContactsForCompany(companyId) {
    try {
      console.log('🔍 Getting contacts for company:', companyId);
      
      const response = await fetch(
        `${this.baseUrl}/crm/v3/objects/companies/${companyId}/associations/contacts`,
        {
          headers: {
            'Authorization': `Bearer ${hubspotApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        const errorBody = await response.text();
        console.error('❌ HubSpot Associations API error:', response.status, errorBody);
        throw new Error(`HubSpot API error: ${response.status}`);
      }
      
      const associations = await response.json();
      console.log(`Found ${associations.results?.length || 0} contact associations`);
      
      // Get contact details
      if (associations.results && associations.results.length > 0) {
        const contactIds = associations.results.map(r => r.id);
        const batchResponse = await fetch(`${this.baseUrl}/crm/v3/objects/contacts/batch/read`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hubspotApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            inputs: contactIds.slice(0, 10).map(id => ({ id })),
            properties: ['firstname', 'lastname', 'email', 'jobtitle', 'phone']
          })
        });
        
        if (batchResponse.ok) {
          const contactData = await batchResponse.json();
          return contactData.results || [];
        }
      }
      
      return [];
    } catch (error) {
      console.error('❌ Error getting contacts:', error);
      return [];
    }
  },

  // Add a test function to verify API connectivity
  async testConnection() {
    try {
      console.log('🔍 Testing HubSpot API connection...');
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/companies?limit=1`, {
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        console.error('❌ HubSpot API test failed:', response.status, errorBody);
        return false;
      }
      
      console.log('✅ HubSpot API connection successful');
      return true;
    } catch (error) {
      console.error('❌ HubSpot API test error:', error);
      return false;
    }
  }
};


// Microsoft Graph API Helper Functions (O365 Integration)
const microsoftTenantId = process.env.MICROSOFT_TENANT_ID;
const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;
const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;

// Microsoft Graph API Helper Functions (O365 Integration)
const o365API = {
  accessToken: null,
  tokenExpiry: null,
  
  async getAccessToken() {
    try {
      // Check if we have a valid cached token
      if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
        return this.accessToken;
      }
      
      console.log('🔐 Getting new Microsoft Graph access token...');
      
      const tokenUrl = `https://login.microsoftonline.com/${microsoftTenantId}/oauth2/v2.0/token`;
      
      const params = new URLSearchParams({
        client_id: microsoftClientId,
        client_secret: microsoftClientSecret,
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
        console.error('❌ Microsoft auth error:', response.status, errorText);
        throw new Error(`Microsoft auth failed: ${response.status}`);
      }
      
      const data = await response.json();
      this.accessToken = data.access_token;
      // Set expiry to 5 minutes before actual expiry for safety
      this.tokenExpiry = new Date(Date.now() + (data.expires_in - 300) * 1000);
      
      console.log('✅ Microsoft Graph access token obtained');
      return this.accessToken;
    } catch (error) {
      console.error('❌ Error getting Microsoft access token:', error);
      throw error;
    }
  },
  
  async searchEmails(query, options = {}) {
    try {
      console.log('📧 Searching O365 emails for:', query);
      
      if (!microsoftClientId || !microsoftClientSecret || !microsoftTenantId) {
        console.warn('Microsoft credentials not configured, skipping email search');
        return [];
      }
      
      const accessToken = await this.getAccessToken();
      
      // Build the search query
      const days = options.days || 30;
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      
      // KQL query for searching emails
      let searchQuery = `(body:"${query}" OR subject:"${query}")`;
      
      // Add date filter
      searchQuery += ` AND received>=${fromDate.toISOString()}`;
      
      // Add domain filter if searching for brands
      if (options.brandDomains && options.brandDomains.length > 0) {
        const domainFilters = options.brandDomains.map(d => `from:${d}`).join(' OR ');
        searchQuery = `(${searchQuery}) AND (${domainFilters})`;
      }
      
      const searchUrl = `https://graph.microsoft.com/v1.0/search/query`;
      
      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [{
            entityTypes: ['message'],
            query: {
              queryString: searchQuery
            },
            from: 0,
            size: options.limit || 25,
            fields: ['subject', 'from', 'toRecipients', 'receivedDateTime', 'bodyPreview', 'webLink']
          }]
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Microsoft Graph search error:', response.status, errorText);
        
        if (response.status === 401) {
          // Token might be expired, clear it
          this.accessToken = null;
          this.tokenExpiry = null;
        }
        
        throw new Error(`Email search failed: ${response.status}`);
      }
      
      const data = await response.json();
      const emails = data.value?.[0]?.hitsContainers?.[0]?.hits || [];
      
      console.log(`✅ Found ${emails.length} relevant emails`);
      
      // Format the results
      return emails.map(hit => ({
        id: hit.resource.id,
        subject: hit.resource.subject,
        from: hit.resource.from?.emailAddress?.address,
        fromName: hit.resource.from?.emailAddress?.name,
        receivedDate: hit.resource.receivedDateTime,
        preview: hit.resource.bodyPreview,
        webLink: hit.resource.webLink,
        relevanceScore: hit.rank || 0
      }));
      
    } catch (error) {
      console.error('❌ Error searching O365 emails:', error);
      // Return empty array instead of throwing - don't break the flow
      return [];
    }
  },
  
  async createDraft(subject, body, to, options = {}) {
    try {
      console.log('✉️ Creating email draft...');
      
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
      
      // Add CC if provided
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
        console.error('❌ Failed to create draft:', response.status, errorText);
        throw new Error(`Draft creation failed: ${response.status}`);
      }
      
      const draft = await response.json();
      console.log('✅ Email draft created:', draft.id);
      
      return {
        id: draft.id,
        webLink: draft.webLink
      };
      
    } catch (error) {
      console.error('❌ Error creating email draft:', error);
      throw error;
    }
  },
  
  async testConnection() {
    try {
      console.log('🔍 Testing O365 connection...');
      const token = await this.getAccessToken();
      
      // Test with a simple API call
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        console.error('❌ O365 test failed:', response.status);
        return false;
      }
      
      console.log('✅ O365 connection successful');
      return true;
    } catch (error) {
      console.error('❌ O365 connection test error:', error);
      return false;
    }
  }
};

const firefliesAPI = {
  baseUrl: 'https://api.fireflies.ai/graphql',
  
  async searchTranscripts(filters = {}) {
    try {
      console.log('🔍 Fireflies searchTranscripts called with filters:', filters);
      
      // Build the GraphQL query with ALL the fields I have access to
      const graphqlQuery = `
        query SearchTranscripts($keyword: String, $limit: Int, $fromDate: DateTime, $toDate: DateTime, $organizer_email: String, $participant_email: String) {
          transcripts(
            keyword: $keyword, 
            limit: $limit,
            fromDate: $fromDate,
            toDate: $toDate,
            organizer_email: $organizer_email,
            participant_email: $participant_email
          ) {
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
          variables: {
            keyword: filters.keyword || '',
            limit: filters.limit || 10,
            fromDate: filters.fromDate,
            toDate: filters.toDate,
            organizer_email: filters.organizer_email,
            participant_email: filters.participant_email
          }
        })
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        console.error('❌ Fireflies API error:', response.status, errorBody);
        throw new Error(`Fireflies API error: ${response.status} - ${errorBody}`);
      }
      
      const data = await response.json();
      console.log(`✅ Fireflies search returned ${data.data?.transcripts?.length || 0} transcripts`);
      
      return data.data?.transcripts || [];
    } catch (error) {
      console.error('❌ Error searching Fireflies transcripts:', error);
      return [];
    }
  },
  
  async getTranscript(transcriptId) {
    try {
      console.log('🔍 Fetching specific Fireflies transcript:', transcriptId);
      
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
        console.error('❌ Fireflies API error:', response.status, errorBody);
        throw new Error(`Fireflies API error: ${response.status}`);
      }
      
      const data = await response.json();
      return data.data?.transcript || null;
    } catch (error) {
      console.error('❌ Error fetching Fireflies transcript:', error);
      return null;
    }
  },
  
  async testConnection() {
    try {
      console.log('🔍 Testing Fireflies API connection...');
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
        console.error('❌ Fireflies API test failed:', response.status, errorBody);
        return false;
      }
      
      console.log('✅ Fireflies API connection successful');
      return true;
    } catch (error) {
      console.error('❌ Fireflies API test error:', error);
      return false;
    }
  }
};

// Enhanced search function with date filtering
async function searchFireflies(query, options = {}) {
  console.log('🔍 Searching Fireflies for transcripts...');
  
  if (!firefliesApiKey) {
    console.warn('No Fireflies API key configured, skipping Fireflies search');
    return { transcripts: [] };
  }
  
  try {
    // Test connection first
    const isConnected = await firefliesAPI.testConnection();
    if (!isConnected) {
      console.error('❌ Fireflies API connection failed');
      return { transcripts: [] };
    }
    
    // Parse query for special searches
    const queryLower = query.toLowerCase();
    const filters = {
      keyword: query,
      limit: options.limit || 10
    };
    
    // Auto-detect time-based queries
    if (queryLower.includes('last 3 months') || queryLower.includes('past 3 months')) {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      filters.fromDate = threeMonthsAgo.toISOString().split('T')[0];
    }
    
    // Search for transcripts
    const transcripts = await firefliesAPI.searchTranscripts(filters);
    
    console.log(`✅ Fireflies search complete: ${transcripts.length} transcripts`);
    
    return {
      transcripts: transcripts
    };
    
  } catch (error) {
    console.error('❌ Error searching Fireflies:', error);
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

// Stage 1: Enhanced search function that now includes HubSpot
async function searchAirtable(query, projectId, searchType = 'auto', limit = 100) {
  console.log('🔍 Stage 1: Searching Airtable:', { query, projectId, searchType, limit });
  
  try {
    // Auto-detect search type if not specified
    if (searchType === 'auto') {
      const queryLower = query.toLowerCase();
      if (queryLower.includes('meeting') || 
          queryLower.includes('call') || 
          queryLower.includes('discussion') ||
          queryLower.includes('talked') ||
          queryLower.includes('spoke')) {
        searchType = 'meetings';
      } else {
        searchType = 'brands';
      }
    }
    
    const config = {
      baseId: 'apphslK7rslGb7Z8K',
      searchMappings: {
        'meetings': {
          table: 'Meeting Steam',
          view: 'ALL Meetings',
          fields: ['Title', 'Date', 'Summary', 'Link']
        },
        'brands': {
          table: 'Brands',
          view: null,
          fields: ['Brand Name', 'Last Modified', 'Category', 'Budget', 'Campaign Summary']
        }
      }
    };
    
    const searchConfig = config.searchMappings[searchType];
    if (!searchConfig) {
      console.error('Invalid search type:', searchType);
      return { error: 'Invalid search type', records: [], total: 0 };
    }
    
    // Build Airtable URL
    let url = `https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent(searchConfig.table)}`;
    const params = [`maxRecords=${limit}`];
    
    if (searchConfig.view) {
      params.push(`view=${encodeURIComponent(searchConfig.view)}`);
    }
    
    searchConfig.fields.forEach(field => {
      params.push(`fields[]=${encodeURIComponent(field)}`);
    });
    
    url += '?' + params.join('&');
    
    console.log('📡 Fetching from Airtable URL:', url);
    
    // Fetch from Airtable
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${airtableApiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Airtable API error:', response.status, errorText);
      throw new Error(`Airtable API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    console.log(`✅ Stage 1 complete: Got ${data.records.length} ${searchType} from Airtable`);
    
    return {
      searchType,
      records: data.records,
      total: data.records.length
    };
    
  } catch (error) {
    console.error('❌ Error searching Airtable:', error);
    return { error: error.message, records: [], total: 0 };
  }
}

// New: Search HubSpot for brands and production data
async function searchHubSpot(query, projectId, limit = 50) {
  console.log('🔍 Searching HubSpot for brands and productions...');
  
  if (!hubspotApiKey) {
    console.warn('No HubSpot API key configured, skipping HubSpot search');
    return { brands: [], productions: [] };
  }
  
  try {
    // Test connection first
    const isConnected = await hubspotAPI.testConnection();
    if (!isConnected) {
      console.error('❌ HubSpot API connection failed');
      return { brands: [], productions: [] };
    }
    
    // Extract what we're searching for
    const searchTerm = await extractSearchKeyword(query);
    console.log(`🔍 HubSpot search term: "${searchTerm}"`);
    
    // Build smart filters based on the search
    let filterGroups = [];

    if (searchTerm) {
      filterGroups = [
        {
          filters: [{
            propertyName: 'name',
            operator: 'CONTAINS_TOKEN',
            value: searchTerm
          }]
        },
        {
          filters: [{
            propertyName: 'brand_name',
            operator: 'CONTAINS_TOKEN',
            value: searchTerm
          }]
        }
      ];
    } else {
      filterGroups = [
        {
          filters: [{ 
            propertyName: 'brand_name', 
            operator: 'HAS_PROPERTY' 
          }]
        },
        {
          filters: [{ 
            propertyName: 'lifecyclestage', 
            operator: 'IN',
            values: ['customer', 'opportunity', 'salesqualifiedlead']
          }]
        }
      ];
    }

    const brandsData = await hubspotAPI.searchBrands({
      filterGroups: filterGroups,
      limit
    });

    const productionsData = await hubspotAPI.searchProductions({ limit });

    return {
      brands: brandsData.results || [],
      productions: productionsData.results || []
    };

  } catch (error) {
    console.error('❌ Error searching HubSpot:', error);
    return { brands: [], productions: [] };
  }
}

// Stage 2: Enhanced narrowing that includes HubSpot data
async function narrowWithOpenAI(airtableBrands, hubspotBrands, meetings, firefliesTranscripts, userMessage) {
  try {
    console.log(`🧮 Stage 2: Narrowing ${airtableBrands.length + hubspotBrands.length} brands with OpenAI...`);
    
    // Extract distributor and production company names to exclude them
    const excludeList = new Set();
    const userMessageLower = userMessage.toLowerCase();
    
    // Look for distributor patterns
    const distributorMatch = userMessage.match(/Distributor:\s*([^\n]+)/i);
    if (distributorMatch && distributorMatch[1]) {
      const distributors = distributorMatch[1].split(/[\/,]/).map(d => d.trim().toLowerCase());
      distributors.forEach(d => excludeList.add(d));
      console.log('🚫 Excluding distributors:', distributors);
    }
    
    // Look for production company patterns
    const productionMatch = userMessage.match(/Production Company:\s*([^\n]+)/i);
    if (productionMatch && productionMatch[1]) {
      const producers = productionMatch[1].split(/[\/,]/).map(p => p.trim().toLowerCase());
      producers.forEach(p => excludeList.add(p));
      console.log('🚫 Excluding production companies:', producers);
    }
    
    // Add common distributor/studio keywords to exclude
    const studioKeywords = ['studios', 'pictures', 'films', 'productions', 'distribution'];
    
    // Combine and deduplicate brands from both sources
    const allBrands = [];
    const brandNames = new Set();
    
    // Add Airtable brands
    airtableBrands.forEach(b => {
      const name = b.fields['Brand Name'];
      if (name && !brandNames.has(name.toLowerCase())) {
        const nameLower = name.toLowerCase();
        
        // Skip if it's a distributor or production company
        if (excludeList.has(nameLower) || 
            studioKeywords.some(keyword => nameLower.includes(keyword))) {
          console.log(`⏭️ Skipping ${name} (appears to be distributor/studio)`);
          return;
        }
        
        brandNames.add(nameLower);
        allBrands.push({
          source: 'airtable',
          name: name,
          category: b.fields['Category'] || 'General',
          budget: b.fields['Budget'] || 'TBD',
          summary: (b.fields['Campaign Summary'] || '').slice(0, 100),
          lastActivity: b.fields['Last Modified']
        });
      }
    });
    
    // Add HubSpot brands - with better field handling
    hubspotBrands.forEach(b => {
      // Use brand_name if available, otherwise fall back to name
      const name = b.properties.brand_name || b.properties.name;
      if (name && !brandNames.has(name.toLowerCase())) {
        const nameLower = name.toLowerCase();
        
        // Skip if it's a distributor or production company
        if (excludeList.has(nameLower) || 
            studioKeywords.some(keyword => nameLower.includes(keyword))) {
          console.log(`⏭️ Skipping ${name} (appears to be distributor/studio)`);
          return;
        }

      
        
        brandNames.add(nameLower);
        
        // Determine if this is actually a brand based on available data
        const isBrand = b.properties.company_type?.includes('Brand') || 
                       b.properties.brand_name || 
                       b.properties.brand_category ||
                       b.properties.lifecyclestage === 'customer' ||
                       b.properties.lifecyclestage === 'opportunity';
        
        allBrands.push({
          source: 'hubspot',
          name: name,
          category: b.properties.brand_category || b.properties.industry || 'General',
          budget: b.properties.media_spend_m_ ? `$${b.properties.media_spend_m_}M` : 
                  b.properties.annualrevenue ? `Revenue: $${(b.properties.annualrevenue/1000000).toFixed(1)}M` : 'TBD',
          summary: (b.properties.description || '').slice(0, 100),
          lastActivity: b.properties.notes_last_contacted || b.properties.hs_lastmodifieddate,
          hasPartner: !!b.properties.partner_agency_name,
          partnerAgency: b.properties.partner_agency_name,
          contactCount: b.contacts ? b.contacts.length : 0,
          primaryContact: b.contacts && b.contacts[0] ? 
            `${b.contacts[0].properties.firstname || ''} ${b.contacts[0].properties.lastname || ''} ${b.contacts[0].properties.email ? `(${b.contacts[0].properties.email})` : ''}`.trim() : null,
          isBrand: isBrand,
          website: b.properties.website,
          employees: b.properties.numberofemployees,
          // Additional fields
          clientStatus: b.properties.client_status,
          targetGeneration: b.properties.target_generation,
          targetIncome: b.properties.target_income,
          playbook: b.properties.playbook
        });
      }
    });

    
    
    // Create a product placement focused scoring prompt
    const scoringPrompt = `
Production details: ${userMessage}

Score these brands 0-100 based on their potential for PRODUCT PLACEMENT in this production.

IMPORTANT RULES:
- Only score brands whose PRODUCTS can physically appear in scenes (drinks, food, cars, phones, clothing, etc.)
- Score 0 for streaming services (Netflix, Apple TV+, Amazon Prime, Disney+, Hulu, etc.)
- Score 0 for distributors, studios, or production companies
- Score 0 for digital-only services that can't have physical product placement

Focus on brands that could naturally integrate their products into the story through:
- Props that characters use (beverages, technology, vehicles)
- Set dressing (home goods, appliances, decor)
- Wardrobe (clothing, accessories, shoes)
- Location branding (restaurants, stores, hotels)

Return ONLY a JSON object with brand names as keys and scores as values.

Brands to evaluate:
${allBrands.slice(0, 50).map(b => 
  `${b.name}: ${b.category}, Budget: ${b.budget}${b.hasPartner ? ', Has Partner Agency' : ''}, ${b.summary}`
).join('\n')}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAIApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo-1106',
        messages: [
          {
            role: 'system',
            content: 'You are a product placement expert for film/TV. Score ONLY brands whose physical products can appear on screen. Streaming services, distributors, and digital platforms should always score 0. Focus on consumer goods, fashion, automotive, food/beverage, and technology brands with tangible products.'
          },
          {
            role: 'user',
            content: scoringPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 800,
        response_format: { type: "json_object" }
      }),
    });
    
    if (!response.ok) {
      console.error('OpenAI scoring error:', response.status);
      return { topBrands: allBrands.slice(0, 15), scores: {} };
    }
    
    const data = await response.json();
   let scores = {};
try {
  scores = JSON.parse(data.choices[0].message.content);
} catch (parseError) {
  console.error('Failed to parse OpenAI scores, using fallback scoring');
  // Fallback: give all brands a default score
  allBrands.forEach(b => {
    scores[b.name] = 50; // Default middle score
  });
}
    
    // Sort brands by score and take top 15
    const topBrands = allBrands
      .map(b => ({
        ...b,
        relevanceScore: scores[b.name] || 0
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 15);
    
    console.log(`✅ Stage 2 complete: Narrowed to ${topBrands.length} top brands`);
    console.log(`🏆 Top 3: ${topBrands.slice(0, 3).map(b => `${b.name} (${b.relevanceScore})`).join(', ')}`);
    
    return { topBrands, scores };
    
  } catch (error) {
    console.error('❌ Error in OpenAI narrowing:', error);
    // Return all brands if scoring fails
    return { topBrands: [...airtableBrands, ...hubspotBrands].slice(0, 15), scores: {} };
  }
}
// AI-powered keyword extraction for Fireflies searches
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
        model: 'gpt-3.5-turbo',
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
    const keyword = data.choices[0].message.content.trim();
    console.log(`🔍 AI extracted keyword: "${keyword}" from query: "${query}"`);
    return keyword;
    
  } catch (error) {
    console.error('Error extracting keyword:', error);
    return ''; // Default to no keyword
  }
}

// Stage 3: Claude MCP search that ONLY gathers data (doesn't generate final response)
async function handleClaudeSearch(userMessage, knowledgeBaseInstructions, projectId, sessionId, conversationContext) {
  console.log('🤖 Starting Claude MCP data gathering with HubSpot integration...');
  
  if (!anthropicApiKey) {
    console.warn('No Anthropic API key found, falling back to OpenAI');
    return null;
  }
  
  // Extract the current production context from conversation history
  let currentProduction = null;
  if (conversationContext) {
    // Look for production names in recent conversation
    const productionPatterns = [
      /(?:for|about|regarding)\s+["']?([A-Z][^"'\n]+?)["']?\s*(?:\n|Starting Fee:|Distributor:)/i,
      /^([A-Z][^\n]+?)\s*\n\s*(?:Starting Fee:|Distributor:|Cast:|Synopsis:)/im,
      /(?:project|production|film|show)\s+(?:called|named|titled)\s+["']?([^"'\n]+?)["']?/i
    ];
    
    for (const pattern of productionPatterns) {
      const match = conversationContext.match(pattern);
      if (match && match[1]) {
        currentProduction = match[1].trim();
        console.log(`📽️ Detected current production context: "${currentProduction}"`);
        break;
      }
    }
  }
  
  // Enhance the user message with production context if needed
  let enhancedMessage = userMessage;
  if (currentProduction && !userMessage.toLowerCase().includes(currentProduction.toLowerCase())) {
    enhancedMessage = `${userMessage} (for ${currentProduction} project)`;
    console.log(`🎬 Enhanced query with production context: ${enhancedMessage}`);
  }
  
  try {
    // Stage 1: Get data from both Airtable and HubSpot
    console.log('📊 Stage 1: Fetching from Airtable and HubSpot...');
    
    // Debug O365 credentials
    console.log('🔑 O365 credentials check:', {
      tenant: microsoftTenantId ? 'Present' : 'MISSING!',
      client: microsoftClientId ? 'Present' : 'MISSING!',
      secret: microsoftClientSecret ? 'Present' : 'MISSING!'
    });
    
    // Use the enhanced message for searching
// Extract keyword intelligently for Fireflies
const firefliesKeyword = await extractSearchKeyword(userMessage);

// Use the enhanced message for searching
const [airtableData, hubspotData, firefliesData, o365Data] = await Promise.all([
  searchAirtable(enhancedMessage, projectId, 'brands', 100),
  hubspotApiKey ? searchHubSpot(enhancedMessage, projectId, 50) : { brands: [], productions: [] },
  firefliesApiKey ? searchFireflies(firefliesKeyword, { limit: 20 }) : { transcripts: [] },
  microsoftClientId ? o365API.searchEmails(enhancedMessage, { 
    days: 30, 
    limit: 20,
    brandDomains: [] // We'll populate this with brand domains if needed
  }) : []
]);
    
    const meetingData = await searchAirtable(enhancedMessage, projectId, 'meetings', 50);
    
    // Check if we got actual data
    if ((!airtableData.records || airtableData.records.length === 0) && 
        (!hubspotData.brands || hubspotData.brands.length === 0) &&
        (!meetingData.records || meetingData.records.length === 0)) {
      console.error('❌ No data returned from either source!');
      return null;
    }
    
    // Stage 2: Narrow with OpenAI
const { topBrands, scores } = await narrowWithOpenAI(
      airtableData.records || [],
      hubspotData.brands || [],
      meetingData.records || [],
      firefliesData.transcripts || [],
      enhancedMessage
    );
    
    // Stage 3: Use Claude ONLY for organizing/analyzing data
    console.log('🧠 Stage 3: Claude organizing data for OpenAI...');
    
    // Create a focused prompt for Claude to organize the data
    const dataOrgPrompt = `You are a data analyst. Organize and summarize the following brand and meeting data for a production matching request.

User Query: ${enhancedMessage}
${currentProduction ? `Current Production: ${currentProduction}` : ''}

Available Data:
${topBrands.length > 0 ? `
TOP BRANDS (${topBrands.length} total):
${topBrands.map(b => `- ${b.name}: Score ${b.relevanceScore}, Budget ${b.budget}, ${b.hasPartner ? 'Has Partner' : 'No Partner'}, ${b.contactCount || 0} contacts`).join('\n')}
` : ''}

${hubspotData.productions?.length > 0 ? `
PRODUCTIONS (${hubspotData.productions.length} total):
${hubspotData.productions.slice(0, 5).map(p => `- ${p.properties.dealname}: ${p.properties.content_type || 'Unknown type'}, ${p.properties.distributor ? `Distributor: ${p.properties.distributor}` : ''}`).join('\n')}
` : ''}

${meetingData.records?.length > 0 ? `
RECENT MEETINGS (${meetingData.records.length} total):
${meetingData.records.slice(0, 5).map(m => `- ${m.fields['Title'] || 'Untitled'}: ${(m.fields['Summary'] || '').slice(0, 50)}...`).join('\n')}
` : ''}

Please provide a structured JSON summary of:
1. The most relevant brands for this query (top 5-10)
2. Key insights about why these brands match
3. Any relevant meetings or context
4. Contact information available
5. Production context if mentioned

Return ONLY valid JSON, no other text.`;
    
    // Call Claude API for data organization
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1500,
        temperature: 0.3, // Lower temperature for data organization
        messages: [
          {
            role: 'user',
            content: dataOrgPrompt
          }
        ]
      })
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('❌ Claude API error:', response.status, errorData);
      
      if (response.status === 429) {
        console.warn('Claude API rate limited, falling back to OpenAI');
        return null;
      }
      
      throw new Error(`Claude API error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✅ Claude data organization complete');
    
    let organizedData = {};
    if (data.content && data.content.length > 0) {
      try {
        organizedData = JSON.parse(data.content[0].text);
      } catch (e) {
        console.error('Failed to parse Claude JSON response, using raw data');
        organizedData = {
          brands: topBrands,
          meetings: meetingData.records,
          productions: hubspotData.productions
        };
      }
    }
    
    // Extract MCP thinking insights
    const mcpThinking = [];
    
    // Add pipeline insights
    mcpThinking.push(`Searched ${airtableData.total} Airtable + ${hubspotData.brands.length} HubSpot brands → ${topBrands.length} matches`);
    
    // Show top brands from scoring
    if (topBrands.length > 0 && scores) {
      const topThree = topBrands
        .slice(0, 3)
        .map(b => `${b.name} (${b.relevanceScore})`)
        .filter(Boolean);
      mcpThinking.push(`Top matches: ${topThree.join(', ')}`);
    }
    
    // Analyze brand characteristics
    const partneredBrands = topBrands.filter(b => b.hasPartner);
    if (partneredBrands.length > 0) {
      mcpThinking.push(`${partneredBrands.length} brands with agency partners (easier outreach)`);
    }
    
    // Recent activity
    const recentBrands = topBrands.filter(b => {
      if (!b.lastActivity) return false;
      const daysSince = Math.floor((Date.now() - new Date(b.lastActivity)) / (1000 * 60 * 60 * 24));
      return daysSince < 30;
    });
    if (recentBrands.length > 0) {
      mcpThinking.push(`${recentBrands.length} brands active in last 30 days`);
    }
    
    // Return the organized data for OpenAI to format
return {
      organizedData: {
        topBrands: topBrands,
        meetings: meetingData.records,
        productions: hubspotData.productions,
        firefliesTranscripts: firefliesData.transcripts || [],
        o365Emails: o365Data || [],  // ADD THIS
        claudeSummary: organizedData,
        currentProduction: currentProduction
      },
      mcpThinking,
      usedMCP: true
    };
    
  } catch (error) {
    console.error('❌ Error in Claude MCP search:', error);
    console.error('Error details:', error.stack);
    return null;
  }
}

// Generate a video from text using Runway AI's SDK
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

  console.log('🎬 Starting Runway video generation...');

  try {
    const client = new RunwayML({
      apiKey: runwayApiKey
    });

    let imageToUse = promptImage;
    
    if (!imageToUse || imageToUse.includes('dummyimage.com')) {
      console.log('📸 Using default cinematic image for video generation...');
      imageToUse = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1280&h=720&fit=crop&q=80';
    }

    console.log('🎥 Creating video...');
    const videoTask = await client.imageToVideo.create({
      model: model,
      promptImage: imageToUse,
      promptText: promptText,
      ratio: ratio,
      duration: duration
    });

    console.log('✅ Video task created:', videoTask.id);

    // Poll for completion
    console.log('⏳ Waiting for video generation...');
    let task = videoTask;
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      task = await client.tasks.retrieve(task.id);
      console.log(`🔄 Status: ${task.status} (${attempts + 1}/60)`);

      if (task.status === 'SUCCEEDED') {
        console.log('✅ Video ready!');
        
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
        console.error('Task failed:', task);
        throw new Error(`Generation failed: ${task.failure || task.error || 'Unknown error'}`);
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;
    }

    throw new Error('Video generation timed out');

  } catch (error) {
    console.error('Runway Error Details:', {
      message: error.message,
      status: error.status,
      error: error.error
    });
    
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

// Add the Veo3 video generation function
async function generateVeo3Video({
  promptText,
  aspectRatio = '16:9',
  duration = 5
}) {
  if (!googleGeminiApiKey) {
    throw new Error('GOOGLE_GEMINI_API_KEY not configured');
  }

  console.log('🎬 Starting Veo3 video generation...');
  console.log('Using Google Gemini API key:', googleGeminiApiKey.substring(0, 10) + '...');

  try {
    // Make direct API call to Google's endpoint
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-preview:generateVideo?key=${googleGeminiApiKey}`;
    
    console.log('🎥 Creating video with Veo3...');
    console.log('Request details:', { promptText, aspectRatio });
    
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
      console.error('Veo3 API error:', response.status, errorText);
      
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
    console.log('✅ Video task created:', operation);

    // If the API returns the operation name, we need to poll for completion
    if (operation.name) {
      console.log('⏳ Waiting for video generation...');
      let attempts = 0;
      const maxAttempts = 60; // 10 minutes max wait time
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
        
        // Poll the operation status
        const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${operation.name}?key=${googleGeminiApiKey}`;
        const statusResponse = await fetch(statusUrl);
        
        if (!statusResponse.ok) {
          console.error('Failed to check operation status:', statusResponse.status);
          throw new Error('Failed to check video generation status');
        }
        
        const statusData = await statusResponse.json();
        console.log(`🔄 Status check ${attempts + 1}/${maxAttempts}:`, statusData.done ? 'COMPLETED' : 'PROCESSING');
        
        if (statusData.done) {
          if (statusData.error) {
            throw new Error(`Video generation failed: ${statusData.error.message}`);
          }
          
          // Get the video URL from the response
          const videoUrl = statusData.response?.video?.uri || statusData.response?.videoUrl;
          if (!videoUrl) {
            console.error('No video URL in response:', statusData);
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
      // If the API returns the video directly (unlikely for video generation)
      const videoUrl = operation.video?.uri || operation.videoUrl;
      if (!videoUrl) {
        console.error('No video URL in response:', operation);
        throw new Error('No video URL in response');
      }
      
      return {
        url: videoUrl,
        taskId: 'direct-response',
        metadata: operation
      };
    }

  } catch (error) {
    console.error('Veo3 Error Details:', {
      message: error.message,
      status: error.status,
      error: error.error,
      stack: error.stack
    });
    
    // For now, return a friendly error message
    throw new Error(`Veo3 is currently in preview and may not be available. ${error.message}`);
  }
}

// Intelligent query classification using AI
async function shouldUseSearch(userMessage, conversationContext) {
  if (!openAIApiKey) return false;
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAIApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{
          role: 'system',
          content: 'You are a query classifier. Determine if this query needs to search databases (Airtable/HubSpot/Fireflies). Return ONLY "true" or "false".'
        }, {
          role: 'user',
          content: `Query: "${userMessage}"\n\nDoes this query need to search for: brands, companies, meetings, transcripts, productions, partnerships, contacts, discussions, or any business data? Consider context clues like dates, names, projects.`
        }],
        temperature: 0,
        max_tokens: 10
      }),
    });
    
    const data = await response.json();
    const result = data.choices[0].message.content.toLowerCase().trim();
    console.log(`🤖 AI classified query "${userMessage.slice(0,50)}..." as needing search: ${result}`);
    return result === 'true';
    
  } catch (error) {
    console.error('Error classifying query:', error);
    // Fallback to keyword detection
    return userMessage.toLowerCase().match(/(brand|meeting|transcript|discuss|call|conversation|fireflies|hubspot|deal|production|partner|contact|yesterday|today|last|recent)/);
  }
}

export default async function handler(req, res) {
  // Set CORS headers early
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method === 'POST') {
    try {
      // Check if this is an audio generation request
      if (req.body.generateAudio === true) {
        console.log('Processing audio generation request');
        
        const { prompt, projectId, sessionId } = req.body;
        if (!prompt) {
          return res.status(400).json({ 
            error: 'Missing required fields',
            details: 'prompt is required'
          });
        }
        if (!elevenLabsApiKey) {
          console.error('ElevenLabs API key not configured');
          return res.status(500).json({ 
            error: 'Audio generation service not configured',
            details: 'Please configure ELEVENLABS_API_KEY'
          });
        }
        const projectConfig = getProjectConfig(projectId);
        const { voiceId, voiceSettings } = projectConfig;
        console.log('Generating audio for project:', projectId, 'using voice:', voiceId);
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
                console.error('ElevenLabs API error:', elevenLabsResponse.status, errorText);
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
            console.error('Error in audio generation:', error);
            return res.status(500).json({ 
                error: 'Failed to generate audio',
                details: error.message 
            });
        }
      }

      // Check if this is a video generation request
      if (req.body.generateVideo === true) {
        console.log('Processing video generation request');
        
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
            // Use Veo3 for video generation
            if (!googleGeminiApiKey) {
              console.error('Google Gemini API key not configured');
              return res.status(500).json({ 
                error: 'Veo3 video generation service not configured',
                details: 'Please configure GOOGLE_GEMINI_API_KEY in environment variables'
              });
            }
            
            // Convert ratio format from Runway to Veo3 format
            let veo3AspectRatio = '16:9'; // default
            if (ratio === '1104:832') veo3AspectRatio = '4:3';
            else if (ratio === '832:1104') veo3AspectRatio = '9:16';
            else if (ratio === '1920:1080') veo3AspectRatio = '16:9';
            
            result = await generateVeo3Video({
              promptText,
              aspectRatio: veo3AspectRatio,
              duration
            });
            
          } else {
            // Use Runway for video generation (default)
            if (!runwayApiKey) {
              console.error('Runway API key not configured');
              return res.status(500).json({ 
                error: 'Runway video generation service not configured',
                details: 'Please configure RUNWAY_API_KEY in environment variables'
              });
            }
            
            // For Runway, validate promptImage
            if (promptImage && !promptImage.startsWith('http') && !promptImage.startsWith('data:')) {
              return res.status(400).json({
                error: 'Invalid image format',
                details: 'promptImage must be a valid URL or base64 data URL'
              });
            }
            
            let imageToUse = promptImage;
            if (!promptImage || promptImage.includes('dummyimage.com')) {
              console.log('⚠️ Using default image for Runway');
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

          console.log(`✅ Video generated successfully with ${videoModel || 'runway'}:`, result.taskId);

          return res.status(200).json({
            success: true,
            videoUrl: result.url,
            taskId: result.taskId,
            model: videoModel || 'runway',
            metadata: result.metadata
          });

        } catch (error) {
          console.error('Error in video generation:', error);
          return res.status(500).json({ 
            error: 'Failed to generate video',
            details: error.message 
          });
        }
      }

// Add this after the video generation check (around line 845)
// Check if this is an image generation request
if (req.body.generateImage === true) {
  console.log('Processing image generation request');
  
  const { prompt, projectId, sessionId, imageModel, dimensions } = req.body;

  if (!prompt) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      details: 'prompt is required'
    });
  }

if (!openAIApiKey) {
  console.error('OpenAI API key not configured');
  return res.status(500).json({ 
    error: 'Image generation service not configured',
    details: 'Please configure OPENAI_API_KEY'
  });
}

try {
  console.log('🎨 Generating image with prompt:', prompt.slice(0, 100) + '...');
  
  // Always use gpt-image-1
  const model = 'gpt-image-1';
  console.log('Using model:', model);
  
  // Build request body
  const requestBody = {
    model: model,
    prompt: prompt,
    n: 1
  };
  
  // Set size based on dimensions parameter from frontend
// Set size based on dimensions parameter from frontend
  if (dimensions) {
    // Use the dimensions passed from frontend
    requestBody.size = dimensions;
    console.log('Using dimensions from frontend:', dimensions);
  } else {
    // Default to landscape if no dimensions specified
    requestBody.size = '1536x1024';
    console.log('Using default landscape dimensions');
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
      console.error('OpenAI Image API error:', imageResponse.status, errorData);
      
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
          // If parsing fails, use raw error data
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
    console.log('✅ Image generation response received');

    // Check for different possible response structures
    let imageUrl = null;
    
    // Standard structure: data.data[0].url or data.data[0].b64_json
    if (data.data && data.data.length > 0) {
      if (data.data[0].url) {
        imageUrl = data.data[0].url;
      } else if (data.data[0].b64_json) {
        // Convert base64 to data URL
        const base64Image = data.data[0].b64_json;
        imageUrl = `data:image/png;base64,${base64Image}`;
        console.log('Converted base64 to data URL');
      }
    }
    // Alternative structure: data.url
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
      console.error('Unexpected response structure:', data);
      throw new Error('No image URL found in response');
    }
    
  } catch (error) {
    console.error('Error in image generation:', error);
    return res.status(500).json({ 
      error: 'Failed to generate image',
      details: error.message 
    });
  }
}
      // Handle regular chat messages
      let { userMessage, sessionId, audioData, projectId } = req.body;

      if (userMessage && userMessage.length > 5000) {
        userMessage = userMessage.slice(0, 5000) + "…";
      }

      console.log('📨 Received chat request:', { 
        userMessage: userMessage ? userMessage.slice(0, 100) + '...' : null, 
        sessionId, 
        projectId
      });

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
      }
      if (!userMessage && !audioData) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Get project configuration
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

      // Fetch knowledge base
      let knowledgeBaseInstructions = '';
      try {
        console.log('📚 Fetching knowledge base from:', knowledgeBaseUrl);
        const kbResponse = await fetch(knowledgeBaseUrl, { headers: headersAirtable });
        if (kbResponse.ok) {
          const knowledgeBaseData = await kbResponse.json();
          const knowledgeEntries = knowledgeBaseData.records.map(record => record.fields.Summary).join('\n\n');
          knowledgeBaseInstructions = knowledgeEntries;
          console.log('✅ Knowledge base loaded:', knowledgeBaseInstructions.slice(0, 200) + '...');
        } else {
          console.warn('⚠️ Knowledge base not found, using default');
        }
      } catch (error) {
        console.error(`❌ Error fetching knowledge base:`, error);
      }

      // Fetch conversation history
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
        console.error(`Error fetching conversation history:`, error);
      }

// Intelligent search query detection
      const shouldSearchDatabases = await shouldUseSearch(userMessage, conversationContext);
      
      console.log('🔍 Search detection:', { shouldSearchDatabases, userMessage: userMessage?.slice(0, 50) });
      
      console.log('🔍 Brand matching detection:', { shouldSearchDatabases, userMessage: userMessage?.slice(0, 50) });

      // Process audio or text
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

          // Build system message
          let systemMessageContent = knowledgeBaseInstructions || "You are a helpful assistant specialized in AI & Automation.";
          if (conversationContext) {
            systemMessageContent += `\n\nConversation history: ${conversationContext}`;
          }
          systemMessageContent += `\n\nCurrent time in PDT: ${getCurrentTimeInPDT()}.`;
          if (projectId && projectId !== 'default') {
            systemMessageContent += ` You are assisting with the ${projectId} project.`;
          }

          openaiWs.on('open', () => {
            console.log('Connected to OpenAI Realtime API');
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
            console.log('OpenAI WebSocket message:', event);
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
            console.error('OpenAI WebSocket error:', error);
            res.status(500).json({ error: 'Failed to communicate with OpenAI' });
          });
          
        } catch (error) {
          console.error('Error processing audio data:', error);
          res.status(500).json({ error: 'Error processing audio data.', details: error.message });
        }
      } else if (userMessage) {
        try {
          let aiReply = '';
          let mcpThinking = [];
          let usedMCP = false;

          // Try Claude MCP for data gathering on brand matching queries
          let claudeOrganizedData = null;
          if (shouldSearchDatabases && anthropicApiKey) {
            console.log('🎯 Brand matching query detected - attempting Claude MCP data gathering...');
            console.log('🔑 API keys:', {
              anthropic: anthropicApiKey ? 'Present' : 'MISSING!',
              hubspot: hubspotApiKey ? 'Present' : 'MISSING!',
              microsoft: microsoftClientId ? 'Present' : 'MISSING!'
            });
            
            const claudeResult = await handleClaudeSearch(
              userMessage, 
              knowledgeBaseInstructions, 
              projectId, 
              sessionId,
              conversationContext  // Pass conversation context
            );
            
            if (claudeResult) {
              claudeOrganizedData = claudeResult.organizedData;
              mcpThinking = claudeResult.mcpThinking;
              usedMCP = true;
              console.log('✅ Claude MCP successfully gathered and organized data');
              console.log('🧠 MCP Thinking:', mcpThinking);
            } else {
              console.log('⚠️ Claude MCP failed or returned null, using standard OpenAI');
            }
          } else {
           if (!shouldSearchDatabases) {
              console.log('❌ AI determined no search needed - using standard OpenAI');
            }
            if (!anthropicApiKey) {
              console.log('❌ No Anthropic API key - using standard OpenAI');
            }
          }
          
          // Use OpenAI to generate the final response
          if (!aiReply) {
            console.log('📝 Using OpenAI for response generation');
            
            // Build enhanced system message with Claude's organized data
            let systemMessageContent = knowledgeBaseInstructions || "You are a helpful assistant specialized in AI & Automation.";
            
            // Add Claude's organized data if available
            if (claudeOrganizedData) {
              systemMessageContent += "\n\n**INTELLIGENT SEARCH RESULTS FROM YOUR DATABASE:**\n";
              
              // Add production context if available
              if (claudeOrganizedData.currentProduction) {
                systemMessageContent += `\n**CURRENT PRODUCTION CONTEXT: ${claudeOrganizedData.currentProduction}**\n`;
                systemMessageContent += "The user is asking about brand partnerships for this specific production.\n";
              }
              
              if (claudeOrganizedData.topBrands && claudeOrganizedData.topBrands.length > 0) {
                systemMessageContent += "\n**TOP MATCHED BRANDS:**\n";
                claudeOrganizedData.topBrands.slice(0, 10).forEach((brand, index) => {
                  systemMessageContent += `${index + 1}. ${brand.name}\n`;
                  systemMessageContent += `   - Relevance Score: ${brand.relevanceScore}/100\n`;
                  systemMessageContent += `   - Budget: ${brand.budget}\n`;
                  systemMessageContent += `   - Category: ${brand.category}\n`;
                  if (brand.hasPartner) {
                    systemMessageContent += `   - Partner Agency: ${brand.partnerAgency}\n`;
                  }
                  if (brand.primaryContact) {
                    systemMessageContent += `   - Primary Contact: ${brand.primaryContact}\n`;
                  }
                  systemMessageContent += `   - Last Activity: ${brand.lastActivity || 'Unknown'}\n`;
                  systemMessageContent += `   - Summary: ${brand.summary}\n\n`;
                });
              }
              
              if (claudeOrganizedData.meetings && claudeOrganizedData.meetings.length > 0) {
                systemMessageContent += "\n**RELEVANT MEETINGS:**\n";
                claudeOrganizedData.meetings.slice(0, 10).forEach(meeting => {
                  systemMessageContent += `- ${meeting.fields['Title'] || 'Untitled'} (${meeting.fields['Date'] || 'No date'})\n`;
                  if (meeting.fields['Link']) {
                    systemMessageContent += `  Meeting: ${meeting.fields['Title']} Link: ${meeting.fields['Link']}\n`;
                  }
                  if (meeting.fields['Summary']) {
                    systemMessageContent += `  Summary: ${meeting.fields['Summary'].slice(0, 200)}...\n`;
                  }
                  systemMessageContent += "\n";
                });
              }

              if (claudeOrganizedData.firefliesTranscripts && claudeOrganizedData.firefliesTranscripts.length > 0) {
        systemMessageContent += "\n**FIREFLIES MEETING TRANSCRIPTS:**\n";
        claudeOrganizedData.firefliesTranscripts.slice(0, 5).forEach(transcript => {
          systemMessageContent += `- ${transcript.title} (${transcript.date})\n`;
          systemMessageContent += `  Participants: ${transcript.participants?.join(', ') || 'Unknown'}\n`;
         if (transcript.summary?.overview) {
            systemMessageContent += `  Summary: ${transcript.summary.overview.slice(0, 200)}...\n`;
          }
          if (transcript.summary?.action_items) {
            if (Array.isArray(transcript.summary.action_items) && transcript.summary.action_items.length > 0) {
              systemMessageContent += `  Action Items: ${transcript.summary.action_items.slice(0, 3).join('; ')}\n`;
            } else if (typeof transcript.summary.action_items === 'string') {
              systemMessageContent += `  Action Items: ${transcript.summary.action_items}\n`;
            }
          }
          systemMessageContent += "\n";
        });
      }
              
              if (claudeOrganizedData.o365Emails && claudeOrganizedData.o365Emails.length > 0) {
                systemMessageContent += "\n**RECENT EMAIL COMMUNICATIONS:**\n";
                claudeOrganizedData.o365Emails.slice(0, 10).forEach(email => {
                  systemMessageContent += `- ${email.subject} (${new Date(email.receivedDate).toLocaleDateString()})\n`;
                  systemMessageContent += `  From: ${email.fromName || email.from}\n`;
                  if (email.preview) {
                    systemMessageContent += `  Preview: ${email.preview.slice(0, 150)}...\n`;
                  }
                  systemMessageContent += "\n";
                });
              }
              
              if (claudeOrganizedData.claudeSummary) {
                systemMessageContent += "\n**ANALYSIS INSIGHTS:**\n";
                systemMessageContent += JSON.stringify(claudeOrganizedData.claudeSummary, null, 2);
                systemMessageContent += "\n";
              }
              
              systemMessageContent += "\n**INSTRUCTIONS:**\n";
              systemMessageContent += "- Use the above data to provide specific brand recommendations\n";
              systemMessageContent += "- Include meeting references with their links in the format: Meeting: [Title] Link: [URL]\n";
              systemMessageContent += "- Prioritize brands with partners and recent activity\n";
              systemMessageContent += "- Suggest integration ideas for each brand\n";
            }
            
            if (conversationContext) {
              systemMessageContent += `\n\nConversation history: ${conversationContext}`;
            }
            systemMessageContent += `\n\nCurrent time in PDT: ${getCurrentTimeInPDT()}.`;
            if (projectId && projectId !== 'default') {
              systemMessageContent += ` You are assisting with the ${projectId} project.`;
            }
            
            const openAIResponse = await getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent);
            aiReply = openAIResponse;
          }
          
          if (aiReply) {
            updateAirtableConversation(
              sessionId, 
              projectId, 
              chatUrl, 
              headersAirtable, 
              `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`, 
              existingRecordId
            ).catch(err => console.error('Airtable update error:', err));
            
            return res.json({ 
              reply: aiReply,
              mcpThinking: mcpThinking.length > 0 ? mcpThinking : null,
              usedMCP: usedMCP
            });
          } else {
            return res.status(500).json({ error: 'No text reply received.' });
          }
        } catch (error) {
          console.error('Error fetching response:', error);
          return res.status(500).json({ error: 'Error fetching response.', details: error.message });
        }
      }
    } catch (error) {
      console.error('Error in handler:', error);
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  } else {
    res.setHeader("Allow", ["POST", "OPTIONS"]);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
}

async function getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent) {
  try {
    const messages = [
      { role: 'system', content: systemMessageContent },
      { role: 'user', content: userMessage }
    ];
    
    const totalLength = systemMessageContent.length + userMessage.length;
    console.log(`Total message length: ${totalLength} characters`);
    
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
      console.error('OpenAI API error:', response.status, errorData);
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('OpenAI response received');
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content;
    } else {
      console.error('No valid choices in OpenAI response.');
      return null;
    }
  } catch (error) {
    console.error('Error in getTextResponseFromOpenAI:', error);
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
      console.log(`Updated conversation for project: ${projectId}, session: ${sessionId}`);
    } else {
      await fetch(chatUrl, {
        method: 'POST',
        headers: headersAirtable,
        body: JSON.stringify(recordData),
      });
      console.log(`Created new conversation for project: ${projectId}, session: ${sessionId}`);
    }
  } catch (error) {
    console.error('Error updating Airtable conversation:', error);
  }
}
