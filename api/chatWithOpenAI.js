// /api/chatWithOpenAI.js

import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config();

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const openAIApiKey = process.env.OPENAI_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); // Replace '*' with your domain in production
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
      });

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
      }

      if (audioData) {
        console.log('Processing audio data...');

        if (!openAIApiKey) {
          return res.status(500).json({ error: 'OpenAI API key not configured' });
        }

        // Initialize WebSocket connection to OpenAI Realtime API
        const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'OpenAI-Beta': 'realtime=v1',
          },
        });

        let responseSent = false;

        ws.on('open', () => {
          console.log('WebSocket connected to OpenAI Realtime API');

          // Initialize session with instructions
          const sessionInitEvent = {
            type: 'session.update',
            session: {
              instructions: "You are a helpful, friendly AI assistant.",
              voice: "alloy", // Choose desired voice
            },
          };
          ws.send(JSON.stringify(sessionInitEvent));

          // Send user audio
          const audioEvent = {
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  audio: audioData, // Base64 encoded audio
                },
              ],
            },
          };
          ws.send(JSON.stringify(audioEvent));
        });

        ws.on('message', (data) => {
          const event = JSON.parse(data);
          console.log('Received event from OpenAI:', event);

          if (event.type === 'conversation.item.create' && event.item.role === 'assistant') {
            if (event.item.content) {
              event.item.content.forEach(async (content) => {
                if (content.type === 'text') {
                  // Send text response back to frontend
                  res.write(JSON.stringify({ reply: content.text }));
                } else if (content.type === 'audio') {
                  // Send audio response back to frontend
                  res.write(JSON.stringify({ audio: content.audio }));
                }
              });
            }
          } else if (event.type === 'response.done') {
            if (!responseSent) {
              responseSent = true;
              res.end();
              ws.close();
            }
          } else if (event.type === 'error') {
            console.error('OpenAI Realtime API Error:', event.error);
            if (!responseSent) {
              responseSent = true;
              res.status(500).json({ error: 'OpenAI Realtime API Error', details: event.error });
              ws.close();
            }
          }
        });

        ws.onerror = (error) => {
          console.error('WebSocket Error:', error);
          if (!responseSent) {
            responseSent = true;
            res.status(500).json({ error: 'WebSocket connection failed', details: error.message });
          }
        };

        ws.on('close', () => {
          console.log('WebSocket connection closed');
          if (!responseSent) {
            responseSent = true;
            res.end();
          }
        });

      } else if (userMessage) {
        // Handle text messages as per your existing implementation
        setIsTyping(true);
        // Example: Use OpenAI's Chat Completion API for text messages
        const { Configuration, OpenAIApi } = require("openai");
        const configuration = new Configuration({
          apiKey: openAIApiKey,
        });
        const openai = new OpenAIApi(configuration);

        const completion = await openai.createChatCompletion({
          model: "gpt-4",
          messages: [{ role: "user", content: userMessage }],
        });

        const reply = completion.data.choices[0].message?.content;
        if (reply) {
          addMessage("assistant", reply, "text");
          res.json({ reply: reply });
        } else {
          res.status(500).json({ error: "No reply from assistant" });
        }

        setIsTyping(false);
      } else {
        return res.status(400).json({ error: 'No valid input provided' });
      }

    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method Not Allowed' });
  }
}
