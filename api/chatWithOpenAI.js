// /api/chatWithOpenAI.js

// Ensure you're using Node.js 18+ for built-in fetch and WebSocket support

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

      let aiReply = '';

      if (audioData) {
        // Decode Base64 audioData
        const audioBuffer = Buffer.from(audioData, 'base64');

        // Establish WebSocket connection to OpenAI Realtime API
        const openaiWsUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';

        // Use built-in WebSocket module in Node.js 18+
        const ws = new WebSocket(openaiWsUrl, {
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'OpenAI-Beta': 'realtime=v1',
          },
        });

        ws.on('open', () => {
          console.log('Connected to OpenAI Realtime API');

          // Update session with system instructions
          ws.send(JSON.stringify({
            type: 'session.update',
            session: { instructions: systemMessageContent },
          }));

          // Append audio data to input buffer
          ws.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            data: audioData,
          }));

          // Request a response
          ws.send(JSON.stringify({
            type: 'response.create',
            response: { modalities: ['text'] },
          }));
        });

        ws.on('message', async (data) => {
          const event = JSON.parse(data);

          console.log('Received event:', event);

          // Check if the response is complete
          if (event.type === 'response.done') {
            // Close the WebSocket connection
            ws.close();
          }

          // Collect the AI's reply
          if (event.type === 'response.text') {
            aiReply += event.text.delta || '';
          }

          // When the text is done, send the response
          if (event.type === 'response.text.done') {
            // Update Airtable with conversation
            const updatedConversation = `${conversationContext}\nUser: [Voice Message]\nAI: ${aiReply}`;
            await updateAirtableConversation(sessionId, eagleViewChatUrl, headersAirtable, updatedConversation, existingRecordId);

            // Send the AI's reply back to the client
            res.json({ reply: aiReply });

            // Close the WebSocket connection
            ws.close();
          }
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          res.status(500).json({ error: 'Failed to communicate with OpenAI Realtime API' });
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
      return res.status(500).json({ error: 'Internal server error', details: error.message });
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
