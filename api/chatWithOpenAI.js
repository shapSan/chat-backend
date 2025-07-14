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

// Enhanced MCP Search function with meeting details extraction
async function callMCPSearch(query, projectId, limit = 10) {
  console.log('🚀 callMCPSearch called with:', { query, projectId, limit });
  try {
    // Determine search type
    const searchType = query.toLowerCase().includes('meeting') || 
                      query.toLowerCase().includes('call') || 
                      query.toLowerCase().includes('discussion') 
                      ? 'meetings' : 'brands';
    
    // Configuration
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
    
    // Fetch from Airtable
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${airtableApiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Airtable API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Process results based on type with enhanced extraction
    let processed;
    if (searchType === 'meetings') {
      processed = data.records.map(record => {
        const fields = record.fields;
        const summary = fields['Summary'] || '';
        
        // Extract insights from meeting data
        const insights = extractMeetingInsights(summary);
        
        return {
          id: record.id,
          title: fields['Title'] || 'Untitled Meeting',
          date: fields['Date'] || 'No date',
          summary: summary.substring(0, 150) + '...',
          fullSummary: summary,
          link: fields['Link'] || null,
          insights: insights,
          relevance: 50,
          type: 'meeting'
        };
      });
    } else {
      processed = data.records.map(record => {
        const fields = record.fields;
        
        let budgetDisplay = 'Budget TBD';
        let budgetNum = 0;
        if (fields['Budget'] !== undefined && fields['Budget'] !== null) {
          budgetNum = fields['Budget'];
          budgetDisplay = `$${fields['Budget'].toLocaleString()}`;
        }
        
        let categoryDisplay = 'Uncategorized';
        if (fields['Category'] && Array.isArray(fields['Category'])) {
          categoryDisplay = fields['Category'].join(', ');
        }
        
        // Extract insights from brand data
        const campaignSummary = fields['Campaign Summary'] || '';
        const brandInsights = extractBrandInsights('', campaignSummary);
        
        return {
          id: record.id,
          name: fields['Brand Name'] || 'Unknown Brand',
          category: categoryDisplay,
          budget: budgetDisplay,
          budgetNum: budgetNum,
          lastModified: fields['Last Modified'] || 'Unknown',
          campaignSummary: campaignSummary.substring(0, 100) + '...',
          fullCampaignSummary: campaignSummary,
          insights: brandInsights,
          relevance: 50,
          type: 'brand'
        };
      });
    }
    
    return {
      matches: processed.slice(0, limit),
      total: processed.length,
      searchType,
      tableUsed: searchConfig.table
    };
    
  } catch (error) {
    console.error('Error in MCP search:', error);
    return { error: error.message, matches: [], total: 0 };
  }
}

// Extract insights from meeting summaries
function extractMeetingInsights(text) {
  const insights = {
    concerns: [],
    requests: [],
    opportunities: [],
    deadlines: [],
    quotes: []
  };
  
  const textLower = text.toLowerCase();
  
  // Extract concerns
  const concernPatterns = [
    /concerned about (.+?)(?:\.|,|;|$)/gi,
    /worried about (.+?)(?:\.|,|;|$)/gi,
    /hesitant about (.+?)(?:\.|,|;|$)/gi,
    /concern:?\s*(.+?)(?:\.|,|;|$)/gi
  ];
  
  concernPatterns.forEach(pattern => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      insights.concerns.push(match[1].trim());
    }
  });
  
  // Extract specific requests
  const requestPatterns = [
    /wants? (.+?)(?:\.|,|;|$)/gi,
    /looking for (.+?)(?:\.|,|;|$)/gi,
    /needs? (.+?)(?:\.|,|;|$)/gi,
    /requested (.+?)(?:\.|,|;|$)/gi,
    /specifically asked for (.+?)(?:\.|,|;|$)/gi
  ];
  
  requestPatterns.forEach(pattern => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      insights.requests.push(match[1].trim());
    }
  });
  
  // Extract deadlines
  const deadlinePatterns = [
    /by (monday|tuesday|wednesday|thursday|friday|next week|end of month|end of week|tomorrow)/gi,
    /deadline[:\s]+([^.,;]+)/gi,
    /approval needed by ([^.,;]+)/gi,
    /decision by ([^.,;]+)/gi,
    /flying in ([^.,;]+)/gi
  ];
  
  deadlinePatterns.forEach(pattern => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      insights.deadlines.push(match[1].trim());
    }
  });
  
  // Extract direct quotes (in quotes)
  const quotePattern = /"([^"]+)"/g;
  const quotes = text.matchAll(quotePattern);
  for (const match of quotes) {
    insights.quotes.push(match[1]);
  }
  
  // Extract opportunities
  if (textLower.includes('pulled out') || textLower.includes('cancelled') || textLower.includes('withdrew')) {
    const pulloutMatch = text.match(/(\w+)\s+(?:pulled out|cancelled|withdrew)/i);
    if (pulloutMatch) {
      insights.opportunities.push(`${pulloutMatch[1]} pulled out - budget may be available`);
    }
  }
  if (textLower.includes('flying in') || textLower.includes('visiting') || textLower.includes('in town')) {
    insights.opportunities.push('In-person meeting opportunity');
  }
  if (textLower.includes('loves') || textLower.includes('excited about')) {
    const lovesMatch = text.match(/(?:loves?|excited about)\s+(.+?)(?:\.|,|;|$)/i);
    if (lovesMatch) {
      insights.opportunities.push(`Strong interest in: ${lovesMatch[1]}`);
    }
  }
  
  return insights;
}

