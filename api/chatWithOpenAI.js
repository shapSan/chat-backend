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
        
        const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'OpenAI-Beta': 'realtime=v1'
          }
        });

        let aiResponse = '';

        ws.on('open', () => {
          console.log('WebSocket connected');
          
          // Initial session setup
          ws.send(JSON.stringify({
            type: 'session.update',
            session: {
              instructions: `Previous conversation: ${conversationContext}`,
              voice: 'alloy',
              turn_detection: 'server_vad',
              input_audio_transcription: { model: 'whisper-1' }
            }
          }));

          // Send the audio data
          ws.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{
                type: 'input_audio',
                audio: audioData
              }]
            }
          }));

          // Request response with both text and audio
          ws.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['text', 'audio']
            }
          }));
        });

        ws.on('message', async (data) => {
          try {
            const event = JSON.parse(data.toString());
            console.log('Received event:', event.type);

            switch(event.type) {
              case 'input_audio_buffer.speech_started':
                console.log('Speech started');
                break;

              case 'input_audio_buffer.speech_stopped':
                console.log('Speech stopped');
                break;

              case 'response.text.delta':
                if (event.delta) {
                  aiResponse += event.delta;
                  // Send partial text response to client
                  res.write(JSON.stringify({
                    type: 'text',
                    data: event.delta
                  }));
                }
                break;

              case 'response.audio.delta':
                if (event.audio) {
                  // Send audio chunk to client
                  res.write(JSON.stringify({
                    type: 'audio',
                    data: event.audio
                  }));
                }
                break;

              case 'response.done':
                // Update Airtable conversation
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

                res.end(JSON.stringify({ type: 'done', reply: aiResponse }));
                ws.close();
                break;

              case 'error':
                console.error('Received error event:', event.error);
                ws.close();
                res.status(500).json({ error: event.error.message });
                break;
            }
          } catch (error) {
            console.error('Error processing message:', error);
            ws.close();
            res.status(500).json({ error: 'Error processing response' });
          }
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          res.status(500).json({ error: 'WebSocket connection failed' });
        });

        // Clean up on client disconnect
        res.on('close', () => {
          if (ws.readyState === ws.OPEN) {
            ws.close();
          }
        });

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
