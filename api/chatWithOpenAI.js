import dotenv from 'dotenv';
import fetch from 'node-fetch';
import WebSocket from 'ws';

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
const hubspotAccessToken = process.env.HUBSPOT_ACCESS_TOKEN; // Add this to your Vercel env vars

// Your specific pipeline mapping
const YOUR_PIPELINES = {
  // Partnership Deals Pipeline
  'partnerships': {
    id: '115484704',
    name: '[IV] Partnership Deals [Fee & Trade]',
    stages: {
      'new_opportunity': '227286057',
      'project_brief_created': '205074829',
      'quote_discussion': '204588590',
      'fee_approved': '205087650',
      'partnership_activated': '204497432',
      'completed': '205074833',
      'failed': '205074834'
    }
  },
  // New Business Pipeline
  'new_business': {
    id: '108874645',
    name: '[IV] New Business & Contract Renewals Pipeline',
    stages: {
      'new_inquiry': '196170391',
      'meeting_scheduled': '196170394',
      'proposal_meeting': '196170395',
      'contract_sent': '196158029',
      'closed_won': '196158031',
      'closed_lost': '196158032'
    }
  },
  // Influencer Campaigns
  'influencer': {
    id: '114737106',
    name: '[IV] Influencer Campaigns Pipeline',
    stages: {
      'new_campaign': '938448781',
      'planning': '938448782',
      'content_live': '938448787',
      'closed_won': '938463385'
    }
  }
};

// Project configuration mapping - INCLUDING VOICE SETTINGS
const PROJECT_CONFIGS = {
  'default': {
    baseId: 'appTYnw2qIaBIGRbR',
    chatTable: 'EagleView_Chat',
    knowledgeTable: 'Chat-KnowledgeBase',
    voiceId: '21m00Tcm4TlvDq8ikWAM', // Default voice
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
    voiceId: 'GFj1cj74yBDgwZqlLwgS', // Professional pitch voice
    voiceSettings: {
      stability: 0.34,
      similarity_boost: 0.8,
      style: 0.5,
      use_speaker_boost: true
    }
  },
  'real-estate': {
    baseId: 'appYYYYYYYYYYYYYY', // Replace with actual base ID
    chatTable: 'RealEstate_Chat',
    knowledgeTable: 'RealEstate_Knowledge',
    voiceId: 'EXAVITQu4vr4xnSDxMaL', // Different voice for real estate
    voiceSettings: {
      stability: 0.6,
      similarity_boost: 0.8,
      style: 0.4,
      use_speaker_boost: true
    }
  },
  'healthcare': {
    baseId: 'appZZZZZZZZZZZZZZ', // Replace with actual base ID
    chatTable: 'Healthcare_Chat',
    knowledgeTable: 'Healthcare_Knowledge',
    voiceId: 'MF3mGyEYCl7XYWbV9V6O', // Calm, professional voice for healthcare
    voiceSettings: {
      stability: 0.7,
      similarity_boost: 0.7,
      style: 0.3,
      use_speaker_boost: false
    }
  }
  // Add more project configurations as needed
};

