// /api/chatWithOpenAI.js
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

// Keep track of active WebSocket connections
const activeConnections = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      const { userMessage, sessionId, audioData } = req.body;
      console.log('Received request:', { 
        hasUserMessage: !!userMessage, 
        sessionId, 
        hasAudioData: !!audioData,
        audioDataLength: audioData ? audioData.length : 0
      });

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
      }

      // Get conversation context from Airtable
      const airtableBaseId = 'appTYnw2qIaBIGRbR';
      const eagleViewChatUrl = `https://api.airtable.com/v0/${airtableBaseId}/EagleView_Chat`;
      const headersAirtable = { 
        'Content-Type': 'application/json', 
        Authorization: `Bearer ${airtableApiKey}` 
      };

      let conversationContext = '';
      let existingRecordId = null;

      try {
        const searchUrl = `${eagleViewChatUrl}?filterByFormula=SessionID="${sessionId}"`;
        const historyResponse = await fetch(searchUrl, { headers: headersAirtable });
        if (historyResponse.ok) {
          const result = await historyResponse.json();
          if (result.records.length > 0) {
            conversationContext = result.records[0].fields.Conversation || '';
            existingRecordId = result.records[0].id;
          }
        }
      } catch (error) {
        console.error('Error fetching conversation history:', error);
      }

      // Handle audio data
      if (audioData) {
        console.log('Processing audio data...');
        
        // Create WebSocket connection to OpenAI
        const ws = new WebSocket('wss://api.openai.com/v1/audio/speech', {
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json'
          }
        });

        let aiResponse = '';
        
        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          res.status(500).json({ error: 'WebSocket connection failed' });
        });

        ws.on('open', () => {
          console.log('WebSocket connected');
          
          // Send initial configuration
          ws.send(JSON.stringify({
            type: 'message',
            message: {
              role: 'system',
              content: `Current conversation context: ${conversationContext}`
            }
          }));

          // Send audio data
          ws.send(JSON.stringify({
            type: 'audio',
            audio: audioData
          }));
        });

        ws.on('message', async (data) => {
          try {
            const response = JSON.parse(data.toString());
            
            if (response.type === 'message' && response.message.role === 'assistant') {
              aiResponse += response.message.content;
            } else if (response.type === 'done') {
              // Update Airtable with the conversation
              const updatedConversation = `${conversationContext}\nUser: [Voice Message]\nAI: ${aiResponse}`;
              
              try {
                if (existingRecordId) {
                  await fetch(`${eagleViewChatUrl}/${existingRecordId}`, {
                    method: 'PATCH',
                    headers: headersAirtable,
                    body: JSON.stringify({
                      fields: { Conversation: updatedConversation }
                    }),
                  });
                } else {
                  await fetch(eagleViewChatUrl, {
                    method: 'POST',
                    headers: headersAirtable,
                    body: JSON.stringify({
                      fields: {
                        SessionID: sessionId,
                        Conversation: updatedConversation
                      }
                    }),
                  });
                }
              } catch (error) {
                console.error('Error updating Airtable:', error);
              }

              res.json({ reply: aiResponse });
              ws.close();
            }
          } catch (error) {
            console.error('Error processing WebSocket message:', error);
            ws.close();
            res.status(500).json({ error: 'Error processing audio response' });
          }
        });

        // Store the WebSocket connection
        activeConnections.set(sessionId, ws);

        // Clean up on client disconnect
        res.on('close', () => {
          if (activeConnections.has(sessionId)) {
            activeConnections.get(sessionId).close();
            activeConnections.delete(sessionId);
          }
        });
      } else if (userMessage) {
        // Handle text messages (existing code)
        const aiReply = await getTextResponseFromOpenAI(userMessage, conversationContext);
        const updatedConversation = `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`;
        
        await updateAirtableConversation(
          sessionId, 
          eagleViewChatUrl, 
          headersAirtable, 
          updatedConversation, 
          existingRecordId
        );
        
        return res.json({ reply: aiReply });
      }
    } catch (error) {
      console.error('Handler error:', error);
      return res.status(500).json({ 
        error: 'Internal server error', 
        details: error.message 
      });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

async function getTextResponseFromOpenAI(userMessage, context) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAIApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: `Context: ${context}` },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 500,
    }),
  });

  const data = await response.json();
  return data.choices[0].message.content;
}

async function updateAirtableConversation(sessionId, url, headers, conversation, recordId) {
  try {
    if (recordId) {
      await fetch(`${url}/${recordId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          fields: { Conversation: conversation }
        }),
      });
    } else {
      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fields: {
            SessionID: sessionId,
            Conversation: conversation
          }
        }),
      });
    }
  } catch (error) {
    console.error('Error updating Airtable:', error);
    throw error;
  }
}
