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

export default async function handler(req, res) {
  // Setting CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', 'https://www.selfrun.ai'); // Set to your domain
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    try {
      const { userMessage, sessionId, audioData } = req.body;

      // Logging the request data to verify if data is missing or malformed
      console.log('Received request:', { userMessage, sessionId, audioData });

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
      }

      if (!userMessage && !audioData) {
        return res.status(400).json({ error: 'Missing userMessage or audioData' });
      }

      // Airtable base and URL setup
      const airtableBaseUrl = `https://api.airtable.com/v0/appTYnw2qIaBIGRbR/EagleView_Chat`;
      const airtableHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${airtableApiKey}`,
      };

      let conversationContext = '';
      let existingRecordId = null;

      // Retrieve existing conversation from Airtable for sessionId
      try {
        const searchUrl = `${airtableBaseUrl}?filterByFormula=SessionID="${sessionId}"`;
        const historyResponse = await fetch(searchUrl, { headers: airtableHeaders });
        
        // Logging Airtable API response
        console.log('Airtable history response status:', historyResponse.status);

        if (historyResponse.ok) {
          const result = await historyResponse.json();
          if (result.records.length > 0) {
            conversationContext = result.records[0].fields.Conversation || '';
            existingRecordId = result.records[0].id;
            console.log('Existing conversation found:', conversationContext);
          }
        } else {
          console.error('Failed to fetch conversation history:', historyResponse.statusText);
        }
      } catch (error) {
        console.error('Error fetching conversation history:', error);
      }

      // Handling text-based user messages
      if (userMessage) {
        console.log('Processing text message...');

        // Append conversation context for better response
        const prompt = `${conversationContext}\nUser: ${userMessage}\nAI:`;
        try {
          const response = await fetch('https://api.openai.com/v1/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${openAIApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'text-davinci-003',
              prompt,
              max_tokens: 150,
            }),
          });

          // Logging OpenAI response status
          console.log('OpenAI response status:', response.status);

          if (response.ok) {
            const data = await response.json();
            const reply = data.choices?.[0]?.text.trim() || 'Sorry, I couldn’t understand that.';

            // Send reply to frontend
            res.status(200).json({ reply });

            // Update Airtable with new conversation
            const updatedConversation = `${conversationContext}\nUser: ${userMessage}\nAI: ${reply}`;
            try {
              if (existingRecordId) {
                console.log('Updating existing Airtable record...');
                await fetch(`${airtableBaseUrl}/${existingRecordId}`, {
                  method: 'PATCH',
                  headers: airtableHeaders,
                  body: JSON.stringify({
                    fields: { Conversation: updatedConversation },
                  }),
                });
              } else {
                console.log('Creating new Airtable record...');
                await fetch(airtableBaseUrl, {
                  method: 'POST',
                  headers: airtableHeaders,
                  body: JSON.stringify({
                    fields: {
                      SessionID: sessionId,
                      Conversation: updatedConversation,
                    },
                  }),
                });
              }
            } catch (airtableError) {
              console.error('Error updating Airtable:', airtableError);
            }
          } else {
            console.error('OpenAI API Error:', response.statusText);
            res.status(500).json({ error: 'Failed to get response from OpenAI' });
          }
        } catch (apiError) {
          console.error('Unexpected error during OpenAI request:', apiError);
          res.status(500).json({ error: 'Internal server error' });
        }
      }

      // Handling audio data with WebSocket (only proceed if userMessage wasn't provided)
      if (audioData) {
        console.log('Processing audio data...');
        try {
          const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
            headers: {
              Authorization: `Bearer ${openAIApiKey}`,
              'OpenAI-Beta': 'realtime=v1',
              'Content-Type': 'application/json',
            },
            followRedirects: true,
          });

          ws.onopen = () => {
            console.log('WebSocket connected to OpenAI');
            ws.send(JSON.stringify({
              type: 'session.update',
              session: {
                instructions: `Previous conversation: ${conversationContext}`,
                turn_detection: 'server_vad',
              },
            }));
            ws.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: audioData,
            }));
            ws.send(JSON.stringify({
              type: 'response.create',
              response: {
                modalities: ['text'],
              },
            }));
          };

          ws.onmessage = async (event) => {
            try {
              const data = JSON.parse(event.data);
              console.log('Received event:', data.type);

              if (data.type === 'response.done') {
                const updatedConversation = `${conversationContext}\nUser: [Voice Message]\nAI: ${data.text || ''}`;
                if (existingRecordId) {
                  await fetch(`${airtableBaseUrl}/${existingRecordId}`, {
                    method: 'PATCH',
                    headers: airtableHeaders,
                    body: JSON.stringify({
                      fields: { Conversation: updatedConversation },
                    }),
                  });
                } else {
                  await fetch(airtableBaseUrl, {
                    method: 'POST',
                    headers: airtableHeaders,
                    body: JSON.stringify({
                      fields: {
                        SessionID: sessionId,
                        Conversation: updatedConversation,
                      },
                    }),
                  });
                }
                res.status(200).json({ type: 'done' });
                ws.close();
              } else if (data.type === 'error') {
                console.error('WebSocket Error:', data.error);
                res.status(500).json({ error: data.error.message });
                ws.close();
              }
            } catch (error) {
              console.error('Error processing WebSocket message:', error);
              res.status(500).json({ error: 'Error processing response' });
              ws.close();
            }
          };

          ws.onclose = () => {
            console.log('WebSocket closed');
          };
        } catch (wsError) {
          console.error('Error setting up WebSocket:', wsError);
          res.status(500).json({ error: 'Failed to set up WebSocket connection' });
        }
      }

    } catch (error) {
      console.error('Unexpected error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