function getProjectConfig(projectId) {
  // Return the config for the projectId, or default if not found
  const config = PROJECT_CONFIGS[projectId] || PROJECT_CONFIGS['default'];
  
  // Log which config is being used (for debugging)
  console.log(`Using project config for: ${projectId || 'default'}`);
  
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

// Dynamic helper functions
function getPipelineName(pipelineId) {
  const pipelineMap = {
    '115484704': 'Partnership Deals',
    '108874645': 'New Business',
    '114737106': 'Influencer Campaigns',
    '115618560': 'Playbook Pipeline',
    '72395917': 'Blog & Podcast',
    // Add more as discovered
  };
  return pipelineMap[pipelineId] || `Pipeline ${pipelineId}`;
}

function getStageInfo(stageId, pipelineId) {
  // Dynamic stage mapping based on pipeline
  const stageData = {
    // Partnership stages
    '227286057': { label: 'New Opportunity', score: 5, isAdvanced: false },
    '205074829': { label: 'Brief Created', score: 10, isAdvanced: false },
    '204588590': { label: 'Quote Discussion', score: 20, isAdvanced: true },
    '205087650': { label: 'Fee Approved', score: 30, isAdvanced: true },
    '204497432': { label: 'Partnership Active', score: 35, isAdvanced: true },
    '205074833': { label: 'Completed', score: 40, isAdvanced: true },
    '205074834': { label: 'Failed', score: 0, isAdvanced: false },
    // New Business stages
    '196158031': { label: 'Closed Won', score: 40, isAdvanced: true },
    '196158032': { label: 'Closed Lost', score: 0, isAdvanced: false },
    '196158029': { label: 'Contract Sent', score: 25, isAdvanced: true },
    '196158030': { label: 'Contract Signed', score: 35, isAdvanced: true },
    // Playbook stages
    '205070213': { label: 'Playbook Complete', score: 30, isAdvanced: true },
    '204588588': { label: 'Strategy Presented', score: 25, isAdvanced: true },
    // Add more stages as needed
  };
  
  return stageData[stageId] || { label: 'In Progress', score: 5, isAdvanced: false };
}

// HubSpot API helper function
async function callHubSpotAPI(endpoint, method = 'GET', body = null) {
  if (!hubspotAccessToken) {
    console.warn('No HubSpot access token configured');
    return null;
  }

  try {
    const url = `https://api.hubapi.com${endpoint}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${hubspotAccessToken}`,
        'Content-Type': 'application/json'
      }
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
      console.error(`HubSpot API error: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('HubSpot API call failed:', error);
    return null;
  }
}

// Enhanced HubSpot search function with YOUR specific fields
async function searchHubSpot(query, searchType = 'deals', limit = 20, filters = null) {
  console.log('🔍 Searching HubSpot:', { query, searchType, limit });
  
  try {
    let endpoint = '';
    let searchBody = {
      limit,
      properties: []
    };

    switch (searchType) {
      case 'deals':
        endpoint = '/crm/v3/objects/deals/search';
        // Your actual HubSpot properties
        searchBody.properties = [
          'dealname', 
          'amount',
          'full_agreement_amount', // Gross Deal Amount
          'dealstage', 
          'closedate', 
          'pipeline',
          'description',
          'hs_object_id',
          'brand_name', // Your brand field
          'client_type', // Client categorization
          'has_the_sow_msa_been_added_', // Contract status
          'distributor', // Distribution partner
          'content_type', // Type of content
          'deal_type___available_for_', // Deal availability
          'partnership_fee__talent_', // Talent fee
          'partnership_fee__production_', // Production fee
          'production_title', // Production name
          'project_type', // Project categorization
          'partner_poc_email', // Partner contact
          'talent_partner' // Talent involved
        ];
        searchBody.sorts = [{ propertyName: 'amount', direction: 'DESCENDING' }];
        break;
      
      case 'contacts':
        endpoint = '/crm/v3/objects/contacts/search';
        searchBody.properties = ['firstname', 'lastname', 'email', 'company', 'phone', 'hs_object_id'];
        break;
      
      case 'companies':
        endpoint = '/crm/v3/objects/companies/search';
        searchBody.properties = [
          'name', 
          'industry', 
          'city', 
          'state', 
          'annualrevenue', 
          'description',
          'hs_object_id'
        ];
        break;
    }

    // Add intelligent query construction
    if (query) {
      searchBody.query = query;
    }
    
    // Add filters if provided
    if (filters) {
      searchBody.filterGroups = filters;
    }

    const data = await callHubSpotAPI(endpoint, 'POST', searchBody);
    
    if (!data || !data.results) {
      return { error: 'No data returned', records: [], total: 0 };
    }

    console.log(`✅ Got ${data.results.length} ${searchType} from HubSpot`);
    
    // Now get associations for deals
    if (searchType === 'deals' && data.results.length > 0) {
      console.log('🔗 Checking deal associations...');
      for (let deal of data.results) {
        try {
          // Check for contact associations
          const contactAssoc = await callHubSpotAPI(
            `/crm/v3/objects/deals/${deal.id}/associations/contacts`,
            'GET'
          );
          deal.hasContact = contactAssoc && contactAssoc.results && contactAssoc.results.length > 0;
          
          // Check for company associations
          const companyAssoc = await callHubSpotAPI(
            `/crm/v3/objects/deals/${deal.id}/associations/companies`,
            'GET'
          );
          deal.hasPartner = companyAssoc && companyAssoc.results && companyAssoc.results.length > 0;
        } catch (error) {
          console.log(`Could not get associations for deal ${deal.id}`);
          deal.hasContact = false;
          deal.hasPartner = false;
        }
      }
    }
    
    return {
      searchType,
      records: data.results,
      total: data.total
    };
    
  } catch (error) {
    console.error('❌ Error searching HubSpot:', error);
    return { error: error.message, records: [], total: 0 };
  }
}

// Your specific pipeline mapping
const YOUR_PIPELINES = {
  // Partnership Deals Pipeline
  'partnerships': {
    id: '115484704',
    name: '[IV] Partnership Deals [Fee & Trade]',
    stages: {
      'new_opportunity': '227286057',
      'project_brief_created': '205074829',
      'quote_discussion': '204588590',
      'fee_approved': '205087650',
      'partnership_activated': '204497432',
      'completed': '205074833',
      'failed': '205074834'
    }
  },
  // New Business Pipeline
  'new_business': {
    id: '108874645',
    name: '[IV] New Business & Contract Renewals Pipeline',
    stages: {
      'new_inquiry': '196170391',
      'meeting_scheduled': '196170394',
      'proposal_meeting': '196170395',
      'contract_sent': '196158029',
      'closed_won': '196158031',
      'closed_lost': '196158032'
    }
  },
  // Influencer Campaigns
  'influencer': {
    id: '114737106',
    name: '[IV] Influencer Campaigns Pipeline',
    stages: {
      'new_campaign': '938448781',
      'planning': '938448782',
      'content_live': '938448787',
      'closed_won': '938463385'
    }
  }
};

// Intelligent project analysis for YOUR business
function analyzeProjectForMatching(userMessage) {
  const analysis = {
    genres: [],
    themes: [],
    demographics: [],
    priceRange: null,
    keywords: [],
    cast: [],
    setting: [],
    timeline: null,
    productionStage: null,
    projectType: null
  };
  
  const messageLower = userMessage.toLowerCase();
  
  // Detect production stages based on YOUR pipeline stages
  if (messageLower.includes('pre-production') || messageLower.includes('3-4 weeks')) {
    analysis.timeline = 'pre-production';
    analysis.productionStage = 'Pre-production';
  } else if (messageLower.includes('development') || messageLower.includes('planning')) {
    analysis.timeline = 'development';
    analysis.productionStage = 'Development';
  } else if (messageLower.includes('post') || messageLower.includes('completed')) {
    analysis.timeline = 'post-production';
    analysis.productionStage = 'Post-Production';
  }
  
  // Extract genres
  const genrePatterns = {
    'sports': ['olympic', 'hockey', 'skier', 'athlete', 'games', 'sports', 'football', 'basketball', 'soccer', 'athletic'],
    'romance': ['romance', 'love', 'relationship', 'dating', 'romantic'],
    'family': ['family', 'kids', 'children', 'parent', 'animated'],
    'action': ['action', 'thriller', 'explosive', 'chase', 'fight'],
    'comedy': ['comedy', 'funny', 'humor', 'laugh', 'hilarious'],
    'documentary': ['documentary', 'doc', 'real story', 'true story'],
    'series': ['series', 'season', 'episode', 'renewed'],
    'reality': ['reality', 'unscripted', 'competition']
  };
  
  for (const [genre, keywords] of Object.entries(genrePatterns)) {
    if (keywords.some(kw => messageLower.includes(kw))) {
      analysis.genres.push(genre);
    }
  }
  
  // Extract themes
  if (messageLower.includes('winter') || messageLower.includes('cold') || messageLower.includes('snow')) {
    analysis.themes.push('winter');
    analysis.setting.push('cold climate');
  }
  if (messageLower.includes('olympic') || messageLower.includes('competition')) {
    analysis.themes.push('competition');
    analysis.themes.push('achievement');
  }
  if (messageLower.includes('evergreen')) {
    analysis.themes.push('evergreen');
  }
  if (messageLower.includes('holiday') || messageLower.includes('christmas')) {
    analysis.themes.push('holiday');
    analysis.themes.push('seasonal');
  }
  
  // Extract price range (looking for patterns like 1.5M+, $2M, etc.)
  const priceMatch = userMessage.match(/\$?(\d+(?:\.\d+)?)\s*M\+?/i);
  if (priceMatch) {
    analysis.priceRange = parseFloat(priceMatch[1]) * 1000000;
  }
  
  // Extract distributor if mentioned
  const distributorMatch = userMessage.match(/distributor:\s*([^,\n]+)/i);
  if (distributorMatch) {
    analysis.distributor = distributorMatch[1].trim();
  }
  
  // Extract cast
  const castMatch = userMessage.match(/cast:\s*([^\.]+)/i);
  if (castMatch) {
    analysis.cast = castMatch[1].split(',').map(name => name.trim());
  }
  
  // Extract key product categories based on context
  if (analysis.genres.includes('sports') || analysis.themes.includes('competition')) {
    analysis.keywords.push('athletic', 'performance', 'energy', 'sports drink', 'equipment', 'fitness');
  }
  if (analysis.themes.includes('winter')) {
    analysis.keywords.push('cold weather', 'warm', 'comfort', 'seasonal', 'thermal');
  }
  if (analysis.genres.includes('family')) {
    analysis.keywords.push('family-friendly', 'kids', 'snacks', 'toys', 'entertainment');
  }
  if (analysis.genres.includes('reality')) {
    analysis.keywords.push('lifestyle', 'consumer goods', 'home products');
  }
  
  return analysis;
}

// Stage 1: Enhanced search function that returns structured data for Claude
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
      baseId: 'apphslK7rslGb7Z8K', // Your actual base ID
      searchMappings: {
        'meetings': {
          table: 'Meeting Steam', // Your actual table name
          view: 'ALL Meetings', // Could use a filtered view like 'Recent 30 Days'
          fields: ['Title', 'Date', 'Summary', 'Link']
        },
        'brands': {
          table: 'Brands', // Your actual table name
          view: null, // Could use 'Active Brands' view
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
    
    // Return raw data for next stage
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

// Stage 2: OpenAI narrowing function
async function narrowWithOpenAI(brands, meetings, userMessage) {
  try {
    console.log(`🧮 Stage 2: Narrowing ${brands.length} brands with OpenAI...`);
    
    // Only process if we have brands
    if (!brands || brands.length === 0) {
      return { topBrands: [], scores: {} };
    }
    
    // Create a lightweight scoring prompt
    const scoringPrompt = `
Production details: ${userMessage}

Score these brands 0-100 based on relevance to this specific production.
Consider: genre fit, budget alignment, campaign focus match, and natural integration opportunities.
Higher scores for brands that naturally fit the production's themes, setting, and audience.

Return ONLY a JSON object with brand names as keys and scores as values.

Brands to evaluate:
${brands.slice(0, 50).map(b => 
  `${b.fields['Brand Name']}: ${b.fields['Category'] || 'General'}, Budget: ${b.fields['Budget'] || 'TBD'}, Focus: ${(b.fields['Campaign Summary'] || '').slice(0, 100)}`
).join('\n')}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAIApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo-1106', // Fast, cheap, good at JSON
        messages: [
          {
            role: 'system',
            content: 'You are a relevance scoring engine for brand-production matching. Analyze the production details and score each brand based on natural fit. Return only valid JSON with brand names as keys and numeric scores 0-100 as values.'
          },
          {
            role: 'user',
            content: scoringPrompt
          }
        ],
        temperature: 0.3, // Low for consistency
        max_tokens: 800,
        response_format: { type: "json_object" }
      }),
    });
    
    if (!response.ok) {
      console.error('OpenAI scoring error:', response.status);
      // If OpenAI fails, just return all brands
      return { topBrands: brands.slice(0, 15), scores: {} };
    }
    
    const data = await response.json();
    const scores = JSON.parse(data.choices[0].message.content);
    
    // Sort brands by score and take top 15
    const topBrands = brands
      .filter(b => b.fields['Brand Name']) // Ensure brand has a name
      .map(b => ({
        ...b,
        relevanceScore: scores[b.fields['Brand Name']] || 0
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 15);
    
    console.log(`✅ Stage 2 complete: Narrowed to ${topBrands.length} top brands`);
    console.log(`🏆 Top 3: ${topBrands.slice(0, 3).map(b => `${b.fields['Brand Name']} (${b.relevanceScore})`).join(', ')}`);
    
    return { topBrands, scores };
    
  } catch (error) {
    console.error('❌ Error in OpenAI narrowing:', error);
    // On error, just return first 15 brands
    return { topBrands: brands.slice(0, 15), scores: {} };
  }
}

