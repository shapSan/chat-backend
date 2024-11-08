// Updated version of /api/chatWithOpenAI.js to integrate Realtime API for audio handling with enhanced logging and improved CORS handling

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
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');

  if (req.method === 'OPTIONS') {
    // Preflight request handling for CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      const { userMessage, sessionId, audioData } = req.body;

      // Log incoming data for debugging
      console.log('Received POST request with data:', { userMessage, sessionId, audioDataLength: audioData ? audioData.length : 0 });

      // Validate that sessionId is present, and that either userMessage or audioData is provided
      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
      }
      if (!userMessage && !audioData) {
        return res.status(400).json({
          error: 'Missing required fields',
          details: 'Either userMessage or audioData along with sessionId is required.',
        });
      }

      // System context for OpenAI API, based on knowledge base and conversation history
      let systemMessageContent = `You are a helpful assistant specialized in AI & Automation.`;
      let conversationContext = '';
      let existingRecordId = null;

      // Fetch knowledge base and conversation history
      const airtableBaseId = 'appTYnw2qIaBIGRbR';
      const knowledgeBaseUrl = `https://api.airtable.com/v0/${airtableBaseId}/Chat-KnowledgeBase`;
      const eagleViewChatUrl = `https://api.airtable.com/v0/${airtableBaseId}/EagleView_Chat`;
      const headersAirtable = { 'Content-Type': 'application/json', Authorization: `Bearer ${airtableApiKey}` };

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

      // Handle Audio Data if provided using Realtime API
      if (audioData) {
        handleAudioDataWithRealtimeAPI(audioData, systemMessageContent, sessionId, conversationContext, eagleViewChatUrl, headersAirtable, existingRecordId, res);
      } else if (userMessage) {
        // Text message processing with OpenAI Chat Completion API
        const aiReply = await getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent);
        const updatedConversation = `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`;
        await updateAirtableConversation(sessionId, eagleViewChatUrl, headersAirtable, updatedConversation, existingRecordId);
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.json({ reply: aiReply });
      }

    } catch (error) {
      console.error('Error in handler:', error);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(405).json({ error: 'Method not allowed' });
  }
}

function handleAudioDataWithRealtimeAPI(audioData, systemMessageContent, sessionId, conversationContext, eagleViewChatUrl, headersAirtable, existingRecordId, res) {
  try {
    // Establish WebSocket connection to OpenAI Realtime API
    const wsUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
    const ws = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${openAIApiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    ws.on('open', () => {
      console.log('Connected to OpenAI Realtime API');
      ws.send(JSON.stringify({
        type: 'session.update',
        session: { instructions: systemMessageContent },
      }));
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: audioData }));
      ws.send(JSON.stringify({
        type: 'response.create',
        response: { modalities: ['text'], instructions: 'Please respond to the user.' },
      }));
    });

    ws.on('message', async (message) => {
      console.log('Received message from OpenAI Realtime API:', message);
      const event = JSON.parse(message);
      if (event.type === 'conversation.item.created' && event.item.role === 'assistant') {
        const aiReply = event.item.content.filter((content) => content.type === 'text').map((content) => content.text).join('');

        // Update Airtable with conversation
        const updatedConversation = `${conversationContext}\nUser: [Voice Message]\nAI: ${aiReply}`;
        console.log('Updating Airtable with conversation:', updatedConversation);
        await updateAirtableConversation(sessionId, eagleViewChatUrl, headersAirtable, updatedConversation, existingRecordId);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({ reply: aiReply });
        ws.close();
      }
    });

    ws.on('error', (error) => {
      console.error('Error with OpenAI WebSocket:', error);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(500).json({ error: 'Failed to communicate with OpenAI', details: error.message });
      ws.terminate(); // Properly close the WebSocket on error
    });

    ws.on('close', (code, reason) => {
      console.log(`WebSocket connection closed: code=${code}, reason=${reason}`);
    });

  } catch (error) {
    console.error('Error processing audio data:', error);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: 'Failed to process audio data', details: error.message });
  }
}

// Utility function to get text response from OpenAI
async function getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent) {
  const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
