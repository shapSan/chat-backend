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
    // Check if the conversation context contains production details
    const contextClues = conversationContext ? conversationContext.toLowerCase() : '';
    const messageClues = userMessage.toLowerCase();
    
    // Quick check for production-related patterns
    if (contextClues.includes('synopsis:') || 
        contextClues.includes('distributor:') || 
        contextClues.includes('cast:') ||
        contextClues.includes('starting fee:') ||
        messageClues.includes('brand') ||
        messageClues.includes('integration') ||
        messageClues.includes('partnership')) {
      console.log('🎬 Production context detected - search needed');
      return true;
    }
    
    // Check if message contains production info (title + synopsis pattern)
    if (messageClues.includes('synopsis:') || 
        (userMessage.includes('\n') && messageClues.includes('follows') && messageClues.includes('con'))) {
      console.log('🎬 Production synopsis detected - search needed for brand matching');
      return true;
    }
    
    // Always search for context queries
    if (messageClues.includes('email') || 
        messageClues.includes('meeting') || 
        messageClues.includes('discussed') ||
        messageClues.includes('context') ||
        messageClues.includes('insights') ||
        messageClues.includes('low hanging fruit')) {
      console.log('📧 Context query detected - search needed');
      return true;
    }
    
    // For very short messages that might just be a title, use AI
    if (userMessage.length > 100 || userMessage.split('\n').length > 1) {
      // Likely a production description
      console.log('📝 Long message detected - likely production info');
      return true;
    }
    
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
          content: 'You are a query classifier. Determine if this query needs to search databases (Airtable/HubSpot/Fireflies/Emails). Return ONLY "true" or "false".'
        }, {
          role: 'user',
          content: `Query: "${userMessage}"\nContext: "${contextClues.slice(-500)}"\n\nDoes this query need to search for: brands, companies, meetings, transcripts, productions, partnerships, contacts, discussions, emails, or any business data? Also return true if there's a production/film/show mentioned in the context that might need brand partnerships. Return true if this appears to be a production title with synopsis.`
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
    // Fallback to keyword detection - UPDATED to include more patterns
    return userMessage.toLowerCase().match(/(brand|meeting|transcript|discuss|call|conversation|fireflies|hubspot|deal|production|partner|contact|yesterday|today|last|recent|email|inbox|message|integration|partnership|insights|context|synopsis:|title:|film|show|series)/) ||
           conversationContext?.toLowerCase().match(/(synopsis:|distributor:|cast:|starting fee:|production|film|show)/);
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
  
  // Check if client wants streaming - safely check req.body
  const wantsStream = req.headers.accept === 'text/event-stream' || (req.body && req.body.stream === true);
  
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
      
      // Initialize MCP raw output for frontend with timestamps
      let mcpRawOutput = [];
      let mcpStartTime = Date.now();
      
      if (shouldSearchDatabases) {
        mcpRawOutput.push({
          text: '🎬 Production context detected - search needed',
          timestamp: Date.now() - mcpStartTime
        });
      }
      
      console.log('🔍 Search detection:', { 
        shouldSearchDatabases, 
        userMessage: userMessage?.slice(0, 50),
        hasO365: !!msftClientId,
        hasHubSpot: !!hubspotApiKey,
        hasFireflies: !!firefliesApiKey
      });
      
      if (shouldSearchDatabases) {
        mcpRawOutput.push({
          text: `🔍 Brand matching detection: ${shouldSearchDatabases ? 'YES' : 'NO'}`,
          timestamp: Date.now() - mcpStartTime
        });
      }
      
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
              microsoft: msftClientId ? 'Present' : 'MISSING!'
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
              mcpThinking = claudeResult.mcpThinking || [];
              
              // Add MCP thinking steps with timestamps for live feeling
              if (claudeResult.mcpThinking && Array.isArray(claudeResult.mcpThinking)) {
                claudeResult.mcpThinking.forEach((step, index) => {
                  mcpRawOutput.push({
                    text: step,
                    timestamp: Date.now() - mcpStartTime + (index * 200) // 200ms between steps for natural pacing
                  });
                });
              }
              
              usedMCP = true;
              console.log('✅ Claude MCP successfully gathered and organized data');
              mcpRawOutput.push({
                text: '✅ Claude MCP successfully gathered and organized data',
                timestamp: Date.now() - mcpStartTime
              });
            } else {
              console.log('⚠️ Claude MCP failed or returned null, using standard OpenAI');
              mcpRawOutput.push({
                text: '⚠️ Claude MCP failed - using standard OpenAI',
                timestamp: Date.now() - mcpStartTime
              });
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
            mcpRawOutput.push({
              text: '📝 Using OpenAI for response generation',
              timestamp: Date.now() - mcpStartTime
            });
            
            // Build enhanced system message with Claude's organized data
            let systemMessageContent = knowledgeBaseInstructions || "You are a helpful assistant specialized in AI & Automation.";
            
            // Add Claude's organized data if available
            if (claudeOrganizedData) {
              // Handle different query intents naturally
              if (claudeOrganizedData.queryIntent) {
                const intent = claudeOrganizedData.queryIntent;
                
                switch (intent.type) {
                  case 'urgent_deals':
                    systemMessageContent += `\n\n**URGENT ATTENTION NEEDED:**\n`;
                    if (claudeOrganizedData.topBrands?.length > 0) {
                      systemMessageContent += `\nFound ${claudeOrganizedData.topBrands.length} brands requiring immediate attention:\n`;
                      claudeOrganizedData.topBrands.forEach((brand, i) => {
                        systemMessageContent += `\n${i + 1}. ${brand.name} - ${brand.reason}\n`;
                        if (brand.meetingContext) {
                          systemMessageContent += `   Last discussed: "${brand.meetingContext.title}" on ${brand.meetingContext.date}\n`;
                          systemMessageContent += `   Meeting: ${brand.meetingContext.url}\n`;
                          if (brand.meetingContext.actionItems) {
                            systemMessageContent += `   ⚡ ACTION NEEDED: ${brand.meetingContext.actionItems}\n`;
                          }
                        }
                        systemMessageContent += `   HubSpot: ${brand.hubspotUrl}\n`;
                      });
                    } else {
                      systemMessageContent += `\nNo urgent deals found at this time.\n`;
                    }
                    systemMessageContent += `\n**INSTRUCTIONS:** Focus on brands with pending action items and upcoming deadlines. Be specific about what needs to be done.\n`;
                    break;
                    
                  case 'budget_filter':
                    systemMessageContent += `\n\n**BRANDS MATCHING BUDGET CRITERIA:**\n`;
                    if (intent.focus.minBudget) {
                      systemMessageContent += `\nShowing brands with budgets over ${intent.focus.minBudget}M:\n`;
                    }
                    if (claudeOrganizedData.topBrands?.length > 0) {
                      claudeOrganizedData.topBrands.forEach((brand, i) => {
                        systemMessageContent += `\n${i + 1}. ${brand.name} - ${brand.budget} budget\n`;
                        systemMessageContent += `   ${brand.reason}\n`;
                        systemMessageContent += `   HubSpot: ${brand.hubspotUrl}\n`;
                      });
                    }
                    systemMessageContent += `\n**INSTRUCTIONS:** Emphasize budget amounts and potential integration value.\n`;
                    break;
                    
                  case 'pipeline_stage':
                    systemMessageContent += `\n\n**BRANDS READY TO CLOSE:**\n`;
                    if (claudeOrganizedData.topBrands?.length > 0) {
                      systemMessageContent += `\n${claudeOrganizedData.topBrands.length} brands are in final stages:\n`;
                      claudeOrganizedData.topBrands.forEach((brand, i) => {
                        systemMessageContent += `\n${i + 1}. ${brand.name} - ${brand.lifecyclestage || 'Active Deal'}\n`;
                        systemMessageContent += `   Status: ${brand.reason}\n`;
                        if (brand.hasPartner) {
                          systemMessageContent += `   ✅ Agency Partner: ${brand.partnerAgency}\n`;
                        }
                        systemMessageContent += `   HubSpot: ${brand.hubspotUrl}\n`;
                      });
                    }
                    systemMessageContent += `\n**INSTRUCTIONS:** Highlight brands closest to signing and suggest immediate next steps.\n`;
                    break;
                    
                  case 'relationship_health':
                    systemMessageContent += `\n\n**BRANDS NEEDING FOLLOW-UP:**\n`;
                    if (claudeOrganizedData.topBrands?.length > 0) {
                      systemMessageContent += `\nThese brands haven't had recent activity and may need attention:\n`;
                      claudeOrganizedData.topBrands.forEach((brand, i) => {
                        systemMessageContent += `\n${i + 1}. ${brand.name}\n`;
                        systemMessageContent += `   Last Activity: ${brand.lastActivity ? new Date(brand.lastActivity).toLocaleDateString() : 'Unknown'}\n`;
                        systemMessageContent += `   Status: ${brand.lifecyclestage}\n`;
                        systemMessageContent += `   Suggestion: Reach out to re-engage\n`;
                        systemMessageContent += `   HubSpot: ${brand.hubspotUrl}\n`;
                      });
                    }
                    systemMessageContent += `\n**INSTRUCTIONS:** Suggest specific re-engagement strategies for each brand.\n`;
                    break;
                    
                  case 'activity_summary':
                    systemMessageContent += `\n\n**YOUR ACTIVITY SUMMARY:**\n`;
                    systemMessageContent += `\n${claudeOrganizedData.summary}\n`;
                    
                    if (claudeOrganizedData.recentMeetings?.length > 0) {
                      systemMessageContent += `\n**Recent Meetings:**\n`;
                      claudeOrganizedData.recentMeetings.forEach(m => {
                        systemMessageContent += `- "${m.title}" on ${m.dateString}: ${m.transcript_url}\n`;
                      });
                    }
                    
                    if (claudeOrganizedData.recentEmails?.length > 0) {
                      systemMessageContent += `\n**Recent Emails:**\n`;
                      claudeOrganizedData.recentEmails.forEach(e => {
                        systemMessageContent += `- "${e.subject}" from ${e.fromName || e.from}\n`;
                      });
                    }
                    
                    if (claudeOrganizedData.topBrands?.length > 0) {
                      systemMessageContent += `\n**Active Brands:**\n`;
                      claudeOrganizedData.topBrands.slice(0, 5).forEach(b => {
                        systemMessageContent += `- ${b.name}: ${b.tags.join(', ')}\n`;
                      });
                    }
                    systemMessageContent += `\n**INSTRUCTIONS:** Provide a conversational summary of what's happening.\n`;
                    break;
                    
                  default:
                    // Fall back to standard brand recommendations
                    if (claudeOrganizedData.topBrands?.length > 0) {
                      systemMessageContent += "\n\n**BRAND PARTNERSHIP RECOMMENDATIONS:**\n";
                      
                      if (claudeOrganizedData.currentProduction) {
                        systemMessageContent += `\nFor Production: ${claudeOrganizedData.currentProduction}\n`;
                      }
                      
                      claudeOrganizedData.topBrands.forEach((brand, index) => {
                        systemMessageContent += `\n${index + 1}. ${brand.name}\n`;
                        systemMessageContent += `   Tags: ${brand.tags.join(', ')}\n`;
                        systemMessageContent += `   Why: ${brand.reason}\n`;
                        if (brand.budget !== 'TBD') {
                          systemMessageContent += `   Budget: ${brand.budget}\n`;
                        }
                        if (brand.hasPartner) {
                          systemMessageContent += `   Agency: ${brand.partnerAgency}\n`;
                        }
                        if (brand.hubspotUrl) {
                          systemMessageContent += `   HubSpot: ${brand.hubspotUrl}\n`;
                        }
                        if (brand.meetingContext) {
                          systemMessageContent += `   Meeting: "${brand.meetingContext.title}" (${brand.meetingContext.date})\n`;
                          systemMessageContent += `   Meeting Link: ${brand.meetingContext.url}\n`;
                        }
                      });
                    }
                }
                
                systemMessageContent += `\n**GENERAL INSTRUCTIONS:**\n`;
                systemMessageContent += `- Respond naturally and conversationally\n`;
                systemMessageContent += `- Always include clickable links\n`;
                systemMessageContent += `- Be specific and actionable\n`;
                systemMessageContent += `- Don't just list data - provide insights\n`;
              }
              // Handle slash commands
              else if (claudeOrganizedData.slashCommand) {
                systemMessageContent += `\n\n**/${claudeOrganizedData.commandType.toUpperCase()} RESULTS FOR: ${claudeOrganizedData.brandName}**\n`;
                
                if (claudeOrganizedData.commandType === 'meetings' && claudeOrganizedData.meetings?.length > 0) {
                  claudeOrganizedData.meetings.forEach(meeting => {
                    systemMessageContent += `\n✅ "${meeting.title}" on ${meeting.dateString}\n`;
                    systemMessageContent += `Link: ${meeting.transcript_url}\n`;
                    if (meeting.summary?.overview) {
                      systemMessageContent += `Summary: ${meeting.summary.overview.slice(0, 150)}...\n`;
                    }
                  });
                } else if (claudeOrganizedData.commandType === 'emails' && claudeOrganizedData.emails?.length > 0) {
                  claudeOrganizedData.emails.forEach(email => {
                    systemMessageContent += `\n✉️ "${email.subject}" from ${email.fromName || email.from}\n`;
                    systemMessageContent += `Date: ${new Date(email.receivedDate).toLocaleDateString()}\n`;
                    if (email.preview) {
                      systemMessageContent += `Preview: ${email.preview}...\n`;
                    }
                  });
                } else if (claudeOrganizedData.commandType === 'contacts' && claudeOrganizedData.contacts?.length > 0) {
                  systemMessageContent += `\nContacts at ${claudeOrganizedData.brand.properties.name}:\n`;
                  claudeOrganizedData.contacts.forEach(contact => {
                    systemMessageContent += `- ${contact.properties.firstname || ''} ${contact.properties.lastname || ''} - ${contact.properties.email || 'No email'}\n`;
                  });
                } else {
                  systemMessageContent += `\nNo ${claudeOrganizedData.commandType} found for "${claudeOrganizedData.brandName}".\n`;
                }
                
                systemMessageContent += `\n**TIP:** You can use slash commands for quick lookups:\n`;
                systemMessageContent += `- /meetings [brand name]\n`;
                systemMessageContent += `- /emails [brand name]\n`;
                systemMessageContent += `- /contacts [brand name]\n`;
              }
              // Handle specific brand lookup with context
              else if (claudeOrganizedData.specificBrandWithContext) {
                systemMessageContent += `\n\n**${claudeOrganizedData.brandName} - RECENT ACTIVITY:**\n`;
                
                const brand = claudeOrganizedData.brand.properties;
                systemMessageContent += `\nBrand: ${brand.brand_name || brand.name}\n`;
                systemMessageContent += `HubSpot: https://app.hubspot.com/contacts/${hubspotAPI.portalId}/company/${claudeOrganizedData.brand.id}\n`;
                
                // Recent meetings
                if (claudeOrganizedData.recentMeetings?.length > 0) {
                  systemMessageContent += `\n**RECENT MEETINGS:**\n`;
                  claudeOrganizedData.recentMeetings.forEach(meeting => {
                    systemMessageContent += `\nYes, there was a call titled "${meeting.title}" on ${meeting.dateString}\n`;
                    systemMessageContent += `Link: ${meeting.transcript_url}\n`;
                    
                    // Key takeaway
                    if (meeting.summary?.overview) {
                      const takeaway = meeting.summary.overview.slice(0, 150);
                      systemMessageContent += `Key Discussion: ${takeaway}...\n`;
                    }
                    
                    // Action items
                    if (meeting.summary?.action_items && Array.isArray(meeting.summary.action_items) && meeting.summary.action_items.length > 0) {
                      systemMessageContent += `Action Items: ${meeting.summary.action_items[0]}\n`;
                    }
                    
                    // Participants
                    if (meeting.participants?.length > 0) {
                      systemMessageContent += `Participants: ${meeting.participants.slice(0, 3).join(', ')}\n`;
                    }
                  });
                } else {
                  systemMessageContent += `\nNo recent meetings found with ${claudeOrganizedData.brandName} in the last 30 days.\n`;
                }
                
                // Recent emails
                if (claudeOrganizedData.recentEmails?.length > 0) {
                  systemMessageContent += `\n**RECENT EMAILS:**\n`;
                  claudeOrganizedData.recentEmails.forEach(email => {
                    systemMessageContent += `\nEmail on ${new Date(email.receivedDate).toLocaleDateString()}: "${email.subject}"\n`;
                    systemMessageContent += `From: ${email.fromName || email.from}\n`;
                    if (email.preview) {
                      // Extract a meaningful quote
                      const quote = email.preview.slice(0, 100);
                      systemMessageContent += `They mentioned: "${quote}..."\n`;
                    }
                  });
                } else {
                  systemMessageContent += `\nNo recent emails found with ${claudeOrganizedData.brandName}.\n`;
                }
                
                // Contacts
                if (claudeOrganizedData.contacts?.length > 0) {
                  systemMessageContent += `\n**CONTACTS:**\n`;
                  claudeOrganizedData.contacts.forEach(contact => {
                    systemMessageContent += `- ${contact.properties.firstname || ''} ${contact.properties.lastname || ''} (${contact.properties.email || 'No email'})\n`;
                  });
                }
                
                systemMessageContent += `\n**INSTRUCTIONS:**\n`;
                systemMessageContent += `- Format meetings as: "Yes, there was a call titled 'Meeting Name' on [date]..."\n`;
                systemMessageContent += `- Always make meeting titles clickable with the full Fireflies URL\n`;
                systemMessageContent += `- Quote specific takeaways from meetings and emails\n`;
                systemMessageContent += `- Provide dates for all activities\n`;
                systemMessageContent += `- If no meetings/emails found, say so clearly\n`;
              }
              // Handle regular brand lookup (just contacts)
              else if (claudeOrganizedData.specificBrandLookup) {
                systemMessageContent += "\n\n**BRAND CONTACT INFORMATION:**\n";
                const brand = claudeOrganizedData.brand.properties;
                systemMessageContent += `Brand: ${brand.brand_name || brand.name}\n`;
                if (brand.partner_agency_name) {
                  systemMessageContent += `Partner Agency: ${brand.partner_agency_name}\n`;
                }
                if (claudeOrganizedData.contacts && claudeOrganizedData.contacts.length > 0) {
                  systemMessageContent += "\nMain Contacts:\n";
                  claudeOrganizedData.contacts.forEach((contact, i) => {
                    systemMessageContent += `${i + 1}. ${contact.properties.firstname || ''} ${contact.properties.lastname || ''}\n`;
                    systemMessageContent += `   Email: ${contact.properties.email || 'Not available'}\n`;
                    systemMessageContent += `   Title: ${contact.properties.jobtitle || 'Not specified'}\n`;
                  });
                } else {
                  systemMessageContent += "No contacts found in HubSpot for this brand.\n";
                }
                systemMessageContent += "\nProvide this contact information clearly to the user.\n";
              }
              // Handle intelligent context analysis
              else if (claudeOrganizedData.contextAnalysis) {
                if (claudeOrganizedData.queryType === 'valuable_meetings') {
                  systemMessageContent += `\n\n**MOST VALUABLE MEETINGS ${claudeOrganizedData.timeFrame.toUpperCase()}:**\n`;
                  
                  const highValueMeetings = claudeOrganizedData.valuableMeetings.filter(m => m.valueScore > 50);
                  
                  if (highValueMeetings.length > 0) {
                    highValueMeetings.forEach((meeting, index) => {
                      systemMessageContent += `\n${index + 1}. "${meeting.title}" on ${meeting.dateString}\n`;
                      systemMessageContent += `   Link: ${meeting.transcript_url}\n`;
                      systemMessageContent += `   Value Score: ${meeting.valueScore}/100\n`;
                      
                      // Explain why it's valuable
                      const reasons = [];
                      if (meeting.valueIndicators.hasActionItems) {
                        reasons.push(`${meeting.summary.action_items.length} action items`);
                      }
                      if (meeting.valueIndicators.hasBudgetDiscussion) {
                        reasons.push('budget discussed');
                      }
                      if (meeting.valueIndicators.hasDecisionMaker) {
                        reasons.push('senior stakeholders present');
                      }
                      
                      systemMessageContent += `   Why valuable: ${reasons.join(', ')}\n`;
                      
                      if (meeting.summary?.overview) {
                        systemMessageContent += `   Key discussion: ${meeting.summary.overview.slice(0, 100)}...\n`;
                      }
                    });
                    
                    systemMessageContent += `\n💡 KEY INSIGHTS:\n`;
                    systemMessageContent += `- ${highValueMeetings.length} high-value meetings identified\n`;
                    systemMessageContent += `- Meetings with action items and budget discussions rank highest\n`;
                    systemMessageContent += `- Senior stakeholder involvement increases meeting value\n`;
                  } else {
                    systemMessageContent += `\nNo high-value meetings found in the specified timeframe.\n`;
                  }
                } else {
                  // Handle general activity queries
                  systemMessageContent += `\n\n**RECENT ACTIVITY ${claudeOrganizedData.timeFrame.toUpperCase()}:**\n`;
                  
                  if (claudeOrganizedData.valuableMeetings?.length > 0) {
                    systemMessageContent += `\n**MEETINGS:**\n`;
                    claudeOrganizedData.valuableMeetings.slice(0, 5).forEach(meeting => {
                      systemMessageContent += `- "${meeting.title}" on ${meeting.dateString}\n`;
                      systemMessageContent += `  Link: ${meeting.transcript_url}\n`;
                    });
                  }
                  
                  if (claudeOrganizedData.emails?.length > 0) {
                    systemMessageContent += `\n**EMAILS:**\n`;
                    claudeOrganizedData.emails.slice(0, 5).forEach(email => {
                      systemMessageContent += `- "${email.subject}" from ${email.fromName || email.from}\n`;
                    });
                  }
                }
                
                systemMessageContent += `\n**INSTRUCTIONS:**\n`;
                systemMessageContent += `- Always provide specific meeting titles and dates\n`;
                systemMessageContent += `- Include clickable Fireflies links\n`;
                systemMessageContent += `- Explain WHY meetings are valuable (action items, budget, stakeholders)\n`;
                systemMessageContent += `- Rank meetings by value score when asked about "valuable" meetings\n`;
              }
              // Handle context-only queries
              else if (claudeOrganizedData.contextOnly) {
                systemMessageContent += "\n\n**RECENT CONTEXT AND INSIGHTS:**\n";
                
                if (claudeOrganizedData.firefliesTranscripts?.length > 0) {
                  systemMessageContent += "\n**RECENT MEETINGS WITH KEY INSIGHTS:**\n";
                  claudeOrganizedData.firefliesTranscripts.forEach(t => {
                    systemMessageContent += `\nMeeting: "${t.title}" on ${t.dateString}\n`;
                    systemMessageContent += `Link: ${t.transcript_url}\n`;
                    systemMessageContent += `Participants: ${t.participants?.slice(0, 3).join(', ') || 'Not specified'}\n`;
                    
                    // Extract brand mentions and insights
                    const overview = t.summary?.overview || '';
                    const topics = t.summary?.topics_discussed || '';
                    
                    // Look for brand mentions in the meeting
                    const brandMentions = [];
                    if (claudeOrganizedData.topBrands) {
                      claudeOrganizedData.topBrands.forEach(brand => {
                        if (overview.toLowerCase().includes(brand.name.toLowerCase()) || 
                            topics.toLowerCase().includes(brand.name.toLowerCase())) {
                          brandMentions.push(brand.name);
                        }
                      });
                    }
                    
                    if (brandMentions.length > 0) {
                      systemMessageContent += `Brands Discussed: ${brandMentions.join(', ')}\n`;
                    }
                    
                    if (t.summary?.action_items && Array.isArray(t.summary.action_items) && t.summary.action_items.length > 0) {
                      systemMessageContent += `Action Items: ${t.summary.action_items.slice(0, 3).join('; ')}\n`;
                    }
                    
                    if (overview) {
                      systemMessageContent += `Key Discussion: ${overview.slice(0, 200)}...\n`;
                    }
                    
                    systemMessageContent += "\n";
                  });
                }
                
                if (claudeOrganizedData.o365Emails?.length > 0) {
                  systemMessageContent += "\n**RECENT EMAIL THREADS:**\n";
                  claudeOrganizedData.o365Emails.forEach(e => {
                    systemMessageContent += `\nEmail: "${e.subject}"\n`;
                    systemMessageContent += `From: ${e.fromName || e.from} (${new Date(e.receivedDate).toLocaleDateString()})\n`;
                    systemMessageContent += `Content: ${e.preview}...\n`;
                    
                    // Look for urgency indicators
                    const urgencyWords = ['urgent', 'asap', 'immediately', 'deadline', 'tomorrow', 'today'];
                    const hasUrgency = urgencyWords.some(word => 
                      e.subject.toLowerCase().includes(word) || 
                      e.preview.toLowerCase().includes(word)
                    );
                    
                    if (hasUrgency) {
                      systemMessageContent += `⚡ URGENT: This email indicates time-sensitive action needed\n`;
                    }
                  });
                }
                
                systemMessageContent += "\n**INSTRUCTIONS FOR CONTEXT QUERIES:**\n";
                systemMessageContent += "- Identify 'low hanging fruit' by looking for: urgent emails, pending action items, brands mentioned multiple times\n";
                systemMessageContent += "- Quote specific insights from meetings/emails\n";
                systemMessageContent += "- Always include meeting links when referencing them\n";
                systemMessageContent += "- Highlight any time-sensitive opportunities\n";
                systemMessageContent += "- If asked about 'last email' with specific contacts, provide the actual email details above\n";
              }
              // Default brand matching response
              else {
                systemMessageContent += "\n\n**BRAND PARTNERSHIP RECOMMENDATIONS:**\n";
                
                if (claudeOrganizedData.currentProduction) {
                  systemMessageContent += `\nFor Production: ${claudeOrganizedData.currentProduction}\n`;
                }
                
                if (claudeOrganizedData.topBrands?.length > 0) {
                  systemMessageContent += "\n**TOP BRANDS:**\n";
                  claudeOrganizedData.topBrands.forEach((brand, index) => {
                    systemMessageContent += `\n${index + 1}. ${brand.name}\n`;
                    systemMessageContent += `   Tags: ${brand.tags.join(', ')}\n`;
                    systemMessageContent += `   Why: ${brand.reason}\n`;
                    if (brand.budget !== 'TBD') {
                      systemMessageContent += `   Budget: ${brand.budget}\n`;
                    }
                    if (brand.hasPartner) {
                      systemMessageContent += `   Agency: ${brand.partnerAgency}\n`;
                    }
                    if (brand.hubspotUrl) {
                      systemMessageContent += `   HubSpot: ${brand.hubspotUrl}\n`;
                    }
                    // Add specific meeting/email context
                    if (brand.meetingContext) {
                      systemMessageContent += `   Meeting: "${brand.meetingContext.title}" (${brand.meetingContext.date})\n`;
                      systemMessageContent += `   Meeting Link: ${brand.meetingContext.url}\n`;
                      if (brand.meetingContext.actionItems) {
                        systemMessageContent += `   Action Item: ${brand.meetingContext.actionItems}\n`;
                      }
                      systemMessageContent += `   Discussion: ${brand.meetingContext.context}\n`;
                    }
                    if (brand.emailContext) {
                      systemMessageContent += `   Email: "${brand.emailContext.subject}"\n`;
                      systemMessageContent += `   From: ${brand.emailContext.from} on ${new Date(brand.emailContext.date).toLocaleDateString()}\n`;
                      systemMessageContent += `   Preview: ${brand.emailContext.preview}\n`;
                    }
                  });
                }
                
                // Add all meeting/email context for context queries
                if (claudeOrganizedData.firefliesTranscripts?.length > 0) {
                  systemMessageContent += "\n**ALL RELEVANT MEETINGS:**\n";
                  claudeOrganizedData.firefliesTranscripts.forEach(t => {
                    systemMessageContent += `- "${t.title}" on ${t.dateString}\n`;
                    systemMessageContent += `  Link: ${t.transcript_url}\n`;
                    if (t.summary?.action_items && Array.isArray(t.summary.action_items) && t.summary.action_items.length > 0) {
                      systemMessageContent += `  Action Items: ${t.summary.action_items.slice(0, 2).join('; ')}\n`;
                    }
                    if (t.summary?.overview) {
                      systemMessageContent += `  Summary: ${t.summary.overview.slice(0, 150)}...\n`;
                    }
                    systemMessageContent += "\n";
                  });
                }
                
                if (claudeOrganizedData.o365Emails?.length > 0) {
                  systemMessageContent += "\n**ALL RECENT EMAILS:**\n";
                  claudeOrganizedData.o365Emails.forEach(e => {
                    systemMessageContent += `- "${e.subject}" from ${e.fromName || e.from} (${new Date(e.receivedDate).toLocaleDateString()})\n`;
                    systemMessageContent += `  Preview: ${e.preview}...\n\n`;
                  });
                }
                
                systemMessageContent += "\n**INSTRUCTIONS:**\n";
                systemMessageContent += "- When mentioning meetings, ALWAYS include the meeting title and link\n";
                systemMessageContent += "- Quote specific insights from emails/meetings when explaining brand relevance\n";
                systemMessageContent += "- For 'low hanging fruit', identify brands with recent email threads or upcoming action items\n";
                systemMessageContent += "- Always provide specific context, not generic statements\n";
                systemMessageContent += "- Format meeting links as: Meeting: [Title] Link: [URL]\n";
              }
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
            
            // Include brand suggestions if we have them
            const response = { 
              reply: aiReply,
              mcpThinking: mcpThinking || [],  // Always send array, never null
              mcpRawOutput: mcpRawOutput || [], // Always send array, never null
              usedMCP: usedMCP
            };
            
            // Add brand suggestions for dropdown if available
            if (claudeOrganizedData && claudeOrganizedData.brandSuggestions) {
              response.brandSuggestions = claudeOrganizedData.brandSuggestions;
            }
            
            return res.json(response);
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
