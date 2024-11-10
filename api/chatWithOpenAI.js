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

// ... (keep the getCurrentTimeInPDT function as is)

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

      console.log('Received POST request with data:', { 
        userMessage, 
        sessionId, 
        audioDataLength: audioData ? audioData.length : 0 
      });

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
      }
      if (!userMessage && !audioData) {
        return res.status(400).json({
          error: 'Missing required fields',
          details: 'Either userMessage or audioData along with sessionId is required.',
        });
      }

      let systemMessageContent = "You are a helpful assistant specialized in AI & Automation.";
      let conversationContext = '';
      let existingRecordId = null;

      // ... (keep the knowledge base and conversation history fetching logic as is)

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
              const aiReply = event.item.content.filter((content) => content.type === 'text').map((content) => content.text).join('');

              if (aiReply) {
                const updatedConversation = `${conversationContext}\nUser: [Voice Message]\nAI: ${aiReply}`;
                await updateAirtableConversation(sessionId, eagleViewChatUrl, headersAirtable, updatedConversation, existingRecordId);
                res.json({ reply: aiReply });
              } else {
                console.error('No valid reply received from OpenAI WebSocket.');
                res.status(500).json({ error: 'No valid reply received from OpenAI.' });
              }
              openaiWs.close();
            }
          });

          openaiWs.on('error', (error) => {
            console.error('Error with OpenAI WebSocket:', error);
            res.status(500).json({ error: 'Failed to communicate with OpenAI' });
          });

          // Add a timeout to close the connection if no response is received
          setTimeout(() => {
            if (openaiWs.readyState === WebSocket.OPEN) {
              console.error('WebSocket connection timed out');
              openaiWs.close();
              res.status(504).json({ error: 'Request timed out' });
            }
          }, 30000); // 30 seconds timeout

        } catch (error) {
          console.error('Error processing audio data:', error);
          res.status(500).json({ error: 'Error processing audio data.', details: error.message });
        }
      } else if (userMessage) {
        try {
          const aiReply = await getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent);
          if (aiReply) {
            const updatedConversation = `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`;
            await updateAirtableConversation(sessionId, eagleViewChatUrl, headersAirtable, updatedConversation, existingRecordId);
            return res.json({ reply: aiReply });
          } else {
            console.error('No text reply received from OpenAI. Response data:', aiReply);
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
    res.status(405).json({ error: 'Method not allowed' });
  }
}

// ... (keep the utility functions as is)

// Utility function to update conversation in Airtable
async function updateAirtableConversation(sessionId, eagleViewChatUrl, headersAirtable, updatedConversation, existingRecordId) {
  try {
    if (existingRecordId) {
      await fetch(`${eagleViewChatUrl}/${existingRecordId}`, {
        method: 'PATCH',
        headers: headersAirtable,
        body: JSON.stringify({ fields: { Conversation: updatedConversation } }),
      });
    } else {
      await fetch(eagleViewChatUrl, {
        method: 'POST',
        headers: headersAirtable,
        body: JSON.stringify({ fields: { SessionID: sessionId, Conversation: updatedConversation } }),
      });
    }
  } catch (error) {
    console.error('Error updating Airtable conversation:', error);
  }
}
