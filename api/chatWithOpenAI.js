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

// In-memory cache for knowledge base with TTL
const knowledgeBaseCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

// Project configuration mapping - INCLUDING VOICE SETTINGS
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
  },
  'real-estate': {
    baseId: 'appYYYYYYYYYYYYYY',
    chatTable: 'RealEstate_Chat',
    knowledgeTable: 'RealEstate_Knowledge',
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
    voiceSettings: {
      stability: 0.6,
      similarity_boost: 0.8,
      style: 0.4,
      use_speaker_boost: true
    }
  },
  'healthcare': {
    baseId: 'appZZZZZZZZZZZZZZ',
    chatTable: 'Healthcare_Chat',
    knowledgeTable: 'Healthcare_Knowledge',
    voiceId: 'MF3mGyEYCl7XYWbV9V6O',
    voiceSettings: {
      stability: 0.7,
      similarity_boost: 0.7,
      style: 0.3,
      use_speaker_boost: false
    }
  }
};

function getProjectConfig(projectId) {
  const config = PROJECT_CONFIGS[projectId] || PROJECT_CONFIGS['default'];
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

// Optimized knowledge base fetching with caching
async function getKnowledgeBase(projectId, baseId, knowledgeTable, headersAirtable) {
  const cacheKey = `${projectId}-kb`;
  const cached = knowledgeBaseCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    console.log(`Using cached knowledge base for project: ${projectId}`);
    return cached.data;
  }

  try {
    const knowledgeBaseUrl = `https://api.airtable.com/v0/${baseId}/${knowledgeTable}`;
    const kbResponse = await fetch(knowledgeBaseUrl, { 
      headers: headersAirtable,
      // Add timeout
      signal: AbortSignal.timeout(5000)
    });
    
    if (kbResponse.ok) {
      const knowledgeBaseData = await kbResponse.json();
      const knowledgeEntries = knowledgeBaseData.records
        .map(record => record.fields.Summary)
        .filter(Boolean)
        .join('\n\n');
      
      // Cache the result
      knowledgeBaseCache.set(cacheKey, {
        data: knowledgeEntries,
        timestamp: Date.now()
      });
      
      console.log(`Loaded and cached knowledge base for project: ${projectId}`);
      return knowledgeEntries;
    }
  } catch (error) {
    console.error(`Error fetching knowledge base for project ${projectId}:`, error);
  }
  
  return '';
}

// Optimized conversation history with summary
function summarizeConversation(conversation) {
  // Keep only the last few exchanges
  const messages = conversation.split('\n');
  const recentMessages = messages.slice(-10); // Keep last 5 exchanges
  
  // If conversation is too long, create a summary
  if (messages.length > 10) {
    return `[Previous conversation summarized]\n${recentMessages.join('\n')}`;
  }
  
  return conversation;
}

export default async function handler(req, res) {
  // Set CORS headers early
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      console.log('Received request body:', { 
        ...req.body, 
        userMessage: req.body.userMessage ? req.body.userMessage.slice(0, 50) + '...' : undefined,
        audioData: req.body.audioData ? 'present' : undefined
      });
      
      // Check if this is an audio generation request FIRST
      if (req.body.generateAudio === true) {
        return handleAudioGeneration(req, res);
      }

      // Handle regular chat messages
      return handleChatMessage(req, res);
      
    } catch (error) {
      console.error('Error in handler:', error);
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  } else {
    res.setHeader("Allow", ["POST", "OPTIONS"]);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
}

async function handleAudioGeneration(req, res) {
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
    // Check API key validity
    const voicesCheck = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': elevenLabsApiKey
      },
      signal: AbortSignal.timeout(5000)
    });
    
    if (!voicesCheck.ok) {
      console.error('ElevenLabs API key check failed:', voicesCheck.status);
      return res.status(401).json({ 
        error: 'Invalid ElevenLabs API key',
        details: 'Please check your ELEVENLABS_API_KEY'
      });
    }
    
    // Generate audio
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
      }),
      signal: AbortSignal.timeout(10000)
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

    console.log('Audio generated successfully, size:', audioBuffer.length);

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