// Extract insights from brand notes
function extractBrandInsights(notes, campaignSummary) {
  const insights = {
    preferences: [],
    restrictions: [],
    pastSuccess: [],
    timing: [],
    keyConcerns: []
  };
  
  const combined = `${notes} ${campaignSummary}`.toLowerCase();
  const fullText = `${notes} ${campaignSummary}`;
  
  // Extract preferences
  const prefPatterns = [
    /prefers?\s+(.+?)(?:\.|,|;|$)/gi,
    /likes?\s+(.+?)(?:\.|,|;|$)/gi,
    /favor\s+(.+?)(?:\.|,|;|$)/gi,
    /interested in\s+(.+?)(?:\.|,|;|$)/gi
  ];
  
  prefPatterns.forEach(pattern => {
    const matches = fullText.matchAll(pattern);
    for (const match of matches) {
      insights.preferences.push(match[1].trim());
    }
  });
  
  // Extract restrictions
  if (combined.includes('no alcohol')) insights.restrictions.push('No alcohol scenes');
  if (combined.includes('no violence')) insights.restrictions.push('No violence');
  if (combined.includes('no smoking')) insights.restrictions.push('No smoking');
  if (combined.includes('family friendly')) insights.restrictions.push('Must be family friendly');
  if (combined.includes('no competitors')) insights.restrictions.push('No competitor brands');
  
  // Extract timing
  const timingPatterns = [
    /(q[1-4]\s*\d{4})/gi,
    /launch(?:ing)?\s+(.+?)(?:\.|,|;|$)/gi,
    /campaign\s+(?:starts?|begins?)\s+(.+?)(?:\.|,|;|$)/gi
  ];
  
  timingPatterns.forEach(pattern => {
    const matches = fullText.matchAll(pattern);
    for (const match of matches) {
      insights.timing.push(match[1].trim());
    }
  });
  
  // Extract key concerns from notes
  if (combined.includes('concern') || combined.includes('worried')) {
    const concernMatch = fullText.match(/(?:concern|worried)\s+(?:about\s+)?(.+?)(?:\.|,|;|$)/i);
    if (concernMatch) {
      insights.keyConcerns.push(concernMatch[1].trim());
    }
  }
  
  return insights;
}

