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
      // In your chatWithOpenAI.js, modify the WebSocket connection part:

if (audioData) {
    console.log('Processing audio data...');

    try {
        // Correct WebSocket URL from the documentation
        const ws = new WebSocket('wss://api.openai.com/v1/audio/speech', {
            headers: {
                'Authorization': `Bearer ${openAIApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
            return res.status(500).json({ 
                error: 'WebSocket connection failed',
                details: error.message 
            });
        };

        ws.onopen = () => {
            console.log('WebSocket connected');
            
            // Send audio using the correct message format
            ws.send(JSON.stringify({
                type: 'message',
                message: {
                    role: 'user',
                    content: audioData
                }
            }));
        };

        ws.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received event:', data.type);

                if (data.type === 'message' && data.message.role === 'assistant') {
                    // Handle assistant's response
                    const aiResponse = data.message.content;
                    
                    // Update Airtable
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
                console.error('Error processing message:', error);
                ws.close();
                res.status(500).json({ error: 'Error processing response' });
            }
        };

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
}