async function handleChatMessage(req, res) {
  let { userMessage, sessionId, audioData, projectId } = req.body;

  // Truncate message if too long
  if (userMessage && userMessage.length > 5000) {
    userMessage = userMessage.slice(0, 5000) + "…";
  }

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }
  if (!userMessage && !audioData) {
    return res.status(400).json({ error: 'Missing required fields', details: 'Either userMessage or audioData is required.' });
  }

  const projectConfig = getProjectConfig(projectId);
  const { baseId, chatTable, knowledgeTable } = projectConfig;

  const headersAirtable = { 
    'Content-Type': 'application/json', 
    Authorization: `Bearer ${airtableApiKey}` 
  };

  // Start building system message
  let systemMessageContent = "You are a helpful assistant specialized in AI & Automation.";
  
  // Fetch knowledge base (with caching)
  const knowledgeContent = await getKnowledgeBase(projectId, baseId, knowledgeTable, headersAirtable);
  if (knowledgeContent) {
    systemMessageContent += ` Available knowledge: "${knowledgeContent}".`;
  }

  // Fetch conversation history (optimized)
  let conversationContext = '';
  let existingRecordId = null;

  try {
    const chatUrl = `https://api.airtable.com/v0/${baseId}/${chatTable}`;
    const searchUrl = `${chatUrl}?filterByFormula=AND(SessionID="${sessionId}",ProjectID="${projectId}")&maxRecords=1`;
    
    const historyResponse = await fetch(searchUrl, { 
      headers: headersAirtable,
      signal: AbortSignal.timeout(3000)
    });
    
    if (historyResponse.ok) {
      const result = await historyResponse.json();
      if (result.records.length > 0) {
        const fullConversation = result.records[0].fields.Conversation || '';
        existingRecordId = result.records[0].id;
        
        // Summarize long conversations
        conversationContext = summarizeConversation(fullConversation);
        systemMessageContent += ` Recent conversation: "${conversationContext}".`;
      }
    }
  } catch (error) {
    console.error(`Error fetching conversation history:`, error);
    // Continue without history rather than failing
  }

  const currentTimePDT = getCurrentTimeInPDT();
  systemMessageContent += ` Current time in PDT: ${currentTimePDT}.`;
  
  if (projectId && projectId !== 'default') {
    systemMessageContent += ` You are assisting with the ${projectId} project.`;
  }

  // Handle audio data
  if (audioData) {
    return handleAudioMessage(audioData, systemMessageContent, sessionId, projectId, chatUrl, headersAirtable, conversationContext, existingRecordId, res);
  }

  // Handle text message
  try {
    console.log('Processing text message...');
    const startTime = Date.now();
    
    const aiReply = await getOptimizedTextResponse(userMessage, systemMessageContent);
    
    console.log(`OpenAI response time: ${Date.now() - startTime}ms`);
    
    if (aiReply) {
      // Update Airtable asynchronously - don't wait for it
      updateAirtableConversation(
        sessionId, 
        projectId, 
        chatUrl, 
        headersAirtable, 
        `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`, 
        existingRecordId
      ).catch(err => console.error('Failed to update Airtable:', err));
      
      return res.json({ reply: aiReply });
    } else {
      return res.status(500).json({ error: 'No text reply received from OpenAI.' });
    }
  } catch (error) {
    console.error('Error fetching text response from OpenAI:', error);
    return res.status(500).json({ error: 'Error fetching text response from OpenAI.', details: error.message });
  }
}

async function handleAudioMessage(audioData, systemMessageContent, sessionId, projectId, chatUrl, headersAirtable, conversationContext, existingRecordId, res) {
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
          // Update Airtable asynchronously
          updateAirtableConversation(
            sessionId, 
            projectId, 
            chatUrl, 
            headersAirtable, 
            `${conversationContext}\nUser: [Voice Message]\nAI: ${aiReply}`, 
            existingRecordId
          ).catch(err => console.error('Failed to update Airtable:', err));
          
          res.json({ reply: aiReply });
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
}

async function getOptimizedTextResponse(userMessage, systemMessageContent) {
  try {
    const messages = [
      { role: 'system', content: systemMessageContent },
      { role: 'user', content: userMessage }
    ];
    
    // Use streaming for faster perceived response
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
        temperature: 0.7,
        stream: false // Set to true if you want to implement streaming
      }),
      signal: AbortSignal.timeout(8000) // 8 second timeout
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('OpenAI API error:', response.status, errorData);
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content;
    } else {
      console.error('No valid choices in OpenAI response.');
      return null;
    }
  } catch (error) {
    console.error('Error in getOptimizedTextResponse:', error);
    throw error;
  }
}

async function updateAirtableConversation(sessionId, projectId, chatUrl, headersAirtable, updatedConversation, existingRecordId) {
  try {
    // Keep only recent conversation history
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
        signal: AbortSignal.timeout(5000)
      });
      console.log(`Updated conversation for project: ${projectId}, session: ${sessionId}`);
    } else {
      await fetch(chatUrl, {
        method: 'POST',
        headers: headersAirtable,
        body: JSON.stringify(recordData),
        signal: AbortSignal.timeout(5000)
      });
      console.log(`Created new conversation for project: ${projectId}, session: ${sessionId}`);
    }
  } catch (error) {
    console.error('Error updating Airtable conversation:', error);
    // Don't throw - this is non-critical
  }
}
