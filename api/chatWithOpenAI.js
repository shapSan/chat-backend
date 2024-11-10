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
  res.setHeader('Access-Control-Allow-Origin', 'https://www.selfrun.ai'); // Update to match your domain
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    // Handling preflight request
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    try {
      const { userMessage, sessionId, audioData } = req.body;

      console.log('Received request:', {
        hasUserMessage: !!userMessage,
        sessionId,
        hasAudioData: !!audioData,
        audioDataLength: audioData ? audioData.length : 0,
      });

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
      }

      // Handle audio data if provided
      if (audioData) {
        console.log('Processing audio data...');
        
        try {
          // Create WebSocket connection to OpenAI (replace with your endpoint if needed)
          const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
            headers: {
              'Authorization': `Bearer ${openAIApiKey}`,
              'OpenAI-Beta': 'realtime=v1',
              'Content-Type': 'application/json',
            },
            followRedirects: true
          });

          ws.onopen = () => {
            console.log('WebSocket connected to OpenAI');
            
            // Send session update and audio data
            ws.send(JSON.stringify({
              type: 'session.update',
              session: {
                instructions: `Previous conversation: ${userMessage || ''}`,
                turn_detection: 'server_vad',
              }
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

              switch (data.type) {
                case 'response.text.delta':
                  if (data.delta) {
                    res.write(JSON.stringify({ type: 'text', data: data.delta }));
                  }
                  break;

                case 'response.done':
                  // Update conversation in Airtable
                  console.log('Updating Airtable...');
                  const updatedConversation = `${userMessage}\nUser: [Voice Message]\nAI: ${data.text || ''}`;
                  const airtableBaseUrl = `https://api.airtable.com/v0/appTYnw2qIaBIGRbR/EagleView_Chat`;

                  try {
                    await fetch(airtableBaseUrl, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${airtableApiKey}`,
                      },
                      body: JSON.stringify({
                        fields: {
                          SessionID: sessionId,
                          Conversation: updatedConversation,
                        }
                      }),
                    });
                  } catch (airtableError) {
                    console.error('Error updating Airtable:', airtableError);
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
            } catch (messageError) {
              console.error('Error processing message:', messageError);
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

        return;
      }

      // Handling text message scenario
      if (userMessage) {
        console.log('Processing text message...');
        // Make a request to OpenAI API using your preferred method here
        const response = await fetch('https://api.openai.com/v1/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-davinci-003',
            prompt: userMessage,
            max_tokens: 150,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log('OpenAI response:', data);
          const reply = data.choices?.[0]?.text || 'Sorry, I couldn’t understand that.';

          // Send response to client
          res.status(200).json({ reply });

          // Optionally, update Airtable with conversation history
          const airtableBaseUrl = `https://api.airtable.com/v0/appTYnw2qIaBIGRbR/EagleView_Chat`;
          const updatedConversation = `${userMessage}\nAI: ${reply}`;

          try {
            await fetch(airtableBaseUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${airtableApiKey}`,
              },
              body: JSON.stringify({
                fields: {
                  SessionID: sessionId,
                  Conversation: updatedConversation,
                }
              }),
            });
          } catch (airtableError) {
            console.error('Error updating Airtable:', airtableError);
          }

        } else {
          console.error('Error from OpenAI API:', response.status, response.statusText);
          res.status(500).json({ error: 'Failed to get response from OpenAI' });
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
