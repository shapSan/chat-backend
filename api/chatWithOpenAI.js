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
  console.log(Using project config for: ${projectId || 'default'});
  
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

// HubSpot API helper function
async function callHubSpotAPI(endpoint, method = 'GET', body = null) {
  if (!hubspotAccessToken) {
    console.warn('No HubSpot access token configured');
    return null;
  }

  try {
    const url = https://api.hubapi.com${endpoint};
    const options = {
      method,
      headers: {
        'Authorization': Bearer ${hubspotAccessToken},
        'Content-Type': 'application/json'
      }
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
      console.error(HubSpot API error: ${response.status});
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('HubSpot API call failed:', error);
    return null;
  }
}

// HubSpot search function to match your existing searchAirtable pattern
async function searchHubSpot(query, searchType = 'deals', limit = 20) {
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
        searchBody.properties = ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline'];
        searchBody.sorts = [{ propertyName: 'amount', direction: 'DESCENDING' }];
        break;
      
      case 'contacts':
        endpoint = '/crm/v3/objects/contacts/search';
        searchBody.properties = ['firstname', 'lastname', 'email', 'company', 'phone'];
        break;
      
      case 'companies':
        endpoint = '/crm/v3/objects/companies/search';
        searchBody.properties = ['name', 'industry', 'city', 'state', 'annualrevenue'];
        break;
    }

    // Add query if provided
    if (query) {
      searchBody.query = query;
    }

    const data = await callHubSpotAPI(endpoint, 'POST', searchBody);
    
    if (!data || !data.results) {
      return { error: 'No data returned', records: [], total: 0 };
    }

    console.log(✅ Got ${data.results.length} ${searchType} from HubSpot);
    
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
    let url = https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent(searchConfig.table)};
    const params = [maxRecords=${limit}];
    
    if (searchConfig.view) {
      params.push(view=${encodeURIComponent(searchConfig.view)});
    }
    
    searchConfig.fields.forEach(field => {
      params.push(fields[]=${encodeURIComponent(field)});
    });
    
    url += '?' + params.join('&');
    
    console.log('📡 Fetching from Airtable URL:', url);
    
    // Fetch from Airtable
    const response = await fetch(url, {
      headers: {
        'Authorization': Bearer ${airtableApiKey},
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Airtable API error:', response.status, errorText);
      throw new Error(Airtable API error: ${response.status} - ${errorText});
    }
    
    const data = await response.json();
    console.log(✅ Stage 1 complete: Got ${data.records.length} ${searchType} from Airtable);
    
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
    console.log(🧮 Stage 2: Narrowing ${brands.length} brands with OpenAI...);
    
    // Only process if we have brands
    if (!brands || brands.length === 0) {
      return { topBrands: [], scores: {} };
    }
    
    // Create a lightweight scoring prompt
    const scoringPrompt = 
Production details: ${userMessage}

Score these brands 0-100 based on relevance to this specific production.
Consider: genre fit, budget alignment, campaign focus match, and natural integration opportunities.
Higher scores for brands that naturally fit the production's themes, setting, and audience.

Return ONLY a JSON object with brand names as keys and scores as values.

Brands to evaluate:
${brands.slice(0, 50).map(b => 
  ${b.fields['Brand Name']}: ${b.fields['Category'] || 'General'}, Budget: ${b.fields['Budget'] || 'TBD'}, Focus: ${(b.fields['Campaign Summary'] || '').slice(0, 100)}
).join('\n')};

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: Bearer ${openAIApiKey},
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
    
    console.log(✅ Stage 2 complete: Narrowed to ${topBrands.length} top brands);
    console.log(🏆 Top 3: ${topBrands.slice(0, 3).map(b => ${b.fields['Brand Name']} (${b.relevanceScore})).join(', ')});
    
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
    
    // NEW: Add HubSpot searches
    let hubspotDeals = null;
    let hubspotContacts = null;
    
    if (hubspotAccessToken) {
      // Always search HubSpot for brand matching queries to get comprehensive data
      console.log('🔍 HubSpot token present, searching for deals...');
      hubspotDeals = await searchHubSpot('', 'deals', 10); // Empty query gets all deals sorted by value
      
      // Also search for contacts if specifically mentioned
      if (userMessage.toLowerCase().includes('contact') ||
          userMessage.toLowerCase().includes('person') ||
          userMessage.toLowerCase().includes('people')) {
        console.log('🔍 Also searching HubSpot contacts...');
        hubspotContacts = await searchHubSpot(userMessage, 'contacts', 10);
      }
    } else {
      console.log('❌ No HubSpot token configured');
    }
    
    // Check if we got actual data
    if ((!brandData.records || brandData.records.length === 0) && 
        (!meetingData.records || meetingData.records.length === 0) &&
        (!hubspotDeals || !hubspotDeals.records || hubspotDeals.records.length === 0)) {
      console.error('❌ No data returned from any source!');
      return null;
    }
    
    // Stage 2: Narrow with OpenAI (your existing logic)
    const { topBrands, scores } = await narrowWithOpenAI(
      brandData.records || [], 
      meetingData.records || [], 
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
      systemPrompt += "**TOP RELEVANT BRANDS (from Airtable):**\n
json\n";
      const brandInfo = topBrands.map(b => ({
        brand: b.fields['Brand Name'] || 'Unknown',
        relevance_score: b.relevanceScore || 0,
        budget: b.fields['Budget'] || 0,
        category: b.fields['Category'] || 'Uncategorized',
        campaign_focus: b.fields['Campaign Summary'] || 'No campaign info',
        last_activity: b.fields['Last Modified'] || 'Unknown'
      }));
      
      systemPrompt += JSON.stringify(brandInfo, null, 2);
      systemPrompt += "\n
\n\n";
    }
    
    // NEW: Add HubSpot deals data
    if (hubspotDeals && hubspotDeals.records && hubspotDeals.records.length > 0) {
      systemPrompt += "**HUBSPOT DEALS & OPPORTUNITIES:**\n
json\n";
      const dealsInfo = hubspotDeals.records.map(deal => ({
        deal_name: deal.properties.dealname,
        amount: deal.properties.amount ? `$${parseInt(deal.properties.amount).toLocaleString()}` : 'Not specified',
        stage: deal.properties.dealstage,
        close_date: deal.properties.closedate,
        pipeline: deal.properties.pipeline
      }));
      
      systemPrompt += JSON.stringify(dealsInfo, null, 2);
      systemPrompt += "\n
\n\n";
      
      console.log(💼 Sending ${dealsInfo.length} HubSpot deals to Claude);
    }
    
    // NEW: Add HubSpot contacts data
    if (hubspotContacts && hubspotContacts.records && hubspotContacts.records.length > 0) {
      systemPrompt += "**HUBSPOT CONTACTS:**\n
json\n";
      const contactsInfo = hubspotContacts.records.map(contact => ({
        name: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim(),
        email: contact.properties.email,
        company: contact.properties.company,
        phone: contact.properties.phone
      }));
      
      systemPrompt += JSON.stringify(contactsInfo, null, 2);
      systemPrompt += "\n
\n\n";
      
      console.log(👥 Sending ${contactsInfo.length} HubSpot contacts to Claude);
    }
    
    // Your existing meeting data formatting
    if (meetingData && meetingData.records && meetingData.records.length > 0) {
      systemPrompt += "**RECENT MEETINGS & DISCUSSIONS (from Airtable):**\n
json\n";
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
      systemPrompt += "\n
\n\n";
    }
    
    // Add instructions for Claude
    systemPrompt += 
When providing insights:
- Cross-reference brand opportunities from Airtable with deals in HubSpot
- Identify high-value opportunities from both systems
- Note any connections between brands, meetings, and HubSpot deals
- If meetings reference brands that also appear in HubSpot deals, highlight these connections
- Include relevant deal amounts and stages when discussing opportunities
- When referencing meetings, if a meeting has a link, include it formatted as: **Meeting: [Meeting Title]** Link: [URL]
;
    
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
      
      throw new Error(Claude API error: ${response.status});
    }
    
    const data = await response.json();
    console.log('✅ Claude API response received');
    
    if (data.content && data.content.length > 0) {
      const reply = data.content[0].text;
      
      // Enhanced MCP thinking to include HubSpot insights
      const mcpThinking = [];
      
      // Add data source summary FIRST
      const dataSources = [];
      if (brandData.total > 0) dataSources.push(${brandData.total} brands);
      if (meetingData.total > 0) dataSources.push(${meetingData.total} meetings);
      if (hubspotDeals && hubspotDeals.total > 0) dataSources.push(${hubspotDeals.total} HubSpot deals);
      if (hubspotContacts && hubspotContacts.total > 0) dataSources.push(${hubspotContacts.total} HubSpot contacts);
      
      if (dataSources.length > 0) {
        mcpThinking.push(Searched: ${dataSources.join(', ')});
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
            return ${deal.properties.dealname} (${amount.toLocaleString()});
          })
          .filter(Boolean);
        
        if (totalPipeline > 0) {
          mcpThinking.push(HubSpot pipeline: ${totalPipeline.toLocaleString()});
        }
        if (topDeals.length > 0) {
          mcpThinking.push(Top HubSpot deals: ${topDeals.join(', ')});
        }
      }
      
      // Your existing brand insights
      if (topBrands.length > 0 && scores) {
        const topThree = topBrands
          .slice(0, 3)
          .map(b => ${b.fields['Brand Name']} (${b.relevanceScore}))
          .filter(Boolean);
        if (topThree.length > 0) {
          mcpThinking.push(Top Airtable brands: ${topThree.join(', ')});
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
            const elevenLabsUrl = https://api.elevenlabs.io/v1/text-to-speech/${voiceId};
            
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
            const audioDataUrl = data:audio/mpeg;base64,${base64Audio};

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

      const knowledgeBaseUrl = https://api.airtable.com/v0/${baseId}/${knowledgeTable};
      const chatUrl = https://api.airtable.com/v0/${baseId}/${chatTable};
      const headersAirtable = { 
        'Content-Type': 'application/json', 
        Authorization: Bearer ${airtableApiKey} 
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
        console.error(❌ Error fetching knowledge base:, error);
      }

      // Fetch conversation history
      try {
        const searchUrl = ${chatUrl}?filterByFormula=AND(SessionID="${sessionId}",ProjectID="${projectId}");
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
        console.error(Error fetching conversation history:, error);
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
              Authorization: Bearer ${openAIApiKey},
              'OpenAI-Beta': 'realtime=v1',
            },
          });

          // Build system message
          let systemMessageContent = knowledgeBaseInstructions || "You are a helpful assistant specialized in AI & Automation.";
          if (conversationContext) {
            systemMessageContent += \n\nConversation history: ${conversationContext};
          }
          systemMessageContent += \n\nCurrent time in PDT: ${getCurrentTimeInPDT()}.;
          if (projectId && projectId !== 'default') {
            systemMessageContent +=  You are assisting with the ${projectId} project.;
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
                  ${conversationContext}\nUser: [Voice Message]\nAI: ${aiReply}, 
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
              systemMessageContent += \n\nConversation history: ${conversationContext};
            }
            systemMessageContent += \n\nCurrent time in PDT: ${getCurrentTimeInPDT()}.;
            if (projectId && projectId !== 'default') {
              systemMessageContent +=  You are assisting with the ${projectId} project.;
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
              ${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}, 
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
    console.log(Total message length: ${totalLength} characters);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: Bearer ${openAIApiKey},
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
      throw new Error(OpenAI API error: ${response.status});
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
      await fetch(${chatUrl}/${existingRecordId}, {
        method: 'PATCH',
        headers: headersAirtable,
        body: JSON.stringify({ fields: recordData.fields }),
      });
      console.log(Updated conversation for project: ${projectId}, session: ${sessionId});
    } else {
      await fetch(chatUrl, {
        method: 'POST',
        headers: headersAirtable,
        body: JSON.stringify(recordData),
      });
      console.log(Created new conversation for project: ${projectId}, session: ${sessionId});
    }
  } catch (error) {
    console.error('Error updating Airtable conversation:', error);
  }
}
