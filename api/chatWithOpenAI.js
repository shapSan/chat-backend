import dotenv from 'dotenv';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import RunwayML from '@runwayml/sdk';

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
    
    // Parse the query to understand what's being asked
    const queryLower = query.toLowerCase();
    const needsProductions = queryLower.includes('production') || 
                           queryLower.includes('project') ||
                           queryLower.includes('upcoming') ||
                           queryLower.includes('deal') ||
                           queryLower.includes('partnership');
    
    // Search for brands/companies
    const brandsData = await hubspotAPI.searchBrands({ limit });
    
    // Enrich brands with contact data (only for top brands to avoid rate limits)
    const enrichedBrands = await Promise.all(
      brandsData.results.slice(0, 10).map(async (brand) => {
        const contacts = await hubspotAPI.getContactsForCompany(brand.id);
        return {
          id: brand.id,
          properties: brand.properties,
          contacts: contacts
        };
      })
    );
    
    // Add remaining brands without contact enrichment
    if (brandsData.results.length > 10) {
      brandsData.results.slice(10).forEach(brand => {
        enrichedBrands.push({
          id: brand.id,
          properties: brand.properties,
          contacts: []
        });
      });
    }
    
    // Search for productions/partnerships (stored as Deals)
    let productions = [];
    if (needsProductions) {
      const productionsData = await hubspotAPI.searchProductions({ limit: 30 });
      productions = productionsData.results || [];
    }
    
    console.log(`✅ HubSpot search complete: ${enrichedBrands.length} brands, ${productions.length} productions`);
    
    return {
      brands: enrichedBrands,
      productions: productions
    };
    
  } catch (error) {
    console.error('❌ Error searching HubSpot:', error);
    return { brands: [], productions: [] };
  }
}

// Stage 2: Enhanced narrowing that includes HubSpot data
async function narrowWithOpenAI(airtableBrands, hubspotBrands, meetings, userMessage) {
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
    
    if (allBrands.length === 0) {
      return { topBrands: [], scores: {} };
    }
    
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
    const scores = JSON.parse(data.choices[0].message.content);
    
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
    
    // Use the enhanced message for searching
    const [airtableData, hubspotData] = await Promise.all([
      searchAirtable(enhancedMessage, projectId, 'brands', 100),
      hubspotApiKey ? searchHubSpot(enhancedMessage, projectId, 50) : { brands: [], productions: [] }
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
      enhancedMessage  // Use enhanced message here too
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
        claudeSummary: organizedData,
        currentProduction: currentProduction  // Pass production context
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
  ratio = '1280:720',
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
        
        const { promptText, promptImage, projectId, model, ratio, duration } = req.body;

        if (!promptText) {
          return res.status(400).json({ 
            error: 'Missing required fields',
            details: 'promptText is required'
          });
        }

        if (!runwayApiKey) {
          console.error('Runway API key not configured');
          return res.status(500).json({ 
            error: 'Video generation service not configured',
            details: 'Please configure RUNWAY_API_KEY in Vercel environment variables'
          });
        }

        try {
          if (!promptImage.startsWith('http') && !promptImage.startsWith('data:')) {
            return res.status(400).json({
              error: 'Invalid image format',
              details: 'promptImage must be a valid URL or base64 data URL'
            });
          }
          
          let imageToUse = promptImage;
          if (promptImage.includes('dummyimage.com')) {
            console.log('⚠️ Replacing dummyimage.com with a proper test image');
            imageToUse = 'https://images.unsplash.com/photo-1497215842964-222b430dc094?w=1280&h=720&fit=crop';
          }
          
          const { url, taskId } = await generateRunwayVideo({
            promptText,
            promptImage: imageToUse,
            model: model || 'gen4_turbo',
            ratio: ratio || '1280:720',
            duration: duration || 5
          });

          console.log('✅ Video generated successfully:', taskId);

          return res.status(200).json({
            success: true,
            videoUrl: url,
            taskId,
            model: model || 'gen4_turbo'
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
  
  const { prompt, projectId, sessionId } = req.body;

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
    
    const imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAIApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-image-1',  // Using DALL-E 3 instead of gpt-image-1
        prompt: prompt,
        n: 1,
        size: '1792x1024',  // 16:9 landscape format
        quality: 'standard',
        response_format: 'url'
      })
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
        const errorJson = JSON.parse(errorData);
        return res.status(400).json({ 
          error: 'Invalid request',
          details: errorJson.error?.message || 'Invalid image generation parameters'
        });
      }
      
      return res.status(imageResponse.status).json({ 
        error: 'Failed to generate image',
        details: errorData
      });
    }

    const data = await imageResponse.json();
    console.log('✅ Image generated successfully');

    if (data.data && data.data.length > 0 && data.data[0].url) {
      return res.status(200).json({
        success: true,
        imageUrl: data.data[0].url,
        revisedPrompt: data.data[0].revised_prompt || prompt
      });
    } else {
      throw new Error('No image URL in response');
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

      // Enhanced search query detection
      const isBrandMatchingQuery = userMessage && (
        userMessage.toLowerCase().includes('brand') ||
        userMessage.toLowerCase().includes('match') ||
        userMessage.toLowerCase().includes('integration') ||
        userMessage.toLowerCase().includes('partnership') ||
        userMessage.toLowerCase().includes('easy money') ||
        userMessage.toLowerCase().includes('wildcard') ||
        userMessage.toLowerCase().includes('audience match') ||
        userMessage.toLowerCase().includes('hot new brands') ||
        userMessage.toLowerCase().includes('fits the story') ||
        userMessage.toLowerCase().includes('save production money') ||
        userMessage.toLowerCase().includes('for this project') ||
        userMessage.toLowerCase().includes('for this production') ||
        userMessage.toLowerCase().includes('upcoming') ||
        userMessage.toLowerCase().includes('synopsis')
      );
      
      console.log('🔍 Brand matching detection:', { isBrandMatchingQuery, userMessage: userMessage?.slice(0, 50) });

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
          if (isBrandMatchingQuery && anthropicApiKey) {
            console.log('🎯 Brand matching query detected - attempting Claude MCP data gathering...');
            console.log('🔑 API keys:', {
              anthropic: anthropicApiKey ? 'Present' : 'MISSING!',
              hubspot: hubspotApiKey ? 'Present' : 'MISSING!'
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
            if (!isBrandMatchingQuery) {
              console.log('❌ Not a brand matching query - using standard OpenAI');
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