// Enhanced Claude search handler that includes HubSpot data
async function handleClaudeSearchWithHubSpot(userMessage, knowledgeBaseInstructions, projectId, sessionId) {
  console.log('🤖 Starting enhanced brand-project matching with HubSpot data...');
  
  if (!anthropicApiKey) {
    console.warn('No Anthropic API key found, falling back to OpenAI');
    return null;
  }
  
  try {
    // Stage 1: Get data from both Airtable AND HubSpot
    console.log('📊 Stage 1: Fetching from Airtable and HubSpot...');
    
    // Your existing Airtable searches
    const brandData = await searchAirtable(userMessage, projectId, 'brands', 100);
    const meetingData = await searchAirtable(userMessage, projectId, 'meetings', 50);
    
    // NEW: Add HubSpot searches with intelligent filtering
    let hubspotDeals = null;
    let hubspotContacts = null;
    let hubspotCompanies = null;
    
    if (hubspotAccessToken) {
      console.log('🔍 Analyzing project for intelligent HubSpot matching...');
      
      // Analyze the project to understand what we're looking for
      const projectAnalysis = analyzeProjectForMatching(userMessage);
      console.log('📊 Project analysis:', projectAnalysis);
      
      // Build intelligent search queries based on project analysis
      const searchQueries = [];
      
      // Dynamic query building based on actual project content
      if (projectAnalysis.genres.length > 0) {
        projectAnalysis.genres.forEach(genre => {
          if (genre === 'sports') searchQueries.push('athletic OR sports OR energy OR fitness');
          if (genre === 'family') searchQueries.push('family OR kids OR toys OR snacks');
          if (genre === 'romance') searchQueries.push('lifestyle OR beauty OR dating');
          // Add more genre mappings as needed
        });
      }
      
      if (projectAnalysis.themes.length > 0) {
        projectAnalysis.themes.forEach(theme => {
          searchQueries.push(theme);
        });
      }
      
      // Add keywords from analysis
      if (projectAnalysis.keywords.length > 0) {
        searchQueries.push(projectAnalysis.keywords.join(' OR '));
      }
      
      // Search for ALL relevant deals, not just partnership pipeline
      const dealQuery = searchQueries.length > 0 ? searchQueries.join(' OR ') : '';
      
      // Get deals from multiple pipelines
      const allDeals = await searchHubSpot(dealQuery, 'deals', 100); // Get more deals for better matching
      
      // Also search for brand playbooks specifically
      let playbookDeals = null;
      if (hubspotAccessToken) {
        // Search in Playbook Pipeline
        const playbookFilters = [{
          filters: [
            {
              propertyName: 'pipeline',
              operator: 'EQ',
              value: '115618560' // Your Playbook Pipeline ID
            }
          ]
        }];
        playbookDeals = await searchHubSpot('', 'deals', 50, playbookFilters);
        console.log(`📚 Found ${playbookDeals?.records?.length || 0} playbook deals`);
      }
      
      // Merge all deals and remove duplicates
      hubspotDeals = allDeals;
      if (playbookDeals && playbookDeals.records) {
        const existingIds = new Set(hubspotDeals.records.map(d => d.id));
        playbookDeals.records.forEach(deal => {
          if (!existingIds.has(deal.id)) {
            hubspotDeals.records.push(deal);
          }
        });
      }
      
      // After getting deals, analyze them based on YOUR fields
      if (hubspotDeals && hubspotDeals.records) {
        console.log(`🔍 Analyzing ${hubspotDeals.records.length} total deals...`);
        
        hubspotDeals.records = hubspotDeals.records.map(deal => {
          // Dynamic scoring based on actual data
          deal.qualityScore = 0;
          deal.qualityFactors = [];
          deal.insights = [];
          
          // Extract actual brand name
          const brandName = deal.properties.brand_name || 
                           deal.properties.dealname || 
                           'Unknown Brand';
          
          // Check associations (real data)
          if (deal.hasContact) {
            deal.qualityScore += 15;
            deal.qualityFactors.push('Has contact');
          }
          
          if (deal.hasPartner) {
            deal.qualityScore += 15;
            deal.qualityFactors.push('Partner attached');
          }
          
          // Pipeline scoring - dynamic based on actual pipeline
          const pipelineName = getPipelineName(deal.properties.pipeline);
          if (deal.properties.pipeline === '115484704') { // Partnership
            deal.qualityScore += 25;
            deal.qualityFactors.push('Partnership deal');
          } else if (deal.properties.pipeline === '115618560') { // Playbook
            deal.qualityScore += 20;
            deal.qualityFactors.push('Has playbook');
            deal.insights.push('Brand strategy documented');
          }
          
          // Stage scoring - based on actual stage progress
          const stageInfo = getStageInfo(deal.properties.dealstage, deal.properties.pipeline);
          if (stageInfo.isAdvanced) {
            deal.qualityScore += stageInfo.score;
            deal.qualityFactors.push(stageInfo.label);
          }
          
          // Contract status
          if (deal.properties.has_the_sow_msa_been_added_ === 'Yes') {
            deal.qualityScore += 20;
            deal.qualityFactors.push('Contract ready');
          }
          
          // Budget alignment - dynamic calculation
          const dealAmount = parseInt(deal.properties.amount || deal.properties.full_agreement_amount || 0);
          if (projectAnalysis.priceRange && dealAmount > 0) {
            const ratio = dealAmount / projectAnalysis.priceRange;
            if (ratio >= 0.8 && ratio <= 1.5) {
              deal.qualityScore += 20;
              deal.qualityFactors.push(`Budget aligned (${Math.round(ratio * 100)}%)`);
            }
          }
          
          // Theme matching - dynamic based on actual content
          let themeMatchCount = 0;
          const dealContent = `${deal.properties.dealname} ${deal.properties.description || ''} ${deal.properties.brand_name || ''}`.toLowerCase();
          
          projectAnalysis.themes.forEach(theme => {
            if (dealContent.includes(theme.toLowerCase())) {
              themeMatchCount++;
            }
          });
          
          projectAnalysis.keywords.forEach(keyword => {
            if (dealContent.includes(keyword.toLowerCase())) {
              themeMatchCount++;
            }
          });
          
          if (themeMatchCount > 0) {
            deal.qualityScore += (themeMatchCount * 10);
            deal.insights.push(`Matches ${themeMatchCount} project themes`);
          }
          
          // Distributor match if applicable
          if (deal.properties.distributor && projectAnalysis.distributor) {
            if (deal.properties.distributor.toLowerCase().includes(projectAnalysis.distributor.toLowerCase())) {
              deal.qualityScore += 15;
              deal.qualityFactors.push('Matching distributor');
            }
          }
          
          // Add all relevant deal info
          deal.brandName = brandName;
          deal.dealAmount = dealAmount;
          deal.pipelineName = pipelineName;
          deal.stageLabel = stageInfo.label;
          
          return deal;
        });
        
        // Sort by quality score
        hubspotDeals.records.sort((a, b) => b.qualityScore - a.qualityScore);
      }
      
      // If we have brand names from Airtable, also search for those in HubSpot
      if (topBrands && topBrands.length > 0) {
        const brandNames = topBrands
          .slice(0, 5)
          .map(b => b.fields['Brand Name'])
          .filter(Boolean);
        
        if (brandNames.length > 0) {
          const brandQuery = brandNames.map(name => `"${name}"`).join(' OR ');
          const brandSpecificDeals = await searchHubSpot(brandQuery, 'deals', 10);
          
          // Merge results intelligently
          if (brandSpecificDeals.records.length > 0) {
            console.log(`🎯 Found ${brandSpecificDeals.records.length} deals matching Airtable brands`);
            // Add to existing deals but avoid duplicates
            const existingIds = new Set(hubspotDeals.records.map(d => d.id));
            brandSpecificDeals.records.forEach(deal => {
              if (!existingIds.has(deal.id)) {
                hubspotDeals.records.push(deal);
              }
            });
          }
        }
      }
      
      // Search for relevant companies based on industry
      if (projectAnalysis.keywords.length > 0) {
        const companyQuery = projectAnalysis.keywords.slice(0, 3).join(' OR ');
        hubspotCompanies = await searchHubSpot(companyQuery, 'companies', 10);
      }
    } else {
      console.log('❌ No HubSpot token configured');
    }
    
    // Check if we got actual data
      
      // Search for contacts if query mentions people or contacts
      if (userMessage.toLowerCase().includes('contact') ||
          userMessage.toLowerCase().includes('person') ||
          userMessage.toLowerCase().includes('people')) {
        hubspotContacts = await searchHubSpot(userMessage, 'contacts', 10);
      }
    }
    
    // Stage 2: Narrow with OpenAI (your existing logic)
    const { topBrands, scores } = await narrowWithOpenAI(
      brandData.records, 
      meetingData.records, 
      userMessage
    );
    
    // Stage 3: Deep analysis with Claude including HubSpot data
    console.log('🧠 Stage 3: Claude deep analysis with all data sources...');
    
    // Start with the knowledge base instructions
    let systemPrompt = knowledgeBaseInstructions || "You are a helpful assistant specialized in AI & Automation.";
    
    // Add the narrowed data context
    systemPrompt += "\n\n**PRIORITY CONTEXT FROM YOUR BUSINESS DATA:**\n\n";
    
    // Your existing brand data formatting
    if (topBrands && topBrands.length > 0) {
      systemPrompt += "**TOP RELEVANT BRANDS (from Airtable):**\n```json\n";
      const brandInfo = topBrands.map(b => ({
        brand: b.fields['Brand Name'] || 'Unknown',
        relevance_score: b.relevanceScore || 0,
        budget: b.fields['Budget'] || 0,
        category: b.fields['Category'] || 'Uncategorized',
        campaign_focus: b.fields['Campaign Summary'] || 'No campaign info',
        last_activity: b.fields['Last Modified'] || 'Unknown'
      }));
      
      systemPrompt += JSON.stringify(brandInfo, null, 2);
      systemPrompt += "\n```\n\n";
    }
    
    // NEW: Add HubSpot deals data
    if (hubspotDeals && hubspotDeals.records && hubspotDeals.records.length > 0) {
      systemPrompt += "**HUBSPOT DEALS & OPPORTUNITIES:**\n```json\n";
      const dealsInfo = hubspotDeals.records.map(deal => ({
        deal_name: deal.properties.dealname,
        amount: deal.properties.amount ? `$${parseInt(deal.properties.amount).toLocaleString()}` : 'Not specified',
        stage: deal.properties.dealstage,
        close_date: deal.properties.closedate,
        pipeline: deal.properties.pipeline
      }));
      
      systemPrompt += JSON.stringify(dealsInfo, null, 2);
      systemPrompt += "\n```\n\n";
      
      console.log(`💼 Sending ${dealsInfo.length} HubSpot deals to Claude`);
    }
    
    // NEW: Add HubSpot contacts data
    if (hubspotContacts && hubspotContacts.records && hubspotContacts.records.length > 0) {
      systemPrompt += "**HUBSPOT CONTACTS:**\n```json\n";
      const contactsInfo = hubspotContacts.records.map(contact => ({
        name: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim(),
        email: contact.properties.email,
        company: contact.properties.company,
        phone: contact.properties.phone
      }));
      
      systemPrompt += JSON.stringify(contactsInfo, null, 2);
      systemPrompt += "\n```\n\n";
      
      console.log(`👥 Sending ${contactsInfo.length} HubSpot contacts to Claude`);
    }
    
    // Your existing meeting data formatting
    if (meetingData && meetingData.records && meetingData.records.length > 0) {
      systemPrompt += "**RECENT MEETINGS & DISCUSSIONS (from Airtable):**\n```json\n";
      const meetingInfo = meetingData.records
        .filter(r => r.fields['Summary'] && r.fields['Summary'].length > 10)
        .slice(0, 20)
        .map(r => ({
          meeting: r.fields['Title'] || 'Untitled',
          date: r.fields['Date'] || 'No date',
          key_points: r.fields['Summary'] || 'No summary',
          link: r.fields['Link'] || null
        }));
      
      systemPrompt += JSON.stringify(meetingInfo, null, 2);
      systemPrompt += "\n```\n\n";
    }
    
    // Dynamic instructions based on actual data
    systemPrompt += `
When providing brand matching insights:
- Analyze the actual data from HubSpot dynamically - don't use preset examples
- Look for brands that have documented playbooks (in Playbook Pipeline) for strategic insights
- Score and rank brands based on multiple factors:
  * Pipeline type and stage progress
  * Budget alignment with production
  * Theme/genre matches in brand descriptions
  * Contract/legal readiness
  * Contact and partner availability
  * Historical success indicators

- Provide insights specific to each brand:
  * If has playbook: mention their documented strategy
  * If in partnership pipeline: note the exact stage and what's needed
  * If budget matches: show the percentage alignment
  * If themes match: explain which themes connect

- Be specific about next steps:
  * Fee Approved deals: "Ready to activate, just needs final paperwork"
  * Quote Discussion: "In active negotiation, decision expected [timeframe]"
  * Has Playbook: "Strategy documented for [specific approach]"

- Format responses with real data:
  * Use actual brand names from brand_name field
  * Show real amounts from amount/full_agreement_amount
  * Reference actual pipeline stages
  * Include any production_title matches

Never use generic examples - always pull from the actual HubSpot data provided.
`;
    
    console.log('📤 Calling Claude API with combined Airtable + HubSpot data...');
    
    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        temperature: 0.7,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userMessage
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
    console.log('✅ Claude API response received');
    
    if (data.content && data.content.length > 0) {
      const reply = data.content[0].text;
      
      // Enhanced MCP thinking to include HubSpot insights
      const mcpThinking = [];
      
      // Add data source summary FIRST
      const dataSources = [];
      if (brandData.total > 0) dataSources.push(`${brandData.total} brands`);
      if (meetingData.total > 0) dataSources.push(`${meetingData.total} meetings`);
      if (hubspotDeals && hubspotDeals.total > 0) dataSources.push(`${hubspotDeals.total} HubSpot deals`);
      if (hubspotContacts && hubspotContacts.total > 0) dataSources.push(`${hubspotContacts.total} HubSpot contacts`);
      
      if (dataSources.length > 0) {
        mcpThinking.push(`Searched: ${dataSources.join(', ')}`);
      }
      
      // Add HubSpot insights if we have them
      if (hubspotDeals && hubspotDeals.records && hubspotDeals.records.length > 0) {
        // Calculate total pipeline value
        const totalPipeline = hubspotDeals.records
          .reduce((sum, deal) => sum + (parseInt(deal.properties.amount) || 0), 0);
        
        // Get top 3 deals
        const topDeals = hubspotDeals.records
          .slice(0, 3)
          .map(deal => {
            const amount = parseInt(deal.properties.amount) || 0;
            return `${deal.properties.dealname} (${amount.toLocaleString()})`;
          })
          .filter(Boolean);
        
        if (totalPipeline > 0) {
          mcpThinking.push(`HubSpot pipeline: ${totalPipeline.toLocaleString()}`);
        }
        if (topDeals.length > 0) {
          mcpThinking.push(`Top HubSpot deals: ${topDeals.join(', ')}`);
        }
      }
      
      // Your existing brand insights
      if (topBrands.length > 0 && scores) {
        const topThree = topBrands
          .slice(0, 3)
          .map(b => `${b.fields['Brand Name']} (${b.relevanceScore})`)
          .filter(Boolean);
        if (topThree.length > 0) {
          mcpThinking.push(`Top Airtable brands: ${topThree.join(', ')}`);
        }
      }
      
      return {
        reply,
        mcpThinking,
        usedMCP: true
      };
    }
    
    return null;
    
  } catch (error) {
    console.error('❌ Error in enhanced Claude search:', error);
    return null;
  }
}

