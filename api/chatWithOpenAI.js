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
  portalId: '2944980', // Your HubSpot portal ID
  
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
          filterGroups: filters.filterGroups || [
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
            // Essential fields only
            'name',
            'brand_name',
            'brand_category',
            'lifecyclestage',
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
      console.log('🔍 HubSpot searchProductions called (searching Partnership Pipeline)');
      
      // Productions/Partnerships are in Partnership Pipeline (ID: 115484704)
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
                propertyName: 'pipeline', 
                operator: 'EQ',
                value: '115484704' // Partnership Pipeline ID
              }
            ]
          }],
          properties: [
            // Essential partnership fields
            'dealname',
            'partnership_name',  // Production title
            'synopsis',
            'content_type',
            'distributor',
            'brand_name',
            'dealstage',
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
        console.error('❌ HubSpot Productions API error:', response.status, errorBody);
        throw new Error(`HubSpot API error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log(`✅ HubSpot search returned ${data.results?.length || 0} partnerships`);
      
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
        console.error('❌ Failed to get contacts');
        return [];
      }
      
      const associations = await response.json();
      
      // Get first 3 contacts only (main contacts)
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
      console.error('❌ Error getting contacts:', error);
      return [];
    }
  },

  // Add method for finding specific brand information
  async searchSpecificBrand(brandName) {
    try {
      console.log(`🔍 Searching for specific brand: ${brandName}`);
      
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/companies/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: brandName,
          properties: [
            'name',
            'brand_name',
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
      
      // Find exact match if possible
      const exactMatch = data.results?.find(r => 
        r.properties.name?.toLowerCase() === brandName.toLowerCase() ||
        r.properties.brand_name?.toLowerCase() === brandName.toLowerCase()
      );
      
      return exactMatch || data.results?.[0] || null;
    } catch (error) {
      console.error('❌ Error searching specific brand:', error);
      return null;
    }
  },
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
      
      if (!msftClientId || !msftClientSecret || !msftTenantId) {
        console.warn('Microsoft credentials not configured');
        return [];
      }
      
      const accessToken = await this.getAccessToken();
      const userEmail = options.userEmail || 'stacy@hollywoodbranded.com';
      
      // Simple date filter - last 30 days
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 30);
      const dateFilter = fromDate.toISOString();
      
      // Simple search - just look in subject
      let filter = `receivedDateTime ge ${dateFilter}`;
      if (query && query.length > 2) {
        const searchTerm = query.replace(/'/g, "''").slice(0, 50);
        filter += ` and contains(subject,'${searchTerm}')`;
      }
      
      // Get only 5 most recent emails
      const messagesUrl = `https://graph.microsoft.com/v1.0/users/${userEmail}/messages?$filter=${encodeURIComponent(filter)}&$top=5&$select=subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc`;
      
      const response = await fetch(messagesUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        console.error('❌ O365 search failed');
        return [];
      }
      
      const data = await response.json();
      const emails = data.value || [];
      
      console.log(`✅ Found ${emails.length} emails`);
      
      return emails.map(email => ({
        subject: email.subject,
        from: email.from?.emailAddress?.address,
        fromName: email.from?.emailAddress?.name,
        receivedDate: email.receivedDateTime,
        preview: email.bodyPreview?.slice(0, 200)
      }));
      
    } catch (error) {
      console.error('❌ Error searching O365:', error);
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
      
      // Simplified query - only get what we need for brand matching
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
        console.error('❌ Fireflies API error');
        return [];
      }
      
      const data = await response.json();
      console.log(`✅ Fireflies returned ${data.data?.transcripts?.length || 0} transcripts`);
      
      return data.data?.transcripts || [];
    } catch (error) {
      console.error('❌ Error searching Fireflies:', error);
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

// Removed Airtable search - only used for knowledge base and conversation history now

// Airtable search disabled - only returns empty results
async function searchAirtable(query, projectId, searchType = 'auto', limit = 100) {
  console.log('⏭️ Airtable search disabled, returning empty results');
  return { searchType, records: [], total: 0 };
}

// Stage 2: Wrapper function to maintain compatibility
async function narrowWithOpenAI(airtableBrands, hubspotBrands, meetings, firefliesTranscripts, userMessage) {
  try {
    // Only use hubspot brands since airtable is disabled
    const allBrands = [...hubspotBrands];
    // Call the new function with brands, transcripts, and empty emails array
    const result = await narrowWithIntelligentTags(allBrands, firefliesTranscripts || [], [], userMessage);
    // Make sure we return the expected structure
    return {
      topBrands: result.topBrands || [],
      scores: {} // compatibility field
    };
  } catch (error) {
    console.error('Error in narrowWithOpenAI wrapper:', error);
    return { topBrands: [], scores: {} };
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
    
    // Build smart filters for brands
    let brandFilters = {};
    
    if (searchTerm) {
      // Search by query term
      brandFilters = {
        query: searchTerm // This searches across default searchable properties
      };
    } else {
      // Default filters for brands
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

    return {
      brands: brandsData.results || [],
      productions: productionsData.results || []
    };

  } catch (error) {
    console.error('❌ Error searching HubSpot:', error);
    return { brands: [], productions: [] };
  }
}

// Stage 2: Intelligent tag-based brand matching
async function narrowWithIntelligentTags(hubspotBrands, firefliesTranscripts, emails, userMessage) {
  try {
    console.log(`🧮 Stage 2: Intelligent brand matching for ${hubspotBrands.length} brands...`);
    
    // Extract production context intelligently
    const productionContext = extractProductionContext(userMessage);
    console.log('🎬 Production context:', productionContext);
    
    // Process each brand with intelligent tagging
    const taggedBrands = hubspotBrands.map(b => {
      const brand = {
        source: 'hubspot',
        id: b.id, // HubSpot ID for URL construction
        name: b.properties.brand_name || b.properties.name,
        category: b.properties.brand_category || b.properties.industry || 'General',
        budget: b.properties.media_spend_m_ ? `${b.properties.media_spend_m_}M` : 'TBD',
        summary: (b.properties.description || '').slice(0, 100),
        lastActivity: b.properties.notes_last_contacted || b.properties.notes_last_updated || b.properties.hs_lastmodifieddate,
        hasPartner: !!b.properties.partner_agency_name,
        partnerAgency: b.properties.partner_agency_name,
        website: b.properties.domain,
        lifecyclestage: b.properties.lifecyclestage,
        numContacts: b.properties.num_associated_contacts || '0',
        hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI.portalId}/company/${b.id}`, // Direct HubSpot URL
        tags: [],
        relevanceScore: 0,
        reason: ''
      };
      
      // Intelligent tagging based on multiple factors
      const tags = [];
      let score = 0;
      let primaryReason = '';
      
      // Check if brand was mentioned in recent meetings with specific context
      const brandNameLower = brand.name.toLowerCase();
      let meetingMention = null;
      let emailMention = null;
      
      // More flexible search for brand mentions with fuzzy matching
      const mentionedInFireflies = firefliesTranscripts && firefliesTranscripts.some(t => {
        const overview = (t.summary?.overview || '').toLowerCase();
        const title = (t.title || '').toLowerCase();
        const topics = (t.summary?.topics_discussed || '').toLowerCase();
        const keywords = (t.summary?.keywords || []).join(' ').toLowerCase();
        const searchText = `${overview} ${title} ${topics} ${keywords}`;
        
        // Normalize brand name for fuzzy matching
        const normalizedBrandName = brandNameLower.replace(/[''\'s]/g, '').replace(/\s+/g, ' ');
        const brandWords = normalizedBrandName.split(' ').filter(w => w.length > 2);
        
        // Check for exact match first
        if (searchText.includes(brandNameLower)) {
          meetingMention = {
            title: t.title,
            url: t.transcript_url,
            context: overview.slice(0, 150) || `Discussed ${brand.name}`,
            date: t.dateString || t.date,
            actionItems: Array.isArray(t.summary?.action_items) ? t.summary.action_items[0] : null
          };
          return true;
        }
        
        // Fuzzy match - if all significant words are found
        const fuzzyMatch = brandWords.length > 0 && brandWords.every(word => searchText.includes(word));
        if (fuzzyMatch) {
          meetingMention = {
            title: t.title,
            url: t.transcript_url,
            context: overview.slice(0, 150) || `Discussed ${brand.name}`,
            date: t.dateString || t.date,
            actionItems: Array.isArray(t.summary?.action_items) ? t.summary.action_items[0] : null
          };
          return true;
        }
        
        return false;
      });
      
      const mentionedInEmails = emails && emails.some(e => {
        const subject = (e.subject || '').toLowerCase();
        const preview = (e.preview || '').toLowerCase();
        const searchText = `${subject} ${preview}`;
        
        // Look for brand name or partial matches
        const brandWords = brandNameLower.split(' ');
        const found = brandWords.some(word => word.length > 3 && searchText.includes(word));
        
        if (found || searchText.includes(brandNameLower)) {
          // Capture the specific mention
          emailMention = {
            subject: e.subject,
            preview: preview.slice(0, 150),
            from: e.fromName || e.from,
            date: e.receivedDate,
            // O365 doesn't provide direct email links in this API
            webLink: e.webLink || null
          };
          return true;
        }
        return false;
      });
      
      // Tag assignment logic based on lifecycle stage
      if (brand.lifecyclestage === 'customer') {
        tags.push('Hot Lead');
        score += 40;
        primaryReason = 'Existing customer ready to activate';
      } else if (brand.lifecyclestage === 'opportunity') {
        tags.push('Active Opportunity');
        score += 35;
        primaryReason = 'Active opportunity in pipeline';
      } else if (brand.lifecyclestage === 'salesqualifiedlead') {
        tags.push('Qualified Lead');
        score += 25;
        primaryReason = 'Sales qualified lead';
      }
      
      // Recent activity tagging with SPECIFIC context
      if (mentionedInFireflies && meetingMention) {
        tags.push('Recent Meeting');
        score += 30;
        // Make the reason specific
        primaryReason = `Discussed in "${meetingMention.title}" on ${meetingMention.date}`;
        if (meetingMention.actionItems) {
          primaryReason += ` - Action: ${meetingMention.actionItems}`;
        }
        brand.meetingContext = meetingMention;
      }
      
      if (mentionedInEmails && emailMention) {
        tags.push('Email Thread');
        score += 20;
        if (!primaryReason || primaryReason.includes('lead')) {
          primaryReason = `Recent email: "${emailMention.subject}" from ${emailMention.from}`;
        }
        brand.emailContext = emailMention;
      }
      
      if (brand.hasPartner) {
        tags.push('Agency Ready');
        score += 15;
        if (!primaryReason) {
          primaryReason = `Ready with agency partner: ${brand.partnerAgency}`;
        }
      }
      
      // Check budget fit
      if (brand.budget && brand.budget !== 'TBD') {
        const budgetValue = parseFloat(brand.budget.match(/\d+\.?\d*/)?.[0] || 0);
        if (budgetValue > 5) {
          tags.push('Big Budget');
          score += 25;
          if (!primaryReason || primaryReason.includes('lead')) {
            primaryReason = `${brand.budget} media budget available`;
          }
        }
      }
      
      // Genre/category matching with specific context
      if (productionContext.genre && brand.category) {
        const genreMatch = checkGenreMatch(productionContext.genre, brand.category);
        if (genreMatch) {
          tags.push('Genre Match');
          score += 20;
          if (!primaryReason) {
            primaryReason = `Perfect ${productionContext.genre} genre fit - ${brand.category} brand`;
          }
        }
      }
      
      // Recent activity based on last contact date
      if (brand.lastActivity) {
        const lastActivityDate = new Date(brand.lastActivity);
        const daysSinceActivity = (new Date() - lastActivityDate) / (1000 * 60 * 60 * 24);
        
        if (daysSinceActivity < 7) {
          tags.push('This Week');
          score += 20;
          if (!primaryReason || primaryReason.includes('lead')) {
            primaryReason = `Contact this week - momentum is high`;
          }
        } else if (daysSinceActivity < 30) {
          tags.push('Recent Activity');
          score += 10;
        }
      }
      
      // Quick win - brands with multiple contacts (shows engagement)
      const numContacts = parseInt(brand.numContacts) || 0;
      if (numContacts >= 3) {
        tags.push('High Engagement');
        score += 10;
        if (!primaryReason || primaryReason.includes('lead')) {
          primaryReason = `${numContacts} contacts engaged - multiple touchpoints`;
        }
      }
      
      // Default tag if no others apply
      if (tags.length === 0) {
        tags.push('Potential Match');
        score = 5;
        primaryReason = 'Potential brand partner for consideration';
      }
      
      if (brand.hasPartner) {
        tags.push('Agency Ready');
        score += 15;
        if (!primaryReason) primaryReason = `Has agency: ${brand.partnerAgency}`;
      }
      
      // Check budget fit
      if (brand.budget && brand.budget !== 'TBD') {
        const budgetValue = parseFloat(brand.budget.match(/\d+\.?\d*/)?.[0] || 0);
        if (budgetValue > 5) {
          tags.push('Big Budget');
          score += 25;
          if (!primaryReason) primaryReason = `High budget: ${brand.budget}`;
        }
      }
      
      // Genre/category matching
      if (productionContext.genre && brand.category) {
        const genreMatch = checkGenreMatch(productionContext.genre, brand.category);
        if (genreMatch) {
          tags.push('Genre Match');
          score += 20;
          if (!primaryReason) primaryReason = `Perfect fit for ${productionContext.genre}`;
        }
      }
      
      // Recent activity based on last contact date
      if (brand.lastActivity) {
        const lastActivityDate = new Date(brand.lastActivity);
        const daysSinceActivity = (new Date() - lastActivityDate) / (1000 * 60 * 60 * 24);
        
        if (daysSinceActivity < 30) {
          tags.push('Recent Activity');
          score += 15;
          if (!primaryReason) primaryReason = 'Recent contact activity';
        }
      }
      
      // Quick win - brands with multiple contacts (shows engagement)
      const contactCount = parseInt(brand.numContacts) || 0;
      if (contactCount >= 3) {
        tags.push('High Engagement');
        score += 10;
        if (!primaryReason) primaryReason = `${contactCount} contacts engaged`;
      }
      
      // Default tag if no others apply
      if (tags.length === 0) {
        tags.push('Potential Match');
        score = 5;
        primaryReason = 'Potential brand partner';
      }
      
      brand.tags = tags;
      brand.relevanceScore = score;
      brand.reason = primaryReason;
      
      return brand;
    });
    
    // Sort by relevance score and take top 15
    const topBrands = taggedBrands
      .filter(b => b.relevanceScore > 0) // Only include brands with some relevance
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 15);
    
    console.log(`✅ Stage 2 complete: ${topBrands.length} relevant brands identified`);
    if (topBrands.length > 0) {
      console.log(`🏆 Top 3: ${topBrands.slice(0, 3).map(b => `${b.name} (${b.tags.join(', ')})`).join(', ')}`);
    }
    
    return { topBrands, taggedBrands };
    
  } catch (error) {
    console.error('❌ Error in intelligent brand matching:', error);
    return { topBrands: hubspotBrands.slice(0, 15), taggedBrands: [] };
  }
}

// Helper function to extract production context
function extractProductionContext(message) {
  // Add safety check for undefined message
  if (!message || typeof message !== 'string') {
    console.warn('extractProductionContext called with invalid message:', message);
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
  
  // Extract title
  const titleMatch = message.match(/(?:Title|Production|Film|Show|Project):\s*([^\n]+)/i);
  if (titleMatch) context.title = titleMatch[1].trim();
  
  // Extract genre
  const genrePatterns = {
    action: /\b(action|fight|chase|explosion|battle|war|combat)\b/i,
    comedy: /\b(comedy|funny|humor|hilarious|laugh|sitcom)\b/i,
    drama: /\b(drama|emotional|family|relationship)\b/i,
    horror: /\b(horror|scary|terror|thriller)\b/i,
    documentary: /\b(documentary|docu|non-fiction|true story)\b/i,
    sports: /\b(sports|athletic|fitness|game|match|competition)\b/i,
    scifi: /\b(sci-fi|science fiction|future|space|alien)\b/i
  };
  
  for (const [genre, pattern] of Object.entries(genrePatterns)) {
    if (pattern.test(message)) {
      context.genre = genre;
      break;
    }
  }
  
  // Extract budget
  const budgetMatch = message.match(/(?:budget|fee).*?\$(\d+)([MmKk])?/i);
  if (budgetMatch) {
    context.budget = budgetMatch[0];
  }
  
  return context;
}

// Helper function to check genre matching
function checkGenreMatch(productionGenre, brandCategory) {
  const genreMap = {
    sports: ['athletic', 'fitness', 'sports', 'energy', 'nutrition'],
    comedy: ['snack', 'beverage', 'casual', 'youth', 'entertainment'],
    action: ['automotive', 'technology', 'gaming', 'energy', 'extreme'],
    drama: ['fashion', 'beauty', 'lifestyle', 'home', 'family'],
    documentary: ['education', 'health', 'environment', 'social', 'tech']
  };
  
  const relevantCategories = genreMap[productionGenre] || [];
  return relevantCategories.some(cat => 
    brandCategory.toLowerCase().includes(cat)
  );
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
    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
      const keyword = data.choices[0].message.content.trim();
      console.log(`🔍 AI extracted keyword: "${keyword}" from query: "${query}"`);
      return keyword;
    }
    
    console.log('⚠️ No keyword extracted, using empty string');
    return '';
    
  } catch (error) {
    console.error('Error extracting keyword:', error);
    return ''; // Default to no keyword
  }
}

// Stage 3: Claude MCP search that ONLY gathers data (doesn't generate final response)
async function handleClaudeSearch(userMessage, knowledgeBaseInstructions, projectId, sessionId, conversationContext) {
  console.log('🤖 Starting intelligent MCP-style data gathering...');
  
  if (!anthropicApiKey) {
    console.warn('No Anthropic API key found, falling back to OpenAI');
    return null;
  }
  
  // Extract the current production context from conversation history
  let currentProduction = null;
  if (conversationContext) {
    const productionPatterns = [
      /(?:Title|Production|Film|Show):\s*([^\n]+)/i,
      /(?:for|about|regarding)\s+["']?([A-Z][^"'\n]+?)["']?\s*(?:\n|Starting Fee:|Distributor:)/i
    ];
    
    for (const pattern of productionPatterns) {
      const match = conversationContext.match(pattern) || userMessage.match(pattern);
      if (match && match[1]) {
        currentProduction = match[1].trim();
        console.log(`📽️ Detected production: "${currentProduction}"`);
        break;
      }
    }
  }
  
  try {
    const mcpThinking = [];
    
    // Stage 1: Determine search strategy
    console.log('📊 Stage 1: Determining search strategy...');
    
    // Check for explicit slash commands first
    const slashCommand = userMessage.match(/^\/(\w+)\s+(.+)/);
    if (slashCommand) {
      const [_, command, brandName] = slashCommand;
      mcpThinking.push(`🎯 Slash command: /${command} ${brandName}`);
      
      if (command === 'meetings' || command === 'meeting' || command === 'calls' || command === 'call') {
        const firefliesData = await searchFireflies(brandName, { limit: 10 });
        mcpThinking.push(`✅ Found ${firefliesData.transcripts?.length || 0} meetings`);
        
        return {
          organizedData: {
            slashCommand: true,
            commandType: 'meetings',
            brandName: brandName,
            meetings: firefliesData.transcripts || [],
            currentProduction: currentProduction
          },
          mcpThinking,
          usedMCP: true
        };
      }
      
      if (command === 'emails' || command === 'email') {
        const o365Data = await o365API.searchEmails(brandName, { days: 30 });
        mcpThinking.push(`✅ Found ${o365Data?.length || 0} emails`);
        
        return {
          organizedData: {
            slashCommand: true,
            commandType: 'emails',
            brandName: brandName,
            emails: o365Data || [],
            currentProduction: currentProduction
          },
          mcpThinking,
          usedMCP: true
        };
      }
      
      if (command === 'contact' || command === 'contacts') {
        const brand = await hubspotAPI.searchSpecificBrand(brandName);
        if (brand) {
          const contacts = await hubspotAPI.getContactsForCompany(brand.id);
          return {
            organizedData: {
              slashCommand: true,
              commandType: 'contacts',
              brand: brand,
              contacts: contacts,
              brandName: brandName
            },
            mcpThinking,
            usedMCP: true
          };
        }
      }
    }
    
    // Check if this is a specific brand lookup WITH context request
    const brandLookupMatch = userMessage.match(/(?:contact|who is|point of contact|poc|calls?|meetings?|emails?).*?(?:with|for|at|about)\s+([A-Z][^\?\.,]+)/i);
    if (brandLookupMatch) {
      const brandName = brandLookupMatch[1].trim();
      mcpThinking.push(`🔍 Looking up ${brandName} with recent activity...`);
      
      // Search for the brand AND its recent context
      const [brand, firefliesData, o365Data] = await Promise.all([
        hubspotAPI.searchSpecificBrand(brandName),
        firefliesApiKey ? searchFireflies(brandName, { limit: 5 }) : { transcripts: [] },
        msftClientId ? o365API.searchEmails(brandName, { days: 30 }) : []
      ]);
      
      if (brand) {
        mcpThinking.push('✅ Found brand in HubSpot');
        const contacts = await hubspotAPI.getContactsForCompany(brand.id);
        
        // Find specific mentions in meetings
        const brandMeetings = firefliesData.transcripts?.filter(t => {
          const searchText = `${t.title} ${t.summary?.overview || ''} ${t.summary?.topics_discussed || ''}`.toLowerCase();
          return searchText.includes(brandName.toLowerCase());
        }) || [];
        
        // Find specific mentions in emails
        const brandEmails = o365Data?.filter(e => {
          const searchText = `${e.subject} ${e.preview || ''}`.toLowerCase();
          return searchText.includes(brandName.toLowerCase());
        }) || [];
        
        if (brandMeetings.length > 0) {
          mcpThinking.push(`✅ Found ${brandMeetings.length} recent meetings`);
        }
        if (brandEmails.length > 0) {
          mcpThinking.push(`✅ Found ${brandEmails.length} recent emails`);
        }
        
        return {
          organizedData: {
            specificBrandWithContext: true,
            brand: brand,
            contacts: contacts,
            recentMeetings: brandMeetings,
            recentEmails: brandEmails,
            brandName: brandName
          },
          mcpThinking,
          usedMCP: true
        };
      }
    }
    
    // Check if asking for meeting/email context with intelligent patterns
    const contextPatterns = [
      /(?:meetings?|calls?|discussions?).*?(?:with|about|regarding)?\s*(?:brands?|partners?|companies)/i,
      /(?:valuable|important|key|recent|latest).*?(?:meetings?|calls?|emails?)/i,
      /(?:what|which|show|list).*?(?:meetings?|calls?|emails?).*?(?:this month|last month|recent)/i,
      /(?:meetings?|emails?|calls?).*?(?:this month|last month|this week|recently)/i,
      /(?:any|all|show).*?(?:meetings?|emails?|activity).*?(?:with|from|about)/i
    ];
    
    const isContextQuery = contextPatterns.some(pattern => pattern.test(userMessage));
    
    if (isContextQuery) {
      mcpThinking.push('📊 Analyzing meeting and email activity...');
      
      // Determine time frame from query
      let daysToSearch = 30; // default
      if (userMessage.includes('this week')) daysToSearch = 7;
      if (userMessage.includes('today')) daysToSearch = 1;
      if (userMessage.includes('this month')) {
        const now = new Date();
        daysToSearch = now.getDate(); // Days elapsed this month
      }
      
      // Search for all meetings and emails
      const [firefliesData, o365Data] = await Promise.all([
        firefliesApiKey ? searchFireflies('', { 
          limit: 20, 
          fromDate: new Date(Date.now() - daysToSearch * 24 * 60 * 60 * 1000).toISOString()
        }) : { transcripts: [] },
        msftClientId ? o365API.searchEmails('', { days: daysToSearch }) : []
      ]);
      
      // Analyze meetings for brand mentions and value indicators
      const valuableMeetings = firefliesData.transcripts?.map(meeting => {
        // Look for brand mentions
        const overview = (meeting.summary?.overview || '').toLowerCase();
        const topics = (meeting.summary?.topics_discussed || '').toLowerCase();
        
        // Value indicators
        const hasActionItems = meeting.summary?.action_items?.length > 0;
        const hasBudgetDiscussion = overview.includes('budget') || overview.includes('spend') || overview.includes('investment');
        const hasDecisionMaker = meeting.participants?.some(p => 
          p.toLowerCase().includes('ceo') || 
          p.toLowerCase().includes('vp') || 
          p.toLowerCase().includes('director')
        );
        
        // Calculate value score
        let valueScore = 0;
        if (hasActionItems) valueScore += 30;
        if (hasBudgetDiscussion) valueScore += 40;
        if (hasDecisionMaker) valueScore += 30;
        if (overview.includes('partnership') || overview.includes('integration')) valueScore += 20;
        
        return {
          ...meeting,
          valueScore,
          valueIndicators: {
            hasActionItems,
            hasBudgetDiscussion,
            hasDecisionMaker
          }
        };
      }).sort((a, b) => b.valueScore - a.valueScore) || [];
      
      if (valuableMeetings.length > 0) {
        mcpThinking.push(`✅ Found ${valuableMeetings.length} meetings this month`);
        mcpThinking.push(`🏆 Identified ${valuableMeetings.filter(m => m.valueScore > 50).length} high-value meetings`);
      }
      
      return {
        organizedData: {
          contextAnalysis: true,
          queryType: userMessage.includes('valuable') ? 'valuable_meetings' : 'all_activity',
          valuableMeetings: valuableMeetings.slice(0, 10),
          emails: o365Data || [],
          timeFrame: `Last ${daysToSearch} days`,
          currentProduction: currentProduction
        },
        mcpThinking,
        usedMCP: true
      };
    }
    
    // Default: Brand matching query
    mcpThinking.push('🔍 Starting brand partnership search...');
    
    // Extract search parameters
    const productionContext = extractProductionContext(userMessage + ' ' + (conversationContext || ''));
    
    if (productionContext.genre) {
      mcpThinking.push(`🎯 Focusing on ${productionContext.genre} genre`);
    }
    
    // Parallel searches - limit results to manage AI context
    const [hubspotData, firefliesData, o365Data] = await Promise.all([
      hubspotApiKey ? searchHubSpot(userMessage, projectId, 30) : { brands: [], productions: [] },
      firefliesApiKey ? searchFireflies(
        // Search for production OR genre OR just general partnership discussions
        currentProduction || productionContext.genre || 'partnership brand integration', 
        { limit: 10 } // Get more meetings to find brand mentions
      ) : { transcripts: [] },
      msftClientId ? o365API.searchEmails(
        currentProduction || productionContext.genre || 'brand', 
        { days: 30 }
      ) : []
    ]);
    
    // Update status
    if (hubspotData.brands?.length > 0) {
      mcpThinking.push(`✅ Found ${hubspotData.brands.length} brands in HubSpot`);
    }
    if (firefliesData.transcripts?.length > 0) {
      mcpThinking.push(`✅ Found ${firefliesData.transcripts.length} meeting transcripts`);
    }
    if (o365Data?.length > 0) {
      mcpThinking.push(`✅ Found ${o365Data.length} email threads`);
    }
    
    // Stage 2: Intelligent narrowing with tags
    mcpThinking.push('🧠 Analyzing brand relevance...');
    
    const { topBrands } = await narrowWithIntelligentTags(
      hubspotData.brands || [],
      firefliesData.transcripts || [],
      o365Data || [],
      userMessage
    );
    
    // Create dropdown data with enhanced context
    const brandSuggestions = topBrands.slice(0, 10).map(brand => ({
      id: brand.id,
      name: brand.name,
      score: brand.relevanceScore,
      tag: brand.tags[0] || 'Potential Match',
      tags: brand.tags, // All tags for display
      reason: brand.reason,
      budget: brand.budget,
      hasAgency: brand.hasPartner,
      agencyName: brand.partnerAgency,
      hubspotUrl: brand.hubspotUrl,
      meetingUrl: brand.meetingContext?.url || null,
      meetingTitle: brand.meetingContext?.title || null,
      emailSubject: brand.emailContext?.subject || null
    }));
    
    mcpThinking.push(`✨ Prepared ${brandSuggestions.length} recommendations`);
    
    return {
      organizedData: {
        topBrands: topBrands.slice(0, 10), // Limit to 10 for AI context
        brandSuggestions: brandSuggestions,
        firefliesTranscripts: firefliesData.transcripts?.slice(0, 3) || [], // Only top 3
        o365Emails: o365Data?.slice(0, 3) || [], // Only top 3
        currentProduction: currentProduction,
        productionContext: productionContext
      },
      mcpThinking,
      usedMCP: true
    };
    
  } catch (error) {
    console.error('❌ Error in MCP search:', error);
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
