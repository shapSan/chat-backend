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

// FIXED MCP Search function - more consistent and useful
async function callMCPSearch(query, projectId, searchType = 'auto', limit = 10) {
  console.log('🔍 MCP Search called:', { query, projectId, searchType, limit });
  
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
      return { error: 'Invalid search type', matches: [], total: 0 };
    }
    
    // Build Airtable URL
    let url = `https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent(searchConfig.table)}`;
    const params = [`maxRecords=${Math.min(limit * 2, 100)}`]; // Get more to filter
    
    if (searchConfig.view) {
      params.push(`view=${encodeURIComponent(searchConfig.view)}`);
    }
    
    searchConfig.fields.forEach(field => {
      params.push(`fields[]=${encodeURIComponent(field)}`);
    });
    
    url += '?' + params.join('&');
    
    console.log('📡 Fetching from Airtable:', url);
    
    // Fetch from Airtable
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${airtableApiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Airtable API error:', response.status, errorText);
      throw new Error(`Airtable API error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`✅ Got ${data.records.length} records from ${searchType}`);
    
    // Process and filter results
    let processed = [];
    
    if (searchType === 'meetings') {
      processed = data.records
        .filter(record => {
          const fields = record.fields;
          // Only include meetings with summaries
          return fields['Summary'] && fields['Summary'].length > 10;
        })
        .map(record => {
          const fields = record.fields;
          const summary = fields['Summary'] || '';
          
          // Calculate relevance score
          let relevance = 0;
          const queryWords = query.toLowerCase().split(' ').filter(w => w.length > 2);
          const summaryLower = summary.toLowerCase();
          const titleLower = (fields['Title'] || '').toLowerCase();
          
          queryWords.forEach(word => {
            if (summaryLower.includes(word)) relevance += 10;
            if (titleLower.includes(word)) relevance += 5;
          });
          
          // Boost recent meetings
          if (fields['Date']) {
            const meetingDate = new Date(fields['Date']);
            const daysSince = Math.floor((Date.now() - meetingDate) / (1000 * 60 * 60 * 24));
            if (daysSince < 7) relevance += 20;
            else if (daysSince < 30) relevance += 10;
          }
          
          return {
            id: record.id,
            title: fields['Title'] || 'Untitled Meeting',
            date: fields['Date'] || 'No date',
            summary: summary.substring(0, 200) + '...',
            fullSummary: summary,
            link: fields['Link'] || null,
            relevance: relevance,
            type: 'meeting'
          };
        })
        .filter(item => item.relevance > 0) // Only include relevant results
        .sort((a, b) => b.relevance - a.relevance);
    } else {
      // Brands processing
      processed = data.records
        .filter(record => {
          const fields = record.fields;
          // Only include brands with names
          return fields['Brand Name'] && fields['Brand Name'].length > 0;
        })
        .map(record => {
          const fields = record.fields;
          
          // Calculate relevance
          let relevance = 0;
          const queryWords = query.toLowerCase().split(' ').filter(w => w.length > 2);
          const brandNameLower = (fields['Brand Name'] || '').toLowerCase();
          const campaignLower = (fields['Campaign Summary'] || '').toLowerCase();
          const categoryLower = (fields['Category'] || []).join(' ').toLowerCase();
          
          queryWords.forEach(word => {
            if (brandNameLower.includes(word)) relevance += 20;
            if (campaignLower.includes(word)) relevance += 10;
            if (categoryLower.includes(word)) relevance += 5;
          });
          
          // Boost by budget
          const budget = fields['Budget'] || 0;
          if (budget >= 5000000) relevance += 15;
          else if (budget >= 1000000) relevance += 10;
          else if (budget >= 500000) relevance += 5;
          
          // Boost recent activity
          if (fields['Last Modified']) {
            const lastMod = new Date(fields['Last Modified']);
            const daysSince = Math.floor((Date.now() - lastMod) / (1000 * 60 * 60 * 24));
            if (daysSince < 7) relevance += 15;
            else if (daysSince < 30) relevance += 10;
          }
          
          return {
            id: record.id,
            name: fields['Brand Name'],
            category: Array.isArray(fields['Category']) ? fields['Category'].join(', ') : 'Uncategorized',
            budget: fields['Budget'] ? `$${fields['Budget'].toLocaleString()}` : 'Budget TBD',
            budgetNum: fields['Budget'] || 0,
            lastModified: fields['Last Modified'] || 'Unknown',
            campaignSummary: (fields['Campaign Summary'] || '').substring(0, 150) + '...',
            fullCampaignSummary: fields['Campaign Summary'] || '',
            relevance: relevance,
            type: 'brand'
          };
        })
        .sort((a, b) => b.relevance - a.relevance);
    }
    
    console.log(`🎯 Returning top ${limit} results out of ${processed.length} relevant items`);
    
    return {
      matches: processed.slice(0, limit),
      total: processed.length,
      searchType,
      tableUsed: searchConfig.table
    };
    
  } catch (error) {
    console.error('❌ Error in MCP search:', error);
    return { error: error.message, matches: [], total: 0 };
  }
}

// Analyze user query to extract project context
function analyzeProjectContext(userMessage) {
  const msgLower = userMessage.toLowerCase();
  const context = {
    projectType: null,
    themes: [],
    budget: null,
    urgency: null,
    searchIntent: null
  };
  
  // Detect project type
  const projectTypes = {
    'horror': ['horror', 'scary', 'thriller', 'suspense'],
    'comedy': ['comedy', 'funny', 'humor', 'laugh'],
    'action': ['action', 'fight', 'chase', 'explosion'],
    'drama': ['drama', 'serious', 'emotional'],
    'family': ['family', 'kids', 'children', 'animated'],
    'romance': ['romance', 'love', 'romantic'],
    'documentary': ['documentary', 'doc', 'real story']
  };
  
  for (const [type, keywords] of Object.entries(projectTypes)) {
    if (keywords.some(keyword => msgLower.includes(keyword))) {
      context.projectType = type;
      break;
    }
  }
  
  // Detect themes
  const themeKeywords = ['luxury', 'tech', 'sports', 'food', 'travel', 'fashion', 'beauty', 'health', 'fitness', 'gaming', 'automotive', 'finance'];
  context.themes = themeKeywords.filter(theme => msgLower.includes(theme));
  
  // Detect urgency
  if (msgLower.includes('urgent') || msgLower.includes('asap') || msgLower.includes('quick') || msgLower.includes('fast')) {
    context.urgency = 'high';
  } else if (msgLower.includes('soon') || msgLower.includes('this week')) {
    context.urgency = 'medium';
  }
  
  // Detect search intent
  if (msgLower.includes('easy money') || msgLower.includes('quick approval')) {
    context.searchIntent = 'fast_deals';
  } else if (msgLower.includes('high budget') || msgLower.includes('big budget')) {
    context.searchIntent = 'high_value';
  } else if (msgLower.includes('wildcard') || msgLower.includes('unexpected')) {
    context.searchIntent = 'creative';
  }
  
  return context;
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

      let systemMessageContent = "You are a helpful assistant specialized in AI & Automation.";
      let conversationContext = '';
      let existingRecordId = null;
      let mcpThinking = [];
      let mcpContext = '';

      // IMPROVED Search Query Detection
      const searchTriggers = [
        'brand', 'match', 'suggest', 'integration', 'easy money', 'quick approval',
        'show me', 'list', 'find', 'search', 'for this project', 'wildcard',
        'audience match', 'hot new brands', 'what brands', 'which brands',
        'perfect for', 'good fit', 'meeting', 'discussion', 'talked about',
        'pending', 'approved', 'budget', 'high value', 'opportunities'
      ];
      
      const isSearchQuery = userMessage && searchTriggers.some(trigger => 
        userMessage.toLowerCase().includes(trigger)
      );

      console.log('🔍 Search detection:', { isSearchQuery, userMessage: userMessage?.slice(0, 50) });

      // MCP Search Integration - FIXED AND IMPROVED
      if (isSearchQuery) {
        console.log('✅ Executing MCP search...');
        
        try {
          // Analyze project context
          const projectContext = analyzeProjectContext(userMessage);
          
          if (projectContext.projectType) {
            mcpThinking.push(`Detected ${projectContext.projectType} project`);
          }
          if (projectContext.themes.length > 0) {
            mcpThinking.push(`Themes: ${projectContext.themes.join(', ')}`);
          }
          if (projectContext.urgency) {
            mcpThinking.push(`Urgency level: ${projectContext.urgency}`);
          }
          if (projectContext.searchIntent) {
            mcpThinking.push(`Looking for: ${projectContext.searchIntent === 'fast_deals' ? 'quick approvals' : projectContext.searchIntent === 'high_value' ? 'high-budget brands' : 'creative opportunities'}`);
          }
          
          // Search for brands
          const brandResults = await callMCPSearch(userMessage, projectId, 'brands', 15);
          
          // Search for meetings if relevant
          let meetingResults = null;
          if (userMessage.toLowerCase().includes('meeting') || 
              userMessage.toLowerCase().includes('discussion') ||
              userMessage.toLowerCase().includes('pending') ||
              userMessage.toLowerCase().includes('talked')) {
            meetingResults = await callMCPSearch(userMessage, projectId, 'meetings', 10);
          }
          
          // Build context from results
          mcpContext = '\n\n🎯 LIVE DATA FROM YOUR AIRTABLE:\n\n';
          
          // Process brand results
          if (brandResults && !brandResults.error && brandResults.matches.length > 0) {
            mcpContext += '**BRANDS IN YOUR PIPELINE:**\n\n';
            
            const brandsByStatus = {
              hot: [],
              warm: [],
              highValue: [],
              quickWins: []
            };
            
            brandResults.matches.forEach(brand => {
              // Skip if no brand name
              if (!brand.name) return;
              
              // Categorize brands
              const daysSince = brand.lastModified !== 'Unknown' ? 
                Math.floor((Date.now() - new Date(brand.lastModified)) / (1000 * 60 * 60 * 24)) : 999;
              
              if (daysSince < 7) brandsByStatus.hot.push(brand);
              else if (daysSince < 30) brandsByStatus.warm.push(brand);
              
              if (brand.budgetNum >= 5000000) brandsByStatus.highValue.push(brand);
              else if (brand.budgetNum >= 500000 && brand.budgetNum < 1000000) brandsByStatus.quickWins.push(brand);
              
              // Format brand entry
              mcpContext += `• **${brand.name}**`;
              
              // Add status indicators
              if (daysSince < 7) mcpContext += ' 🔥 [HOT - Active this week]';
              else if (daysSince < 30) mcpContext += ' 🟡 [WARM - Recent activity]';
              
              mcpContext += `\n  - Category: ${brand.category}`;
              mcpContext += `\n  - Budget: ${brand.budget}`;
              
              if (brand.budgetNum >= 5000000) {
                mcpContext += ' 💎 [HIGH VALUE]';
              } else if (brand.budgetNum >= 1000000 && brand.budgetNum < 2000000) {
                mcpContext += ' ⚡ [QUICK WIN POTENTIAL]';
              }
              
              if (brand.campaignSummary && brand.campaignSummary.length > 10) {
                mcpContext += `\n  - Focus: ${brand.campaignSummary}`;
              }
              
              mcpContext += '\n\n';
            });
            
            // Add thinking summary with actual names
            if (brandsByStatus.hot.length > 0) {
              mcpThinking.push(`HOT brands (${brandsByStatus.hot.length}): ${brandsByStatus.hot.slice(0, 3).map(b => b.name).join(', ')}`);
            }
            if (brandsByStatus.highValue.length > 0) {
              mcpThinking.push(`High-value brands ($5M+): ${brandsByStatus.highValue.slice(0, 3).map(b => b.name).join(', ')}`);
            }
            if (brandsByStatus.quickWins.length > 0) {
              mcpThinking.push(`Quick win opportunities: ${brandsByStatus.quickWins.slice(0, 3).map(b => b.name).join(', ')}`);
            }
          }
          
          // Process meeting results
          if (meetingResults && !meetingResults.error && meetingResults.matches.length > 0) {
            mcpContext += '\n**RECENT MEETINGS & DISCUSSIONS:**\n\n';
            
            const brandsInMeetings = new Set();
            const pendingDeals = [];
            const approvedDeals = [];
            
            meetingResults.matches.forEach(meeting => {
              const summaryLower = meeting.fullSummary.toLowerCase();
              
              // Find brand mentions in summary
              const mentionedBrands = [];
              if (brandResults && brandResults.matches) {
                brandResults.matches.forEach(brand => {
                  if (brand.name && summaryLower.includes(brand.name.toLowerCase())) {
                    mentionedBrands.push(brand.name);
                    brandsInMeetings.add(brand.name);
                  }
                });
              }
              
              // Check for deal status
              if (summaryLower.includes('pending') || summaryLower.includes('waiting')) {
                pendingDeals.push({ title: meeting.title, brands: mentionedBrands });
              }
              if (summaryLower.includes('approved') || summaryLower.includes('green light')) {
                approvedDeals.push({ title: meeting.title, brands: mentionedBrands });
              }
              
              // Format meeting entry
              mcpContext += `• **${meeting.title}** (${meeting.date})\n`;
              
              if (mentionedBrands.length > 0) {
                mcpContext += `  - Brands discussed: ${mentionedBrands.join(', ')}\n`;
              }
              
              // Extract key points from summary
              if (summaryLower.includes('loves') || summaryLower.includes('excited')) {
                mcpContext += '  - ✅ Positive reception\n';
              }
              if (summaryLower.includes('concern') || summaryLower.includes('worried')) {
                mcpContext += '  - ⚠️ Has concerns to address\n';
              }
              if (summaryLower.includes('deadline') || summaryLower.includes('by')) {
                mcpContext += '  - ⏰ Time-sensitive\n';
              }
              
              mcpContext += '\n';
            });
            
            // Add meeting insights to thinking
            if (brandsInMeetings.size > 0) {
              mcpThinking.push(`Brands with recent meetings: ${Array.from(brandsInMeetings).slice(0, 5).join(', ')}`);
            }
            if (pendingDeals.length > 0) {
              mcpThinking.push(`${pendingDeals.length} pending deals`);
            }
            if (approvedDeals.length > 0) {
              mcpThinking.push(`${approvedDeals.length} approved deals`);
            }
          }
          
          // Add strategic guidance based on search intent
          mcpContext += '\n**RECOMMENDATIONS BASED ON YOUR QUERY:**\n';
          
          if (projectContext.searchIntent === 'fast_deals') {
            mcpContext += '- Focus on brands marked as HOT or with recent activity\n';
            mcpContext += '- Prioritize brands with budgets under $2M (faster approval)\n';
            mcpContext += '- Look for brands mentioned in recent meetings\n';
          } else if (projectContext.searchIntent === 'high_value') {
            mcpContext += '- Target brands with $5M+ budgets\n';
            mcpContext += '- Consider package deals for multiple integrations\n';
            mcpContext += '- Focus on brands with "Campaign Summary" indicating major launches\n';
          } else if (projectContext.projectType) {
            mcpContext += `- Match brands to ${projectContext.projectType} genre\n`;
            mcpContext += '- Consider audience alignment and brand values\n';
            mcpContext += '- Look for brands with relevant campaign themes\n';
          }
          
          // Update system message with MCP context
          systemMessageContent += mcpContext;
          
        } catch (error) {
          console.error('❌ MCP search error:', error);
          mcpThinking.push('Search encountered an error - using standard response');
        }
      }

      // Fetch knowledge base
      try {
        const kbResponse = await fetch(knowledgeBaseUrl, { headers: headersAirtable });
        if (kbResponse.ok) {
          const knowledgeBaseData = await kbResponse.json();
          const knowledgeEntries = knowledgeBaseData.records.map(record => record.fields.Summary).join('\n\n');
          systemMessageContent += ` Available knowledge: "${knowledgeEntries}".`;
        }
      } catch (error) {
        console.error(`Error fetching knowledge base:`, error);
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

            systemMessageContent += ` Conversation so far: "${conversationContext}".`;
          }
        }
      } catch (error) {
        console.error(`Error fetching conversation history:`, error);
      }

      const currentTimePDT = getCurrentTimeInPDT();
      systemMessageContent += ` Current time in PDT: ${currentTimePDT}.`;
      
      if (projectId && projectId !== 'default') {
        systemMessageContent += ` You are assisting with the ${projectId} project.`;
      }

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
                  mcpThinking: mcpThinking.length > 0 ? mcpThinking : null,
                  usedMCP: isSearchQuery
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
          console.log('💬 Sending to OpenAI with MCP context:', { 
            hasContext: mcpContext.length > 0,
            contextLength: mcpContext.length,
            thinkingSteps: mcpThinking.length
          });
          
          const aiReply = await getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent);
          
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
              usedMCP: isSearchQuery
            });
          } else {
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