// Stage 3: Claude-powered search handler for intelligent brand matching (keeping original for backward compatibility)
async function handleClaudeSearch(userMessage, knowledgeBaseInstructions, projectId, sessionId) {
  // This now calls the enhanced version
  return handleClaudeSearchWithHubSpot(userMessage, knowledgeBaseInstructions, projectId, sessionId);
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

      // IMPROVED Search Query Detection - only for brand matching requests
      const isBrandMatchingQuery = userMessage && (
        // Direct brand requests
        userMessage.toLowerCase().includes('brand') ||
        userMessage.toLowerCase().includes('match') ||
        userMessage.toLowerCase().includes('integration') ||
        userMessage.toLowerCase().includes('partnership') ||
        // Suggestion button phrases
        userMessage.toLowerCase().includes('easy money') ||
        userMessage.toLowerCase().includes('wildcard') ||
        userMessage.toLowerCase().includes('audience match') ||
        userMessage.toLowerCase().includes('hot new brands') ||
        userMessage.toLowerCase().includes('fits the story') ||
        userMessage.toLowerCase().includes('save production money') ||
        // Production context phrases
        userMessage.toLowerCase().includes('for this project') ||
        userMessage.toLowerCase().includes('for this production') ||
        userMessage.toLowerCase().includes('upcoming') ||
        userMessage.toLowerCase().includes('synopsis') ||
        // HubSpot specific queries
        userMessage.toLowerCase().includes('hubspot') ||
        userMessage.toLowerCase().includes('crm') ||
        userMessage.toLowerCase().includes('deal') ||
        userMessage.toLowerCase().includes('opportunit') ||
        userMessage.toLowerCase().includes('pipeline') ||
        userMessage.toLowerCase().includes('highest') ||
        userMessage.toLowerCase().includes('value') ||
        userMessage.toLowerCase().includes('revenue')
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

          // Try Claude for brand matching queries
          if (isBrandMatchingQuery && anthropicApiKey) {
            console.log('🎯 Brand matching query detected - attempting Claude...');
            console.log('🔑 Anthropic API key:', anthropicApiKey ? 'Present' : 'MISSING!');
            
            const claudeResult = await handleClaudeSearchWithHubSpot(
              userMessage, 
              knowledgeBaseInstructions, 
              projectId, 
              sessionId
            );
            
            if (claudeResult) {
              aiReply = claudeResult.reply;
              mcpThinking = claudeResult.mcpThinking;
              usedMCP = true;
              console.log('✅ Used Claude for intelligent brand matching');
              console.log('🧠 MCP Thinking:', mcpThinking);
            } else {
              console.log('⚠️ Claude failed or returned null, falling back to OpenAI');
            }
          } else {
            if (!isBrandMatchingQuery) {
              console.log('❌ Not a brand matching query - using OpenAI');
            }
            if (!anthropicApiKey) {
              console.log('❌ No Anthropic API key - using OpenAI');
            }
          }
          
          // Fall back to OpenAI if Claude didn't handle it
          if (!aiReply) {
            console.log('📝 Using OpenAI for response');
            
            // Build system message
            let systemMessageContent = knowledgeBaseInstructions || "You are a helpful assistant specialized in AI & Automation.";
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
