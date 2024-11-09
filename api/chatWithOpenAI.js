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
        audioDataLength: audioData ? audioData.length : 0,
        hasOpenAIKey: !!openAIApiKey,
        hasAirtableKey: !!airtableApiKey
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
        console.log('Processing audio data...', {
          hasOpenAIKey: !!openAIApiKey,
          audioDataLength: audioData.length,
          sessionId
        });

        // First, test the OpenAI API access
        try {
          const testResponse = await fetch('https://api.openai.com/v1/realtime/status', {
            headers: {
              'Authorization': `Bearer ${openAIApiKey}`,
              'OpenAI-Beta': 'realtime=v1'
            }
          });
          
          if (!testResponse.ok) {
            const errorData = await testResponse.json();
            console.error('OpenAI API access error:', errorData);
            return res.status(500).json({ 
              error: 'OpenAI API access error',
              details: errorData 
            });
          }

          // Set up WebSocket connection
          const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
            headers: {
              'Authorization': `Bearer ${openAIApiKey}`,
              'OpenAI-Beta': 'realtime=v1'
            }
          });

          // Handle connection error
          ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
            return res.status(500).json({ 
              error: 'WebSocket connection failed',
              details: error.message 
            });
          };

          // Handle connection open
          ws.onopen = () => {
            console.log('WebSocket connected to OpenAI');
            
            // Send initial configuration
            ws.send(JSON.stringify({
              type: 'session.update',
              session: {
                instructions: `Previous conversation: ${conversationContext}`,
                turn_detection: 'server_vad'
              }
            }));

            // Send audio data
            ws.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: audioData
            }));

            // Request response
            ws.send(JSON.stringify({
              type: 'response.create',
              response: {
                modalities: ['text']
              }
            }));
          };

          // Handle messages
          ws.onmessage = async (event) => {
            try {
              const data = JSON.parse(event.data);
              console.log('Received event:', data.type);

              switch(data.type) {
                case 'response.text.delta':
                  if (data.delta) {
                    res.write(JSON.stringify({ type: 'text', data: data.delta }));
                  }
                  break;

                case 'response.done':
                  const updatedConversation = `${conversationContext}\nUser: [Voice Message]\nAI: ${data.text || ''}`;
                  
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

                  res.write(JSON.stringify({ type: 'done' }));
                  res.end();
                  ws.close();
                  break;

                case 'error':
                  console.error('OpenAI API Error:', data.error);
                  res.status(500).json({ error: data.error.message });
                  ws.close();
                  break;
              }
            } catch (error) {
              console.error('Error processing message:', error);
              res.status(500).json({ error: 'Error processing response' });
              ws.close();
            }
          };

          // Handle connection close
          ws.onclose = () => {
            console.log('WebSocket closed');
          };

        } catch (error) {
          console.error('Setup error:', error);
          return res.status(500).json({ 
            error: 'Setup failed',
            details: error.message 
          });
        }

      } else if (userMessage) {
        // Handle text messages with regular completions API
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openAIApiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [
              {
                role: 'system',
                content: `Previous conversation: ${conversationContext}\nCurrent time: ${getCurrentTimeInPDT()}`
              },
              { role: 'user', content: userMessage }
            ],
            max_tokens: 500,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to get completion');
        }

        const completion = await response.json();
        const aiReply = completion.choices[0].message.content;

        // Update conversation in Airtable
        const updatedConversation = `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`;
        
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

        return res.json({ reply: aiReply });
      } else {
        return res.status(400).json({ error: 'Missing message content' });
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