export default async function handler(req, res) {
  // Set CORS headers early (before any conditionals)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // respond early for preflight
  }

  if (req.method === 'POST') {
    try {
      // Log incoming request to debug
      console.log('Received request body:', req.body);
      
      // Check if this is an audio generation request FIRST
      if (req.body.generateAudio === true) {
        console.log('Processing audio generation request');
        
        // Handle audio generation
        const { prompt, projectId, sessionId } = req.body;

        // Validate required fields
        if (!prompt) {
          return res.status(400).json({ 
            error: 'Missing required fields',
            details: 'prompt is required'
          });
        }

        // Check for ElevenLabs API key
        if (!elevenLabsApiKey) {
          console.error('ElevenLabs API key not configured');
          return res.status(500).json({ 
            error: 'Audio generation service not configured',
            details: 'Please configure ELEVENLABS_API_KEY'
          });
        }

        // Get project-specific configuration including voice settings
        const projectConfig = getProjectConfig(projectId);
        const { voiceId, voiceSettings } = projectConfig;

        console.log('Generating audio for project:', projectId, 'using voice:', voiceId);

        try {
            // First, let's check if the API key is valid with a simple voices endpoint call
            console.log('Checking ElevenLabs API key validity...');
            const voicesCheck = await fetch('https://api.elevenlabs.io/v1/voices', {
                headers: {
                    'xi-api-key': elevenLabsApiKey
                }
            });
            
            if (!voicesCheck.ok) {
                console.error('ElevenLabs API key check failed:', voicesCheck.status);
                return res.status(401).json({ 
                    error: 'Invalid ElevenLabs API key',
                    details: 'Please check your ELEVENLABS_API_KEY in Vercel environment variables'
                });
            }
            
            console.log('API key is valid, proceeding with audio generation...');
            
            // Call ElevenLabs API with project-specific voice
            const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
            
            console.log('Calling ElevenLabs API...');
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

            console.log('ElevenLabs response status:', elevenLabsResponse.status);

            if (!elevenLabsResponse.ok) {
                const errorText = await elevenLabsResponse.text();
                console.error('ElevenLabs API error:', elevenLabsResponse.status, errorText);
                
                if (elevenLabsResponse.status === 401) {
                    return res.status(401).json({ 
                        error: 'Invalid API key',
                        details: 'Please check your ElevenLabs API key'
                    });
                } else if (elevenLabsResponse.status === 429) {
                    return res.status(429).json({ 
                        error: 'Rate limit exceeded',
                        details: 'Please try again later'
                    });
                } else if (elevenLabsResponse.status === 400) {
                    return res.status(400).json({ 
                        error: 'Invalid request to ElevenLabs',
                        details: errorText
                    });
                }
                
                return res.status(500).json({ 
                    error: 'Failed to generate audio',
                    details: errorText
                });
            }

            console.log('Getting audio buffer...');
            // Get audio data as buffer
            const audioBuffer = await elevenLabsResponse.buffer();
            
            console.log('Converting to base64...');
            // Convert to base64 data URL
            const base64Audio = audioBuffer.toString('base64');
            const audioDataUrl = `data:audio/mpeg;base64,${base64Audio}`;

            console.log('Audio generated successfully for project:', projectId, 'size:', audioBuffer.length);

            // Return the audio data URL
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

      // Otherwise, handle regular chat messages
      // Destructure userMessage properly and handle truncation correctly
      let { userMessage, sessionId, audioData, projectId } = req.body;

      // Truncate AFTER destructuring, not before
      if (userMessage && userMessage.length > 5000) {
        userMessage = userMessage.slice(0, 5000) + "…";
      }

      // Log incoming request data
      console.log('Received POST request:', { 
        userMessage: userMessage ? userMessage.slice(0, 100) + '...' : null, 
        sessionId, 
        audioDataLength: audioData ? audioData.length : 0,
        projectId,
        userMessageLength: userMessage ? userMessage.length : 0
      });

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
      }
      if (!userMessage && !audioData) {
        return res.status(400).json({ error: 'Missing required fields', details: 'Either userMessage or audioData is required.' });
      }

      // Get project-specific configuration
      const projectConfig = getProjectConfig(projectId);
      const { baseId, chatTable, knowledgeTable } = projectConfig;

      // Construct Airtable URLs with project-specific base and tables
      const knowledgeBaseUrl = `https://api.airtable.com/v0/${baseId}/${knowledgeTable}`;
      const chatUrl = `https://api.airtable.com/v0/${baseId}/${chatTable}`;
      const headersAirtable = { 
        'Content-Type': 'application/json', 
        Authorization: `Bearer ${airtableApiKey}` 
      };

      let systemMessageContent = "You are a helpful assistant specialized in AI & Automation.";
      let conversationContext = '';
      let existingRecordId = null;
      let mcpThinking = []; // Store thinking process for frontend

      // Check if this is a search query - make it smarter
      const isSearchQuery = userMessage && (
        userMessage.toLowerCase().includes('brand') ||
        userMessage.toLowerCase().includes('match') ||
        userMessage.toLowerCase().includes('suggest') ||
        userMessage.toLowerCase().includes('integration') ||
        userMessage.toLowerCase().includes('easy money') ||
        userMessage.toLowerCase().includes('quick approval') ||
        userMessage.toLowerCase().includes('show me') ||
        userMessage.toLowerCase().includes('list') ||
        userMessage.toLowerCase().includes('find') ||
        userMessage.toLowerCase().includes('search') ||
        userMessage.toLowerCase().includes('for this project') ||
        userMessage.toLowerCase().includes('wildcard') ||
        userMessage.toLowerCase().includes('audience match') ||
        userMessage.toLowerCase().includes('hot new brands')
      );

      // ADD THESE LOGS:
      console.log('📝 User message:', userMessage);
      console.log('🔍 Is search query?', isSearchQuery);

      // MCP Search Integration - Enhanced for intelligent context
      if (isSearchQuery) {
        console.log('✅ Search query detected, calling MCP...');
        try {
          console.log('Using MCP for smart search...');
          
          // First, extract project/production details from the message
          let projectContext = {
            genre: null,
            themes: [],
            budget: null,
            keywords: []
          };
          
          // Extract genre/type
          if (userMessage.toLowerCase().includes('horror')) projectContext.genre = 'horror';
          else if (userMessage.toLowerCase().includes('comedy')) projectContext.genre = 'comedy';
          else if (userMessage.toLowerCase().includes('action')) projectContext.genre = 'action';
          else if (userMessage.toLowerCase().includes('drama')) projectContext.genre = 'drama';
          else if (userMessage.toLowerCase().includes('romance')) projectContext.genre = 'romance';
          else if (userMessage.toLowerCase().includes('thriller')) projectContext.genre = 'thriller';
          else if (userMessage.toLowerCase().includes('family')) projectContext.genre = 'family';
          
          // Extract themes and keywords
          const themeWords = ['family', 'adventure', 'tech', 'luxury', 'sports', 'food', 'travel', 'fashion', 'music', 'gaming', 'beauty', 'health', 'fitness'];
          projectContext.themes = themeWords.filter(theme => userMessage.toLowerCase().includes(theme));
          
          // Add thinking about project understanding
          if (projectContext.genre) {
            mcpThinking.push(`Detected ${projectContext.genre} project`);
          }
          if (projectContext.themes.length > 0) {
            mcpThinking.push(`Project themes: ${projectContext.themes.join(', ')}`);
          }
          
          // First, search for brands
          const brandResults = await callMCPSearch(userMessage, projectId || 'HB-PitchAssist', 10);
          
          // Also search for relevant meetings if the query mentions projects or discussions
          let meetingResults = null;
          if (userMessage.toLowerCase().includes('project') || 
              userMessage.toLowerCase().includes('pending') ||
              userMessage.toLowerCase().includes('discussed') ||
              userMessage.toLowerCase().includes('meeting')) {
            meetingResults = await callMCPSearch('meeting discussion brand integration', projectId || 'HB-PitchAssist', 10);
          }
          
          console.log('📊 Brand results:', brandResults ? brandResults.total : 0);
          console.log('📊 Meeting results:', meetingResults ? meetingResults.total : 0);
          
          // Build intelligent context from results
          let mcpContext = '\n\n🎯 PRIORITY CONTEXT FROM YOUR BUSINESS DATA:\n\n';
          
          // Add brand information with business intelligence
          if (brandResults && !brandResults.error && brandResults.matches.length > 0) {
            mcpContext += '**ACTIVE BRANDS IN YOUR PIPELINE:**\n';
            mcpThinking.push(`Found ${brandResults.matches.length} brands in pipeline`);
            
            let hotBrands = [];
            let warmBrands = [];
            let highValueBrands = [];
            
            brandResults.matches.forEach(brand => {
              if (!brand || !brand.lastModified || brand.lastModified === 'Unknown') return;
              
              try {
                const lastModDate = new Date(brand.lastModified);
                const daysSinceModified = Math.floor((Date.now() - lastModDate) / (1000 * 60 * 60 * 24));
                
                mcpContext += `\n🔥 ${brand.name}`;
                
                // Add urgency indicators
                if (daysSinceModified < 7) {
                  mcpContext += ' [HOT - Updated this week!]';
                  hotBrands.push(brand.name);
                } else if (daysSinceModified < 30) {
                  mcpContext += ' [WARM - Recent activity]';
                  warmBrands.push(brand.name);
                }
                
                mcpContext += `\n   • Category: ${brand.category}\n   • Budget: ${brand.budget}`;
                
                if (brand.campaignSummary) {
                  mcpContext += `\n   • Current Focus: ${brand.campaignSummary}`;
                }
                
                // Add insights from brand data
                if (brand.insights) {
                  if (brand.insights.preferences.length > 0) {
                    mcpContext += `\n   • Preferences: ${brand.insights.preferences.join(', ')}`;
                  }
                  if (brand.insights.restrictions.length > 0) {
                    mcpContext += `\n   • ⚠️ Restrictions: ${brand.insights.restrictions.join(', ')}`;
                  }
                  if (brand.insights.timing.length > 0) {
                    mcpContext += `\n   • 📅 Timing: ${brand.insights.timing.join(', ')}`;
                  }
                  if (brand.insights.keyConcerns.length > 0) {
                    mcpContext += `\n   • 🎯 Key Concerns: ${brand.insights.keyConcerns.join(', ')}`;
                  }
                }
                
                // Smart insights based on budget
                if (brand.budgetNum >= 5000000) {
                  mcpContext += '\n   • 💰 HIGH-VALUE OPPORTUNITY - Prioritize for major integrations';
                  highValueBrands.push(brand.name);
                } else if (brand.budgetNum >= 1000000) {
                  mcpContext += '\n   • 💎 SOLID BUDGET - Good for featured placements';
                }
                
                mcpContext += '\n';
              } catch (e) {
                console.error('Error processing brand:', brand.name, e);
              }
            });
            
            // Add insights to thinking process with actual brand names
            if (hotBrands.length > 0) {
              mcpThinking.push(`${hotBrands.length} HOT brands: ${hotBrands.join(', ')}`);
            }
            if (warmBrands.length > 0) {
              mcpThinking.push(`${warmBrands.length} WARM brands: ${warmBrands.join(', ')}`);
            }
            if (highValueBrands.length > 0) {
              mcpThinking.push(`${highValueBrands.length} high-value opportunities ($5M+): ${highValueBrands.join(', ')}`);
            }
          }
          
          // Add meeting context for business intelligence
          if (meetingResults && !meetingResults.error && meetingResults.matches.length > 0) {
            mcpContext += '\n**RECENT DISCUSSIONS & PENDING DEALS:**\n';
            
            let pendingDeals = [];
            let approvedDeals = [];
            let urgentDeadlines = [];
            let keyOpportunities = [];
            let brandsDiscussedInMeetings = new Map(); // Track which brands were discussed in which meetings
            
            meetingResults.matches.forEach(meeting => {
              const meetingDate = new Date(meeting.date);
              const daysSinceMeeting = Math.floor((Date.now() - meetingDate) / (1000 * 60 * 60 * 24));
              
              // Only include recent and relevant meetings
              if (daysSinceMeeting < 30) {
                // Check if any brands are mentioned in this meeting's SUMMARY (not title)
                const meetingTextLower = meeting.fullSummary.toLowerCase();
                let mentionedBrands = [];
                
                // Only look for exact brand name matches in the summary
                if (brandResults && brandResults.matches) {
                  brandResults.matches.forEach(brand => {
                    if (brand.name && meetingTextLower.includes(brand.name.toLowerCase())) {
                      mentionedBrands.push(brand.name);
                      // Track this for thinking
                      if (!brandsDiscussedInMeetings.has(brand.name)) {
                        brandsDiscussedInMeetings.set(brand.name, []);
                      }
                      brandsDiscussedInMeetings.get(brand.name).push({
                        meetingTitle: meeting.title,
                        meetingDate: meeting.date
                      });
                    }
                  });
                }
                
                // Only include meetings that are truly relevant
                if (meeting.insights || mentionedBrands.length > 0 || 
                    meetingTextLower.includes('brand') || 
                    meetingTextLower.includes('integration')) {
                  
                  mcpContext += `\n📅 ${meeting.title} (${meeting.date})`;
                  
                  if (daysSinceMeeting < 7) {
                    mcpContext += ' [THIS WEEK]';
                  }
                  
                  // Add insights from meeting
                  if (meeting.insights) {
                    if (meeting.insights.concerns.length > 0) {
                      mcpContext += `\n   • ⚠️ Concerns: ${meeting.insights.concerns.join(', ')}`;
                    }
                    if (meeting.insights.requests.length > 0) {
                      mcpContext += `\n   • 📋 Requests: ${meeting.insights.requests.join(', ')}`;
                    }
                    if (meeting.insights.deadlines.length > 0) {
                      mcpContext += `\n   • ⏰ Deadlines: ${meeting.insights.deadlines.join(', ')}`;
                      urgentDeadlines.push(...meeting.insights.deadlines);
                    }
                    if (meeting.insights.quotes.length > 0) {
                      mcpContext += `\n   • 💬 Direct quotes: "${meeting.insights.quotes.join('", "')}"`;
                    }
                    if (meeting.insights.opportunities.length > 0) {
                      mcpContext += `\n   • 🎯 Opportunities: ${meeting.insights.opportunities.join(', ')}`;
                      keyOpportunities.push(...meeting.insights.opportunities);
                    }
                  }
                  
                  // Track pending deals
                  if (meetingTextLower.includes('pending') || meetingTextLower.includes('waiting')) {
                    pendingDeals.push(meeting.title);
                  }
                  if (meetingTextLower.includes('approved') || meetingTextLower.includes('green light')) {
                    approvedDeals.push(meeting.title);
                  }
                  
                  // Add mentioned brands WITH CLARIFICATION
                  if (mentionedBrands.length > 0) {
                    mcpContext += `\n   • 🏷️ Brands mentioned in summary: ${mentionedBrands.join(', ')}`;
                  }
                  
                  mcpContext += '\n';
                }
              }
            });
            
            // Add meeting insights to thinking with proper attribution
            brandsDiscussedInMeetings.forEach((meetings, brandName) => {
              meetings.forEach(meeting => {
                mcpThinking.push(`${brandName} mentioned in "${meeting.meetingTitle}" summary`);
              });
            });
            
            if (pendingDeals.length > 0) {
              mcpThinking.push(`${pendingDeals.length} pending deals from meetings`);
            }
            if (approvedDeals.length > 0) {
              mcpThinking.push(`${approvedDeals.length} deals already approved`);
            }
            if (urgentDeadlines.length > 0) {
              mcpThinking.push(`Urgent deadlines: ${urgentDeadlines.join(', ')}`);
            }
            if (keyOpportunities.length > 0) {
              mcpThinking.push(`Key opportunities: ${keyOpportunities.join(', ')}`);
            }
          }
          
          // Add strategic instructions with project context
          mcpContext += '\n**INTEGRATION STRATEGY INSTRUCTIONS:**\n';
          mcpContext += '1. PRIORITIZE brands marked as HOT or with recent meeting discussions\n';
          mcpContext += '2. Consider pending deals from meetings when suggesting integrations\n';
          mcpContext += '3. Match high-budget brands with hero/featured integrations\n';
          mcpContext += '4. If a brand was mentioned in a meeting SUMMARY (not just the title), reference that context\n';
          mcpContext += '5. Flag any brands that are close to closing (based on meeting summaries)\n';
          mcpContext += '6. Quote specific requests or concerns from meetings when relevant\n';
          mcpContext += '7. Highlight timing opportunities (people flying in, approvals pending)\n';
          mcpContext += '8. Connect creative solutions to stated brand concerns\n';
          mcpContext += '9. Surface hidden opportunities (e.g., budget available from cancelled deals)\n';
          
          // Add project-specific guidance if we detected genre/themes
          if (projectContext.genre || projectContext.themes.length > 0) {
            mcpContext += '\n**PROJECT-SPECIFIC MATCHING:**\n';
            if (projectContext.genre) {
              mcpContext += `- This is a ${projectContext.genre} project - match brands accordingly\n`;
            }
            if (projectContext.themes.length > 0) {
              mcpContext += `- Key themes: ${projectContext.themes.join(', ')} - prioritize relevant brands\n`;
            }
          }
          
          // Add to system message
          systemMessageContent = systemMessageContent.replace(
            'You are a helpful assistant specialized in AI & Automation.',
            'You are a helpful assistant specialized in AI & Automation.' + mcpContext
          );
        } catch (error) {
          console.error('MCP search error:', error);
          mcpThinking.push('MCP search encountered an error');
        }
      }

      // Fetch project-specific knowledge base
      try {
        const kbResponse = await fetch(knowledgeBaseUrl, { headers: headersAirtable });
        if (kbResponse.ok) {
          const knowledgeBaseData = await kbResponse.json();
          const knowledgeEntries = knowledgeBaseData.records.map(record => record.fields.Summary).join('\n\n');
          systemMessageContent += ` Available knowledge: "${knowledgeEntries}".`;
          console.log(`Loaded knowledge base for project: ${projectId}`);
        } else {
          console.warn(`Knowledge base not found for project: ${projectId}, using default assistant behavior`);
        }
      } catch (error) {
        console.error(`Error fetching knowledge base for project ${projectId}:`, error);
      }

      // Fetch conversation history from project-specific table
      try {
        const searchUrl = `${chatUrl}?filterByFormula=AND(SessionID="${sessionId}",ProjectID="${projectId}")`;
        const historyResponse = await fetch(searchUrl, { headers: headersAirtable });
        if (historyResponse.ok) {
          const result = await historyResponse.json();
          if (result.records.length > 0) {
            conversationContext = result.records[0].fields.Conversation || '';
            existingRecordId = result.records[0].id;

            // Truncate long history to avoid OpenAI errors
            if (conversationContext.length > 3000) {
              conversationContext = conversationContext.slice(-3000);
            }

            systemMessageContent += ` Conversation so far: "${conversationContext}".`;
          }
        }
      } catch (error) {
        console.error(`Error fetching conversation history for project ${projectId}:`, error);
      }

      const currentTimePDT = getCurrentTimeInPDT();
      systemMessageContent += ` Current time in PDT: ${currentTimePDT}.`;
      
      // Add project context to system message if available
      if (projectId && projectId !== 'default') {
        systemMessageContent += ` You are assisting with the ${projectId} project.`;
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
                // Make Airtable update async - don't await
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
                  mcpThinking: mcpThinking.length > 0 ? mcpThinking : null,
                  usedMCP: isSearchQuery
                });
              } else {
                console.error('No valid reply received from OpenAI WebSocket.');
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
          console.log('Sending text message to OpenAI:', { 
            userMessageLength: userMessage.length, 
            systemMessageLength: systemMessageContent.length 
          });
          const aiReply = await getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent);
          console.log('Received AI response:', aiReply ? aiReply.slice(0, 100) + '...' : null);
          if (aiReply) {
            // Make Airtable update async - don't await
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
              usedMCP: isSearchQuery
            });
          } else {
            console.error('No text reply received from OpenAI.');
            return res.status(500).json({ error: 'No text reply received from OpenAI.' });
          }
        } catch (error) {
          console.error('Error fetching text response from OpenAI:', error);
          return res.status(500).json({ error: 'Error fetching text response from OpenAI.', details: error.message });
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
    // Add better error handling and message length validation
    const messages = [
      { role: 'system', content: systemMessageContent },
      { role: 'user', content: userMessage }
    ];
    
    // Calculate total tokens (rough estimate)
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
        temperature: 0.7 // Add temperature for consistency
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('OpenAI API error:', response.status, errorData);
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('OpenAI response:', data);
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
    // Truncate conversation before saving to Airtable to avoid size limits
    let conversationToSave = updatedConversation;
    if (conversationToSave.length > 10000) {
      // Keep only the last 10000 characters
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
      // Update existing record
      await fetch(`${chatUrl}/${existingRecordId}`, {
        method: 'PATCH',
        headers: headersAirtable,
        body: JSON.stringify({ fields: recordData.fields }),
      });
      console.log(`Updated conversation for project: ${projectId}, session: ${sessionId}`);
    } else {
      // Create new record
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
