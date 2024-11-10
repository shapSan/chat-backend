// /api/chatWithOpenAI.js

require('dotenv').config();
const fetch = require('node-fetch');
const WebSocket = require('ws');

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
  // Handle CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { userMessage, sessionId, audioData } = JSON.parse(body);

        if (!sessionId) {
          return res.status(400).json({ error: 'Missing sessionId' });
        }

        // Initialize system message and context for OpenAI
        let systemMessageContent = `You are a friendly, professional, and cheeky assistant specializing in AI & Automation.`;
        let conversationContext = '';
        let existingRecordId = null;

        // Fetch knowledge base and conversation history from Airtable
        // ... (Include your existing code for fetching from Airtable)

        // Add current time to context
        const currentTimePDT = getCurrentTimeInPDT();
        systemMessageContent += ` The current time in PDT is ${currentTimePDT}.`;

        if (audioData) {
          // Handle audio data using OpenAI Realtime API
          try {
            const openaiWsUrl =
              'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
            const openaiWs = new WebSocket(openaiWsUrl, {
              headers: {
                Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
                'OpenAI-Beta': 'realtime=v1',
              },
            });

            openaiWs.on('open', () => {
              console.log('Connected to OpenAI Realtime API');

              // Send system message as session update
              const sessionUpdateEvent = {
                type: 'session.update',
                session: {
                  instructions: systemMessageContent,
                },
              };
              openaiWs.send(JSON.stringify(sessionUpdateEvent));

              // Send audio data
              const audioEvent = {
                type: 'input_audio_buffer.append',
                audio: audioData, // Already Base64 encoded
              };
              openaiWs.send(JSON.stringify(audioEvent));

              // Request a response
              const responseEvent = {
                type: 'response.create',
                response: {
                  modalities: ['text'],
                  instructions: 'Please assist the user.',
                },
              };
              openaiWs.send(JSON.stringify(responseEvent));
            });

            openaiWs.on('message', async (message) => {
              const event = JSON.parse(message);

              if (
                event.type === 'conversation.item.created' &&
                event.item.role === 'assistant'
              ) {
                const aiReply = event.item.content
                  .filter((contentPart) => contentPart.type === 'text')
                  .map((contentPart) => contentPart.text)
                  .join('');

                // Update conversation in Airtable
                const updatedConversation = `${conversationContext}\nUser: [Voice Message]\nAI: ${aiReply}`;

                // ... (Include your existing code for updating Airtable)

                // Send the reply back to the client
                res.json({ reply: aiReply });
                openaiWs.close();
              }
            });

            openaiWs.on('error', (error) => {
              console.error('Error with OpenAI WebSocket:', error);
              res
                .status(500)
                .json({ error: 'Failed to communicate with OpenAI' });
            });
          } catch (error) {
            console.error('Error with OpenAI Realtime API:', error);
            res
              .status(500)
              .json({ error: 'Failed to communicate with OpenAI' });
          }
        } else if (userMessage) {
          // Handle text message using OpenAI Chat Completion API
          try {
            const openaiResponse = await fetch(
              'https://api.openai.com/v1/chat/completions',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                  model: 'gpt-4',
                  messages: [
                    { role: 'system', content: systemMessageContent },
                    { role: 'user', content: userMessage },
                  ],
                  max_tokens: 500,
                }),
              }
            );

            if (!openaiResponse.ok) {
              const errorText = await openaiResponse.text();
              throw new Error(`OpenAI API error: ${errorText}`);
            }

            const openaiData = await openaiResponse.json();
            const aiReply = openaiData.choices[0].message.content;

            // Update conversation in Airtable
            const updatedConversation = `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`;

            // ... (Include your existing code for updating Airtable)

            return res.json({ reply: aiReply });
          } catch (error) {
            console.error('Error in OpenAI communication:', error);
            return res.status(500).json({
              error: 'Failed to communicate with OpenAI',
              details: error.message,
            });
          }
        } else {
          res.status(400).json({ error: 'No message or audio data provided' });
        }
      } catch (error) {
        console.error('Error in handler:', error);
        return res.status(500).json({
          error: 'Internal server error',
          details: error.message,
        });
      }
    });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
