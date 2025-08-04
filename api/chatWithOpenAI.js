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
    return { topBrands: [], scores: {} };
  }
}

async function searchHubSpot(query, projectId, limit = 50) {
  if (!hubspotApiKey) {
    return { brands: [], productions: [] };
  }
  
  try {
    const isConnected = await hubspotAPI.testConnection();
    if (!isConnected) {
      return { brands: [], productions: [] };
    }
    
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

    return {
      brands: brandsData.results || [],
      productions: productionsData.results || []
    };

  } catch (error) {
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
        hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI.portalId}/company/${b.id}`,
        tags: [],
        relevanceScore: 0,
        reason: ''
      };
      
      const tags = [];
      let score = 0;
      let primaryReason = '';
      
      const brandNameLower = brand.name.toLowerCase();
      let meetingMention = null;
      let emailMention = null;
      
      const mentionedInFireflies = firefliesTranscripts && firefliesTranscripts.some(t => {
        const overview = (t.summary?.overview || '').toLowerCase();
        const title = (t.title || '').toLowerCase();
        const topics = (t.summary?.topics_discussed || '').toLowerCase();
        const keywords = (t.summary?.keywords || []).join(' ').toLowerCase();
        const searchText = `${overview} ${title} ${topics} ${keywords}`;
        
        const normalizedBrandName = brandNameLower.replace(/[''\'s]/g, '').replace(/\s+/g, ' ');
        const brandWords = normalizedBrandName.split(' ').filter(w => w.length > 2);
        
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
        
        const brandWords = brandNameLower.split(' ');
        const found = brandWords.some(word => word.length > 3 && searchText.includes(word));
        
        if (found || searchText.includes(brandNameLower)) {
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
      
      // Priority 1: Creative/Genre Match (highest weight)
      if (productionContext.genre && brand.category) {
        const genreMatch = checkGenreMatch(productionContext.genre, brand.category);
        if (genreMatch) {
          tags.push('Creative Match');
          score += 40; // Highest weight
          primaryReason = `Perfect creative fit: ${brand.category} aligns with ${productionContext.genre} genre`;
        }
      }
      
      // Check for creative alignment from meetings/emails
      if (meetingMention && (meetingMention.context.includes('creative') || meetingMention.context.includes('integration'))) {
        if (!tags.includes('Creative Match')) {
          tags.push('Creative Match');
          score += 35;
        }
        primaryReason = `Creative synergy discussed in "${meetingMention.title}" - ${meetingMention.context}`;
      }
      
      // Priority 2: Big Budget
      if (brand.budget && brand.budget !== 'TBD') {
        const budgetValue = parseFloat(brand.budget.match(/\d+\.?\d*/)?.[0] || 0);
        if (budgetValue > 5) {
          tags.push('Big Budget');
          score += 30;
          if (!primaryReason) {
            primaryReason = `${brand.budget} media spend available for integrations`;
          }
        }
      }
      
      // Priority 3: Current Client
      if (brand.clientStatus === 'Active' || brand.clientStatus === 'Customer') {
        tags.push('Current Client');
        score += 35;
        if (!primaryReason) {
          primaryReason = 'Active client ready for new integration';
        }
      }
      
      // Priority 4: This Week Activity (Email or Meeting)
      if (brand.lastActivity) {
        const lastActivityDate = new Date(brand.lastActivity);
        const daysSinceActivity = (new Date() - lastActivityDate) / (1000 * 60 * 60 * 24);
        
        if (daysSinceActivity < 7) {
          if (mentionedInEmails && emailMention) {
            tags.push('This Week Email');
            score += 25;
            if (!primaryReason) {
              primaryReason = `Fresh momentum: "${emailMention.subject}" from ${emailMention.from}`;
            }
          }
          
          if (mentionedInFireflies && meetingMention) {
            const meetingDate = new Date(meetingMention.date);
            const daysSinceMeeting = (new Date() - meetingDate) / (1000 * 60 * 60 * 24);
            if (daysSinceMeeting < 7) {
              tags.push('This Week Meeting');
              score += 30;
              primaryReason = `Just discussed in "${meetingMention.title}" - ${meetingMention.actionItems || 'ready to move forward'}`;
            }
          }
        }
      }
      
      // Priority 5: Strategic fits
      // Check for strategic alignment indicators
      const isStrategic = 
        (brand.hasPartner && tags.includes('Creative Match')) ||
        (brand.lifecyclestage === 'opportunity' && brand.budget !== 'TBD') ||
        (meetingMention && meetingMention.actionItems) ||
        (brand.category && isEmergingCategory(brand.category));
      
      if (isStrategic) {
        tags.push('Strategic');
        score += 20;
        if (!primaryReason) {
          if (brand.hasPartner) {
            primaryReason = `Strategic opportunity: Agency partner ${brand.partnerAgency} can accelerate deal`;
          } else if (meetingMention && meetingMention.actionItems) {
            primaryReason = `Strategic next step: ${meetingMention.actionItems}`;
          } else {
            primaryReason = `Strategic ${brand.category} brand for portfolio expansion`;
          }
        }
      }
      
      // Additional context for meetings/emails that aren't "this week"
      if (!tags.includes('This Week Meeting') && mentionedInFireflies && meetingMention) {
        score += 20;
        if (!primaryReason) {
          primaryReason = `Discussed in "${meetingMention.title}" on ${meetingMention.date}`;
          if (meetingMention.actionItems) {
            primaryReason += ` - Action: ${meetingMention.actionItems}`;
          }
        }
        brand.meetingContext = meetingMention;
      }
      
      if (!tags.includes('This Week Email') && mentionedInEmails && emailMention) {
        score += 15;
        if (!primaryReason || primaryReason.includes('partner')) {
          primaryReason = `Recent email: "${emailMention.subject}" from ${emailMention.from}`;
        }
        brand.emailContext = emailMention;
      }
      
      // Deal stage specifics for HubSpot
      if (brand.lifecyclestage === 'opportunity' && !tags.includes('Current Client')) {
        score += 15;
        if (!primaryReason) {
          primaryReason = 'Active opportunity in pipeline';
        }
      }
      
      // If no tags yet, check for other valuable signals
      if (tags.length === 0) {
        if (brand.hasPartner) {
          tags.push('Strategic');
          score += 15;
          primaryReason = `Agency-backed: ${brand.partnerAgency} partnership ready`;
        } else if (brand.numContacts && parseInt(brand.numContacts) >= 3) {
          tags.push('Strategic');
          score += 10;
          primaryReason = `${brand.numContacts} contacts engaged - multiple stakeholders involved`;
        } else {
          tags.push('Creative Match');
          score += 5;
          primaryReason = `Potential creative fit for ${productionContext.genre || 'production'}`;
        }
      }
      
      brand.tags = tags;
      brand.relevanceScore = score;
      brand.reason = primaryReason;
      
      return brand;
    });
    
    const topBrands = taggedBrands
      .filter(b => b.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 15);
    
    return { topBrands, taggedBrands };
    
  } catch (error) {
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
    crime: /\b(crime|detective|investigation|murder|police|criminal)\b/i
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
      return keyword;
    }
    
    return '';
    
  } catch (error) {
    return '';
  }
}

async function handleClaudeSearch(userMessage, knowledgeBaseInstructions, projectId, sessionId, conversationContext) {
  if (!anthropicApiKey) {
    return null;
  }
  
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
        break;
      }
    }
  }
  
  try {
    const mcpThinking = [];
    
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
          const contacts = await hubspotAPI.getContactsForBrand(brand.id);
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
    
    const brandLookupMatch = userMessage.match(/(?:contact|who is|point of contact|poc|calls?|meetings?|emails?).*?(?:with|for|at|about)\s+([A-Z][^\?\.,]+)/i);
    if (brandLookupMatch) {
      const brandName = brandLookupMatch[1].trim();
      mcpThinking.push(`🔍 Looking up ${brandName} with recent activity...`);
      
      const [brand, firefliesData, o365Data] = await Promise.all([
        hubspotAPI.searchSpecificBrand(brandName),
        firefliesApiKey ? searchFireflies(brandName, { limit: 5 }) : { transcripts: [] },
        msftClientId ? o365API.searchEmails(brandName, { days: 30 }) : []
      ]);
      
      if (brand) {
        mcpThinking.push('✅ Found brand in HubSpot');
        const contacts = await hubspotAPI.getContactsForBrand(brand.id);
        
        const brandMeetings = firefliesData.transcripts?.filter(t => {
          const searchText = `${t.title} ${t.summary?.overview || ''} ${t.summary?.topics_discussed || ''}`.toLowerCase();
          return searchText.includes(brandName.toLowerCase());
        }) || [];
        
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
    
    const partnershipPatterns = [
      /(?:partnerships?|productions?|shows?|films?|movies?).*?(?:suitable|good|match|for|new|recent|added|available)/i,
      /(?:what|which|show|list).*?(?:partnerships?|productions?|shows?|films?|movies?)/i,
      /new partnership opportunities/i,
      /partnership.*?opportunities/i
    ];
    
    const isPartnershipQuery = partnershipPatterns.some(pattern => pattern.test(userMessage));
    
    if (isPartnershipQuery) {
      mcpThinking.push('🎬 Searching for partnership/production opportunities...');
      
      const partnershipsData = await hubspotAPI.searchProductions({ limit: 20 });
      
      if (partnershipsData.results?.length > 0) {
        mcpThinking.push(`✅ Found ${partnershipsData.results.length} partnership opportunities`);
        
        const partnerships = partnershipsData.results.map(p => ({
          id: p.id,
          name: p.properties.partnership_name || p.properties.production_name || p.properties.name,
          synopsis: p.properties.synopsis,
          contentType: p.properties.content_type,
          distributor: p.properties.distributor,
          stage: p.properties.partnership_status || p.properties.hs_pipeline_stage,
          fee: p.properties.hollywood_branded_fee,
          hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI.portalId}/record/${hubspotAPI.OBJECTS.PARTNERSHIPS}/${p.id}`,
          lastModified: p.properties.hs_lastmodifieddate
        }));
        
        return {
          organizedData: {
            partnershipSearch: true,
            partnerships: partnerships,
            queryType: 'partnership_opportunities'
          },
          mcpThinking,
          usedMCP: true
        };
      }
    }
    
    const productionMatch = userMessage.match(/Title:\s*([^\n]+)[\s\S]*Synopsis:\s*([\s\S]+)/i);
    if (productionMatch) {
      const title = productionMatch[1].trim();
      const synopsis = productionMatch[2].trim();
      
      mcpThinking.push(`🎬 Production shared: "${title}"`);
      mcpThinking.push('🔍 Searching for this specific partnership in HubSpot...');
      
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
      
      let partnershipDetails = null;
      if (partnershipSearch.results?.length > 0) {
        partnershipDetails = partnershipSearch.results[0];
        mcpThinking.push('✅ Found partnership in HubSpot');
      } else {
        mcpThinking.push('⚠️ Partnership not found in HubSpot - will use provided details');
      }
      
      const [firefliesData, o365Data] = await Promise.all([
        firefliesApiKey ? searchFireflies(title, { limit: 10 }) : { transcripts: [] },
        msftClientId ? o365API.searchEmails(title, { days: 60 }) : []
      ]);
      
      if (firefliesData.transcripts?.length > 0) {
        mcpThinking.push(`✅ Found ${firefliesData.transcripts.length} meetings about this production`);
      }
      if (o365Data?.length > 0) {
        mcpThinking.push(`✅ Found ${o365Data.length} emails about this production`);
      }
      
      mcpThinking.push('🎯 Finding suitable brands for this production...');
      
      const hubspotBrands = await hubspotAPI.searchBrands({ limit: 50 });
      
      const productionContext = {
        title: title,
        synopsis: synopsis,
        genre: extractGenreFromSynopsis(synopsis),
        contentType: partnershipDetails?.properties.content_type,
        distributor: partnershipDetails?.properties.distributor
      };
      
      const { topBrands } = await narrowWithIntelligentTags(
        hubspotBrands.results || [],
        firefliesData.transcripts || [],
        o365Data || [],
        `${userMessage}\nProduction Context: ${JSON.stringify(productionContext)}`
      );
      
      return {
        organizedData: {
          productionShared: true,
          production: {
            title: title,
            synopsis: synopsis,
            hubspotDetails: partnershipDetails,
            context: productionContext
          },
          topBrands: topBrands.slice(0, 15),
          brandSuggestions: topBrands.slice(0, 15).map(brand => ({
            id: brand.id,
            name: brand.name,
            score: brand.relevanceScore,
            tag: brand.tags[0] || 'Potential Match',
            tags: brand.tags,
            reason: brand.reason,
            budget: brand.budget,
            hasAgency: brand.hasPartner,
            agencyName: brand.partnerAgency,
            hubspotUrl: brand.hubspotUrl,
            meetingUrl: brand.meetingContext?.url || null,
            meetingTitle: brand.meetingContext?.title || null,
            emailSubject: brand.emailContext?.subject || null
          })),
          relatedMeetings: firefliesData.transcripts?.slice(0, 5) || [],
          relatedEmails: o365Data?.slice(0, 5) || [],
          currentProduction: title,
          productionContext: productionContext
        },
        mcpThinking,
        usedMCP: true
      };
    }
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
      
      let daysToSearch = 30;
      if (userMessage.includes('this week')) daysToSearch = 7;
      if (userMessage.includes('today')) daysToSearch = 1;
      if (userMessage.includes('this month')) {
        const now = new Date();
        daysToSearch = now.getDate();
      }
      
      const [firefliesData, o365Data] = await Promise.all([
        firefliesApiKey ? searchFireflies('', { 
          limit: 20, 
          fromDate: new Date(Date.now() - daysToSearch * 24 * 60 * 60 * 1000).toISOString()
        }) : { transcripts: [] },
        msftClientId ? o365API.searchEmails('', { days: daysToSearch }) : []
      ]);
      
      const valuableMeetings = firefliesData.transcripts?.map(meeting => {
        const overview = (meeting.summary?.overview || '').toLowerCase();
        const topics = (meeting.summary?.topics_discussed || '').toLowerCase();
        
        const hasActionItems = meeting.summary?.action_items?.length > 0;
        const hasBudgetDiscussion = overview.includes('budget') || overview.includes('spend') || overview.includes('investment');
        const hasDecisionMaker = meeting.participants?.some(p => 
          p.toLowerCase().includes('ceo') || 
          p.toLowerCase().includes('vp') || 
          p.toLowerCase().includes('director')
        );
        
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
    
    mcpThinking.push('🔍 Starting brand partnership search...');
    
    const fullContext = (userMessage + ' ' + (conversationContext || ''));
    const productionContext = extractProductionContext(fullContext);
    
    if (productionContext.genre) {
      mcpThinking.push(`🎯 Focusing on ${productionContext.genre} genre`);
    }
    
    const searchKeywords = [];
    if (currentProduction) {
      const titleWords = currentProduction.split(' ').filter(w => w.length > 3);
      searchKeywords.push(...titleWords);
    }
    if (productionContext.genre) {
      searchKeywords.push(productionContext.genre);
    }
    
    if (searchKeywords.length === 0) {
      searchKeywords.push('brand', 'partnership');
    }
    
    const [hubspotData, firefliesData, o365Data] = await Promise.all([
      hubspotApiKey ? searchHubSpot(userMessage, projectId, 30) : { brands: [], productions: [] },
      firefliesApiKey ? searchFireflies(
        searchKeywords.slice(0, 2).join(' '),
        { limit: 10 }
      ) : { transcripts: [] },
      msftClientId ? o365API.searchEmails(
        currentProduction || searchKeywords[0] || 'brand', 
        { days: 30 }
      ) : []
    ]);
    
    if (hubspotData.brands?.length > 0) {
      mcpThinking.push(`✅ Found ${hubspotData.brands.length} brands in HubSpot`);
    }
    if (firefliesData.transcripts?.length > 0) {
      mcpThinking.push(`✅ Found ${firefliesData.transcripts.length} meeting transcripts`);
    }
    if (o365Data?.length > 0) {
      mcpThinking.push(`✅ Found ${o365Data.length} email threads`);
    }
    
    mcpThinking.push('🧠 Analyzing brand relevance...');
    
    const { topBrands } = await narrowWithIntelligentTags(
      hubspotData.brands || [],
      firefliesData.transcripts || [],
      o365Data || [],
      userMessage
    );
    
    const brandSuggestions = topBrands.slice(0, 15).map(brand => ({
      id: brand.id,
      name: brand.name,
      score: brand.relevanceScore,
      tag: brand.tags[0] || 'Potential Match',
      tags: brand.tags,
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
        topBrands: topBrands.slice(0, 10),
        brandSuggestions: brandSuggestions,
        firefliesTranscripts: firefliesData.transcripts?.slice(0, 3) || [],
        o365Emails: o365Data?.slice(0, 3) || [],
        currentProduction: currentProduction,
        productionContext: productionContext
      },
      mcpThinking,
      usedMCP: true
    };
    
  } catch (error) {
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

async function shouldUseSearch(userMessage, conversationContext) {
  if (!openAIApiKey) return false;
  
  try {
    const contextClues = conversationContext ? conversationContext.toLowerCase() : '';
    const messageClues = userMessage.toLowerCase();
    
    if (messageClues.includes('synopsis:') && messageClues.includes('title:')) {
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
          content: `You are a query classifier for a Hollywood production company's AI assistant. The assistant has access to:
- HubSpot CRM (brands, companies, contacts)
- Fireflies meeting transcripts
- Email archives
- Production/film/show databases

Return "true" ONLY if the query is asking to:
- Search for brands, companies, or partnerships
- Look up meetings, calls, or transcripts
- Find emails or messages
- Match brands to a production/film/show
- Access any business data from these systems

Return "false" for:
- General knowledge questions
- Casual conversation
- Questions about how things work
- Advice or recommendations not requiring database searches
- Any query that can be answered without searching internal systems

Just return "true" or "false", nothing else.`
        }, {
          role: 'user',
          content: `Query: "${userMessage}"
Recent context: "${contextClues.slice(-300)}"

Should I search the internal databases for this?`
        }],
        temperature: 0,
        max_tokens: 10
      }),
    });
    
    const data = await response.json();
    const result = data.choices[0].message.content.toLowerCase().trim();
    return result === 'true';
    
  } catch (error) {
    return messageClues.match(/\b(hubspot|fireflies|brand matching|meeting transcript|email archive)\b/i) !== null;
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
      } else if (userMessage) {
        try {
          let aiReply = '';
          let mcpThinking = [];
          let usedMCP = false;

          let claudeOrganizedData = null;
          if (shouldSearchDatabases && anthropicApiKey) {
            const claudeResult = await handleClaudeSearch(
              userMessage, 
              knowledgeBaseInstructions, 
              projectId, 
              sessionId,
              conversationContext
            );
            
            if (claudeResult) {
              claudeOrganizedData = claudeResult.organizedData;
              mcpThinking = claudeResult.mcpThinking || [];
              
              if (claudeResult.mcpThinking && Array.isArray(claudeResult.mcpThinking)) {
                claudeResult.mcpThinking.forEach((step, index) => {
                  mcpRawOutput.push({
                    text: step,
                    timestamp: Date.now() - mcpStartTime + (index * 200)
                  });
                });
              }
              
              usedMCP = true;
              mcpRawOutput.push({
                text: '✅ Claude MCP successfully gathered and organized data',
                timestamp: Date.now() - mcpStartTime
              });
            } else {
              mcpRawOutput.push({
                text: '⚠️ Claude MCP failed - using standard OpenAI',
                timestamp: Date.now() - mcpStartTime
              });
            }
          } else {
            if (!shouldSearchDatabases) {
            }
            if (!anthropicApiKey) {
            }
          }
          
          if (!aiReply) {
            mcpRawOutput.push({
              text: '📝 Using OpenAI for response generation',
              timestamp: Date.now() - mcpStartTime
            });
            
            let systemMessageContent = knowledgeBaseInstructions || "You are a helpful assistant specialized in AI & Automation.";
            
            if (claudeOrganizedData) {
              if (claudeOrganizedData.pitchRequest) {
                systemMessageContent += `\n\n**BRAND PITCH ANALYSIS:**\n`;
                
                if (claudeOrganizedData.brands?.length > 0) {
                  claudeOrganizedData.brands.forEach((brandData, index) => {
                    systemMessageContent += `\n\n## ${index + 1}. ${brandData.brand.name}\n`;
                    systemMessageContent += `Category: ${brandData.brand.category || 'Not specified'}\n`;
                    systemMessageContent += `Status: ${brandData.brand.clientStatus || 'Unknown'}\n`;
                    if (brandData.brand.budget) {
                      systemMessageContent += `Budget: ${brandData.brand.budget}\n`;
                    }
                    if (brandData.brand.agencyPartner) {
                      systemMessageContent += `Agency: ${brandData.brand.agencyPartner}\n`;
                    }
                    systemMessageContent += `HubSpot: ${brandData.brand.hubspotUrl}\n`;
                    
                    systemMessageContent += `\n### BRAND INSIGHTS:\n`;
                    systemMessageContent += `Engagement Level: ${brandData.insights.engagementLevel}\n`;
                    if (brandData.insights.lastTouchpoint) {
                      const daysSince = Math.floor((new Date() - brandData.insights.lastTouchpoint.date) / (1000 * 60 * 60 * 24));
                      systemMessageContent += `Last Contact: ${brandData.insights.lastTouchpoint.type} "${brandData.insights.lastTouchpoint.title}" (${daysSince} days ago)\n`;
                    }
                    systemMessageContent += `Sentiment: ${brandData.insights.sentimentTrend}\n`;
                    
                    if (brandData.insights.keyTopics.length > 0) {
                      systemMessageContent += `Key Discussion Topics: ${brandData.insights.keyTopics.join(', ')}\n`;
                    }
                    
                    if (brandData.insights.decisionMakers.length > 0) {
                      systemMessageContent += `\nKey Contacts:\n`;
                      brandData.insights.decisionMakers.forEach(dm => {
                        systemMessageContent += `- ${dm.name} (${dm.interactions} interactions)\n`;
                      });
                    }
                    
                    if (brandData.meetings.length > 0) {
                      systemMessageContent += `\nRecent Meetings:\n`;
                      brandData.meetings.slice(0, 3).forEach(m => {
                        systemMessageContent += `- "${m.title}" on ${m.date}\n`;
                        if (m.actionItems && m.actionItems.length > 0) {
                          systemMessageContent += `  Action: ${m.actionItems[0]}\n`;
                        }
                      });
                    }
                    
                    if (brandData.emails.length > 0) {
                      systemMessageContent += `\nRecent Emails:\n`;
                      brandData.emails.slice(0, 3).forEach(e => {
                        systemMessageContent += `- "${e.subject}" from ${e.from}\n`;
                      });
                    }
                    
                    systemMessageContent += `\n### INTEGRATION IDEAS:\n`;
                    brandData.integrationIdeas.forEach((idea, i) => {
                      systemMessageContent += `\n${i + 1}. **${idea.type}**\n`;
                      systemMessageContent += `   ${idea.description}\n`;
                      systemMessageContent += `   Why it works: ${idea.rationale}\n`;
                    });
                    
                    if (brandData.insights.opportunities.length > 0) {
                      systemMessageContent += `\n### OPPORTUNITIES:\n`;
                      brandData.insights.opportunities.forEach(opp => {
                        systemMessageContent += `- ${opp}\n`;
                      });
                    }
                    
                    if (brandData.insights.painPoints.length > 0) {
                      systemMessageContent += `\n### CONSIDERATIONS:\n`;
                      brandData.insights.painPoints.forEach(pain => {
                        systemMessageContent += `- ${pain}\n`;
                      });
                    }
                  });
                } else {
                  systemMessageContent += `\nNo brands found matching: ${claudeOrganizedData.requestedBrands.join(', ')}\n`;
                }
                
                systemMessageContent += `\n\n**INSTRUCTIONS FOR PITCH CREATION:**\n`;
                systemMessageContent += `- Create compelling, personalized pitches for each brand\n`;
                systemMessageContent += `- Reference specific meetings and conversations to show continuity\n`;
                systemMessageContent += `- Address any pain points mentioned in past discussions\n`;
                systemMessageContent += `- Emphasize the integration ideas that best fit their brand goals\n`;
                systemMessageContent += `- Include next steps based on their engagement level\n`;
                systemMessageContent += `- Make each pitch feel like a natural continuation of your relationship\n`;
                
                if (claudeOrganizedData.currentProduction) {
                  systemMessageContent += `- Tie all pitches to the production: ${claudeOrganizedData.currentProduction}\n`;
                }
              }
              else if (claudeOrganizedData.partnershipSearch) {
                systemMessageContent += `\n\n**PARTNERSHIP/PRODUCTION OPPORTUNITIES:**\n`;
                
                if (claudeOrganizedData.partnerships?.length > 0) {
                  systemMessageContent += `\nFound ${claudeOrganizedData.partnerships.length} partnership opportunities:\n`;
                  claudeOrganizedData.partnerships.forEach((p, i) => {
                    systemMessageContent += `\n${i + 1}. ${p.name}\n`;
                    if (p.synopsis) {
                      systemMessageContent += `   Synopsis: ${p.synopsis.slice(0, 150)}...\n`;
                    }
                    if (p.contentType) {
                      systemMessageContent += `   Type: ${p.contentType}\n`;
                    }
                    if (p.distributor) {
                      systemMessageContent += `   Distributor: ${p.distributor}\n`;
                    }
                    if (p.stage) {
                      systemMessageContent += `   Stage: ${p.stage}\n`;
                    }
                    if (p.fee) {
                      systemMessageContent += `   Fee: ${p.fee}\n`;
                    }
                    systemMessageContent += `   HubSpot: ${p.hubspotUrl}\n`;
                  });
                }
                
                systemMessageContent += `\n**INSTRUCTIONS:**\n`;
                systemMessageContent += `- Present these as exciting opportunities\n`;
                systemMessageContent += `- Highlight any that match the user's criteria\n`;
                systemMessageContent += `- Include the HubSpot links for easy access\n`;
              }
              else if (claudeOrganizedData.productionShared) {
                systemMessageContent += `\n\n**PRODUCTION ANALYSIS:**\n`;
                systemMessageContent += `Title: ${claudeOrganizedData.production.title}\n`;
                systemMessageContent += `Synopsis: ${claudeOrganizedData.production.synopsis}\n`;
                
                if (claudeOrganizedData.production.hubspotDetails) {
                  const details = claudeOrganizedData.production.hubspotDetails.properties;
                  systemMessageContent += `\n**HubSpot Details:**\n`;
                  if (details.content_type) systemMessageContent += `Type: ${details.content_type}\n`;
                  if (details.distributor) systemMessageContent += `Distributor: ${details.distributor}\n`;
                  if (details.partnership_stage) systemMessageContent += `Stage: ${details.partnership_stage}\n`;
                }
                
                if (claudeOrganizedData.relatedMeetings?.length > 0) {
                  systemMessageContent += `\n**Related Meetings:**\n`;
                  claudeOrganizedData.relatedMeetings.forEach(m => {
                    systemMessageContent += `- "${m.title}" on ${m.dateString}: ${m.transcript_url}\n`;
                  });
                }
                
                systemMessageContent += `\n**RECOMMENDED BRANDS FOR THIS PRODUCTION:**\n`;
                if (claudeOrganizedData.topBrands?.length > 0) {
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
                  });
                  
                  systemMessageContent += `\n**INSTRUCTIONS:**\n`;
                  systemMessageContent += `- Explain why each brand is a good fit for this specific production\n`;
                  systemMessageContent += `- Reference the genre (${claudeOrganizedData.production.context.genre}) when explaining matches\n`;
                  systemMessageContent += `- Highlight brands with recent activity or meetings\n`;
                  systemMessageContent += `- Make it clear these are data-driven recommendations\n`;
                }
              }
              else if (claudeOrganizedData.queryIntent) {
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
              else if (claudeOrganizedData.specificBrandWithContext) {
                systemMessageContent += `\n\n**${claudeOrganizedData.brandName} - RECENT ACTIVITY:**\n`;
                
                const brand = claudeOrganizedData.brand.properties;
                systemMessageContent += `\nBrand: ${brand.brand_name || brand.name}\n`;
                systemMessageContent += `HubSpot: https://app.hubspot.com/contacts/${hubspotAPI.portalId}/record/${hubspotAPI.OBJECTS.BRANDS}/${claudeOrganizedData.brand.id}\n`;
                
                if (claudeOrganizedData.recentMeetings?.length > 0) {
                  systemMessageContent += `\n**RECENT MEETINGS:**\n`;
                  claudeOrganizedData.recentMeetings.forEach(meeting => {
                    systemMessageContent += `\nYes, there was a call titled "${meeting.title}" on ${meeting.dateString}\n`;
                    systemMessageContent += `Link: ${meeting.transcript_url}\n`;
                    
                    if (meeting.summary?.overview) {
                      const takeaway = meeting.summary.overview.slice(0, 150);
                      systemMessageContent += `Key Discussion: ${takeaway}...\n`;
                    }
                    
                    if (meeting.summary?.action_items && Array.isArray(meeting.summary.action_items) && meeting.summary.action_items.length > 0) {
                      systemMessageContent += `Action Items: ${meeting.summary.action_items[0]}\n`;
                    }
                    
                    if (meeting.participants?.length > 0) {
                      systemMessageContent += `Participants: ${meeting.participants.slice(0, 3).join(', ')}\n`;
                    }
                  });
                } else {
                  systemMessageContent += `\nNo recent meetings found with ${claudeOrganizedData.brandName} in the last 30 days.\n`;
                }
                
                if (claudeOrganizedData.recentEmails?.length > 0) {
                  systemMessageContent += `\n**RECENT EMAILS:**\n`;
                  claudeOrganizedData.recentEmails.forEach(email => {
                    systemMessageContent += `\nEmail on ${new Date(email.receivedDate).toLocaleDateString()}: "${email.subject}"\n`;
                    systemMessageContent += `From: ${email.fromName || email.from}\n`;
                    if (email.preview) {
                      const quote = email.preview.slice(0, 100);
                      systemMessageContent += `They mentioned: "${quote}..."\n`;
                    }
                  });
                } else {
                  systemMessageContent += `\nNo recent emails found with ${claudeOrganizedData.brandName}.\n`;
                }
                
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
              else if (claudeOrganizedData.contextAnalysis) {
                if (claudeOrganizedData.queryType === 'valuable_meetings') {
                  systemMessageContent += `\n\n**MOST VALUABLE MEETINGS ${claudeOrganizedData.timeFrame.toUpperCase()}:**\n`;
                  
                  const highValueMeetings = claudeOrganizedData.valuableMeetings.filter(m => m.valueScore > 50);
                  
                  if (highValueMeetings.length > 0) {
                    highValueMeetings.forEach((meeting, index) => {
                      systemMessageContent += `\n${index + 1}. "${meeting.title}" on ${meeting.dateString}\n`;
                      systemMessageContent += `   Link: ${meeting.transcript_url}\n`;
                      systemMessageContent += `   Value Score: ${meeting.valueScore}/100\n`;
                      
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
              else if (claudeOrganizedData.contextOnly) {
                systemMessageContent += "\n\n**RECENT CONTEXT AND INSIGHTS:**\n";
                
                if (claudeOrganizedData.firefliesTranscripts?.length > 0) {
                  systemMessageContent += "\n**RECENT MEETINGS WITH KEY INSIGHTS:**\n";
                  claudeOrganizedData.firefliesTranscripts.forEach(t => {
                    systemMessageContent += `\nMeeting: "${t.title}" on ${t.dateString}\n`;
                    systemMessageContent += `Link: ${t.transcript_url}\n`;
                    systemMessageContent += `Participants: ${t.participants?.slice(0, 3).join(', ') || 'Not specified'}\n`;
                    
                    const overview = t.summary?.overview || '';
                    const topics = t.summary?.topics_discussed || '';
                    
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
            ).catch(err => {});
            
            const response = { 
              reply: aiReply,
              mcpThinking: mcpThinking || [],
              mcpRawOutput: mcpRawOutput || [],
              usedMCP: usedMCP
            };
            
            if (claudeOrganizedData && claudeOrganizedData.brandSuggestions) {
              response.brandSuggestions = claudeOrganizedData.brandSuggestions;
            }
            
            return res.json(response);
          } else {
            return res.status(500).json({ error: 'No text reply received.' });
          }
        } catch (error) {
          return res.status(500).json({ error: 'Error fetching response.', details: error.message });
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
