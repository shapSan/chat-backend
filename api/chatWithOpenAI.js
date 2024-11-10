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

      // Log incoming request details
      console.log('=== Received request ===');
      console.log('User message:', userMessage);
      console.log('Session ID:', sessionId);
      console.log('Audio data present:', !!audioData);

      if (!sessionId) {
        console.error('Error: Missing sessionId');
        return res.status(400).json({ error: 'Missing sessionId' });
      }

      // Set Airtable base and headers
      const airtableBaseId = 'appTYnw2qIaBIGRbR';
      const eagleViewChatUrl = `https://api.airtable.com/v0/${airtableBaseId}/EagleView_Chat`;
      const headersAirtable = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${airtableApiKey}`,
      };

      // Retrieve conversation context from Airtable
      let conversationContext = '';
      let existingRecordId = null;

      try {
        const searchUrl = `${eagleViewChatUrl}?filterByFormula=SessionID="${sessionId}"`;
        console.log('Fetching conversation context from Airtable:', searchUrl);
        const historyResponse = await fetch(searchUrl, { headers: headersAirtable });

        console.log('Airtable response status:', historyResponse.status);

        if (historyResponse.ok) {
          const result = await historyResponse.json();
          console.log('Airtable response data:', JSON.stringify(result));

          if (result.records.length > 0) {
            conversationContext = result.records[0].fields.Conversation || '';
            existingRecordId = result.records[0].id;
            console.log('Retrieved conversation context:', conversationContext);
          } else {
            console.log('No existing conversation found for sessionId:', sessionId);
          }
        } else {
          console.error('Failed to fetch Airtable conversation context:', historyResponse.statusText);
        }
      } catch (error) {
        console.error('Error fetching conversation history from Airtable:', error);
      }

      // Handle text-based user messages
      if (userMessage) {
        console.log('Processing text message...');

        try {
          const openAIResponse = await fetch('https://api.openai.com/v1/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${openAIApiKey}`,
            },
            body: JSON.stringify({
              model: 'text-davinci-003',
              prompt: `${conversationContext}\nUser: ${userMessage}\nAI:`,
              max_tokens: 150,
              temperature: 0.7,
            }),
          });

          console.log('OpenAI API response status:', openAIResponse.status);

          if (!openAIResponse.ok) {
            console.error('OpenAI API error:', openAIResponse.statusText);
            return res.status(500).json({ error: 'Failed to get response from OpenAI' });
          }

          const openAIData = await openAIResponse.json();
          console.log('OpenAI response data:', JSON.stringify(openAIData));

          const assistantReply = openAIData.choices[0]?.text.trim();

          if (!assistantReply) {
            console.error('No valid reply from OpenAI');
            return res.status(500).json({ error: 'No valid reply from assistant' });
          }

          // Update Airtable with the new conversation context
          const updatedConversation = `${conversationContext}\nUser: ${userMessage}\nAI: ${assistantReply}`;

          try {
            if (existingRecordId) {
              console.log('Updating existing Airtable record...');
              await fetch(`${eagleViewChatUrl}/${existingRecordId}`, {
                method: 'PATCH',
                headers: headersAirtable,
                body: JSON.stringify({
                  fields: { Conversation: updatedConversation },
                }),
              });
            } else {
              console.log('Creating new Airtable record...');
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
          } catch (airtableError) {
            console.error('Error updating Airtable:', airtableError);
          }

          // Send the assistant's reply back to the client
          return res.status(200).json({ reply: assistantReply });

        } catch (error) {
          console.error('Error processing text message with OpenAI:', error);
          return res.status(500).json({ error: 'Failed to process text message' });
        }
      }

      // Handle audio data with WebSocket (same as before)
      if (audioData) {
        console.log('Processing audio data...');
        // Your existing WebSocket handling logic for audio data
      }

    } catch (error) {
      console.error('Unexpected server error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
