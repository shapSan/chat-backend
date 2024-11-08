// /api/chatWithOpenAI.ts

import dotenv from 'dotenv';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import type { NextApiRequest, NextApiResponse } from 'next';

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // **Set CORS headers for all responses**
  res.setHeader('Access-Control-Allow-Origin', '*'); // You can specify a specific origin instead of '*'
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    // **Handle preflight request**
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    try {
      const { userMessage, sessionId, audioData } = req.body;

      // Log incoming data for debugging
      console.log('Received POST request with data:', {
        userMessage,
        sessionId,
        audioDataLength: audioData ? audioData.length : 0,
      });

      // Validate that sessionId is present, and that either userMessage or audioData is provided
      if (!sessionId) {
        res.status(400).json({ error: 'Missing sessionId' });
        return;
      }
      if (!userMessage && !audioData) {
        res.status(400).json({
          error: 'Missing required fields',
          details: 'Either userMessage or audioData along with sessionId is required.',
        });
        return;
      }

      // System context for OpenAI API, based on knowledge base and conversation history
      let systemMessageContent = `You are a helpful assistant specialized in AI & Automation.`;
      let conversationContext = '';
      let existingRecordId = null;

      // Fetch knowledge base and conversation history
      const airtableBaseId = 'appTYnw2qIaBIGRbR';
      const knowledgeBaseUrl = `https://api.airtable.com/v0/${airtableBaseId}/Chat-KnowledgeBase`;
      const eagleViewChatUrl = `https://api.airtable.com/v0/${airtableBaseId}/EagleView_Chat`;
      const headersAirtable = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${airtableApiKey}`,
      };

      // Attempt to fetch knowledge base and conversation history
      try {
        const kbResponse = await fetch(knowledgeBaseUrl, { headers: headersAirtable });
        if (kbResponse.ok) {
          const knowledgeBaseData = await kbResponse.json();
          const knowledgeEntries = knowledgeBaseData.records.map((record) => record.fields.Summary).join('\n\n');
          systemMessageContent += ` Available knowledge: "${knowledgeEntries}".`;
        }
      } catch (error) {
        console.error('Error fetching knowledge base:', error);
      }

      try {
        const searchUrl = `${eagleViewChatUrl}?filterByFormula=SessionID="${sessionId}"`;
        const historyResponse = await fetch(searchUrl, { headers: headersAirtable });
        if (historyResponse.ok) {
          const result = await historyResponse.json();
          if (result.records.length > 0) {
            conversationContext = result.records[0].fields.Conversation || '';
            existingRecordId = result.records[0].id;
            systemMessageContent += ` Conversation so far: "${conversationContext}".`;
          }
        }
      } catch (error) {
        console.error('Error fetching conversation history:', error);
      }

      // Add current time to context
      const currentTimePDT = getCurrentTimeInPDT();
      systemMessageContent += ` Current time in PDT: ${currentTimePDT}.`;

      // Handle Audio Data if provided
      if (audioData) {
        // Decode Base64 to Buffer and set up WebSocket connection
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
          openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: audioData }));
          openaiWs.send(JSON.stringify({
            type: 'response.create',
            response: { modalities: ['text'], instructions: 'Please respond to the user.' },
          }));
        });

        openaiWs.on('message', async (message) => {
          const event = JSON.parse(message);
          if (event.type === 'conversation.item.created' && event.item.role === 'assistant') {
            const aiReply = event.item.content.filter((content) => content.type === 'text').map((content) => content.text).join('');

            // Update Airtable with conversation
            const updatedConversation = `${conversationContext}\nUser: [Voice Message]\nAI: ${aiReply}`;
            await updateAirtableConversation(sessionId, eagleViewChatUrl, headersAirtable, updatedConversation, existingRecordId);
            res.json({ reply: aiReply });
            openaiWs.close();
          }
        });

        openaiWs.on('error', (error) => {
          console.error('Error with OpenAI WebSocket:', error);
          res.status(500).json({ error: 'Failed to communicate with OpenAI' });
        });

      } else if (userMessage) {
        // Text message processing with OpenAI Chat Completion API
        const aiReply = await getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent);
        const updatedConversation = `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`;
        await updateAirtableConversation(sessionId, eagleViewChatUrl, headersAirtable, updatedConversation, existingRecordId);
        return res.json({ reply: aiReply });
      }

    } catch (error) {
      console.error('Error in handler:', error);
      // **Ensure CORS headers are set before sending the error response**
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

// Utility function to get text response from OpenAI
async function getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent) {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemMessageContent },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 500,
    }),
  });

  const openaiData = await openaiResponse.json();
  return openaiData.choices[0].message.content;
}

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
