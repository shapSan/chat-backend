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

// Project configuration mapping
const PROJECT_CONFIGS = {
  'default': {
    baseId: 'appTYnw2qIaBIGRbR',
    chatTable: 'EagleView_Chat',
    knowledgeTable: 'Chat-KnowledgeBase'
  },
  'HB-PitchAssist': {
    baseId: 'apphslK7rslGb7Z8K',
    chatTable: 'Chat-Conversations',
    knowledgeTable: 'Chat-KnowledgeBase'
  },
  'real-estate': {
    baseId: 'appYYYYYYYYYYYYYY', // Replace with actual base ID
    chatTable: 'RealEstate_Chat',
    knowledgeTable: 'RealEstate_Knowledge'
  },
  'healthcare': {
    baseId: 'appZZZZZZZZZZZZZZ', // Replace with actual base ID
    chatTable: 'Healthcare_Chat',
    knowledgeTable: 'Healthcare_Knowledge'
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

export default async function handler(req, res) {
  // ✅ FIX 1: Set CORS headers early (before any conditionals)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // ✅ respond early for preflight
  }

  if (req.method === 'POST') {
    try {
      // ✅ FIX 2: Destructure userMessage properly and handle truncation correctly
      let { userMessage, sessionId, audioData, projectId } = req.body;

      // ✅ FIX 3: Truncate AFTER destructuring, not before
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

            // ✅ FIX 4: Truncate long history to avoid OpenAI errors
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
                await updateAirtableConversation(
                  sessionId, 
                  projectId, 
                  chatUrl, 
                  headersAirtable, 
                  `${conversationContext}\nUser: [Voice Message]\nAI: ${aiReply}`, 
                  existingRecordId
                );
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
      } else if (userMessage) {
        try {
          console.log('Sending text message to OpenAI:', { 
            userMessageLength: userMessage.length, 
            systemMessageLength: systemMessageContent.length 
          });
          const aiReply = await getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent);
          console.log('Received AI response:', aiReply ? aiReply.slice(0, 100) + '...' : null);
          if (aiReply) {
            await updateAirtableConversation(
              sessionId, 
              projectId, 
              chatUrl, 
              headersAirtable, 
              `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`, 
              existingRecordId
            );
            return res.json({ reply: aiReply });
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
    // ✅ FIX 5: Add better error handling and message length validation
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
    // ✅ FIX 6: Truncate conversation before saving to Airtable to avoid size limits
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
