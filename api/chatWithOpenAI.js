// /api/chatWithOpenAI.js

import dotenv from 'dotenv';
import fetch from 'node-fetch';
import WebSocket from 'ws';

dotenv.config();

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Increase the limit as needed
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
    try {
      const { userMessage, sessionId, audioData } = req.body;

      console.log('Received POST request');
      console.log('Content-Type:', req.headers['content-type']);
      console.log('Request body:', req.body);
      console.log('userMessage:', userMessage);
      console.log('sessionId:', sessionId);
      console.log('audioData length:', audioData ? audioData.length : 'No audioData');

      // Validate sessionId
      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
      }

      // Check if either userMessage or audioData is present
      if (!userMessage && !audioData) {
        return res.status(400).json({ error: 'Missing required fields', details: 'Both userMessage and sessionId are required' });
      }

      // Initialize system message and context for OpenAI
      let systemMessageContent = `You are a friendly, professional, and cheeky assistant specializing in AI & Automation.`;
      let conversationContext = '';
      let existingRecordId = null;

      // Fetch knowledge base from Airtable
      const knowledgeBaseTableName = 'Chat-KnowledgeBase';
      const airtableBaseId = 'appTYnw2qIaBIGRbR'; // Ensure this is set correctly
      const knowledgeBaseUrl = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(
        knowledgeBaseTableName
      )}`;
      const headersAirtable = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${airtableApiKey}`,
      };

      try {
        const kbResponse = await fetch(knowledgeBaseUrl, {
          headers: headersAirtable,
        });
        if (!kbResponse.ok)
          throw new Error('Failed to fetch knowledge base');

        const knowledgeBaseData = await kbResponse.json();

        if (knowledgeBaseData.records && knowledgeBaseData.records.length > 0) {
          const knowledgeEntries = knowledgeBaseData.records
            .map((record) => record.fields.Summary)
            .join('\n\n');
          systemMessageContent += ` You have the following knowledge available to assist: "${knowledgeEntries}".`;
        }
      } catch (error) {
        console.error('Error fetching knowledge base:', error);
      }

      // Fetch conversation history from Airtable
      const eagleViewChatTableName = 'EagleView_Chat';
      const eagleViewChatUrl = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(
        eagleViewChatTableName
      )}`;
      try {
        const searchUrl = `${eagleViewChatUrl}?filterByFormula=SessionID="${sessionId}"`;
        const historyResponse = await fetch(searchUrl, {
          headers: headersAirtable,
        });
        if (!historyResponse.ok)
          throw new Error('Failed to fetch conversation history');

        const result = await historyResponse.json();

        if (result.records && result.records.length > 0) {
          conversationContext = result.records[0].fields.Conversation || '';
          existingRecordId = result.records[0].id;
          systemMessageContent += ` Here's the conversation so far: "${conversationContext}".`;
        }
      } catch (error) {
        console.error('Error fetching conversation history:', error);
      }

      // Add current time to context
      const currentTimePDT = getCurrentTimeInPDT();
      systemMessageContent += ` The current time in PDT is ${currentTimePDT}.`;

      if (audioData) {
        // Decode Base64 to Buffer
        const audioBuffer = Buffer.from(audioData, 'base64');

        // Connect to OpenAI Realtime API via WebSocket
        try {
          const openaiWsUrl =
            'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
          const openaiWs = new WebSocket(openaiWsUrl, {
            headers: {
              Authorization: 'Bearer ' + openAIApiKey,
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

              try {
                if (existingRecordId) {
                  // Update existing conversation
                  await fetch(`${eagleViewChatUrl}/${existingRecordId}`, {
                    method: 'PATCH',
                    headers: headersAirtable,
                    body: JSON.stringify({
                      fields: {
                        Conversation: updatedConversation,
                      },
                    }),
                  });
                } else {
                  // Create new conversation record
                  await fetch(eagleViewChatUrl, {
                    method: 'POST',
                    headers: headersAirtable,
                    body: JSON.stringify({
                      fields: {
                        SessionID: sessionId,
                        Conversation: updatedConversation,
                      },
                    }),
                  });
                }
              } catch (error) {
                console.error('Error updating Airtable conversation:', error);
              }

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
                Authorization: `Bearer ${openAIApiKey}`,
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

          try {
            if (existingRecordId) {
              // Update existing conversation
              await fetch(`${eagleViewChatUrl}/${existingRecordId}`, {
                method: 'PATCH',
                headers: headersAirtable,
                body: JSON.stringify({
                  fields: {
                    Conversation: updatedConversation,
                  },
                }),
              });
            } else {
              // Create new conversation record
              await fetch(eagleViewChatUrl, {
                method: 'POST',
                headers: headersAirtable,
                body: JSON.stringify({
                  fields: {
                    SessionID: sessionId,
                    Conversation: updatedConversation,
                  },
                }),
              });
            }
          } catch (error) {
            console.error('Error updating Airtable conversation:', error);
          }

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
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
