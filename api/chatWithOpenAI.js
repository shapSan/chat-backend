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

      // Log incoming request data
      console.log('Received POST request:', { userMessage, sessionId, audioDataLength: audioData ? audioData.length : 0 });

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
      }
      if (!userMessage && !audioData) {
        return res.status(400).json({ error: 'Missing required fields', details: 'Either userMessage or audioData is required.' });
      }

      let systemMessageContent = "You are a helpful assistant specialized in AI & Automation.";
      let conversationContext = '';
      let existingRecordId = null;

      const airtableBaseId = 'appTYnw2qIaBIGRbR';
      const knowledgeBaseUrl = `https://api.airtable.com/v0/${airtableBaseId}/Chat-KnowledgeBase`;
      const eagleViewChatUrl = `https://api.airtable.com/v0/${airtableBaseId}/EagleView_Chat`;
      const headersAirtable = { 'Content-Type': 'application/json', Authorization: `Bearer ${airtableApiKey}` };

      // Fetch knowledge base
      try {
        const kbResponse = await fetch(knowledgeBaseUrl, { headers: headersAirtable });
        if (kbResponse.ok) {
          const knowledgeBaseData = await kbResponse.json();
          const knowledgeEntries = knowledgeBaseData.records.map(record => record.fields.Summary).join('\n\n');
          systemMessageContent += ` Available knowledge: "${knowledgeEntries}".`;
        }
      } catch (error) {
        console.error('Error fetching knowledge base:', error);
      }

      // Fetch conversation history
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

      const currentTimePDT = getCurrentTimeInPDT();
      systemMessageContent += ` Current time in PDT: ${currentTimePDT}.`;

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
              const aiReply = event.item.content.filter(content => content.type === 'text').map(content => content.text).join('');
              if (aiReply) {
                await updateAirtableConversation(sessionId, eagleViewChatUrl, headersAirtable, `${conversationContext}\nUser: [Voice Message]\nAI: ${aiReply}`, existingRecordId);
                res.json({ reply: aiReply });
              } else {
                console.error('No valid reply received from OpenAI WebSocket.');
                res.status(500).json({ error: 'No valid reply received from OpenAI.' });
              }
              openaiWs.close();
            }
          });

          openaiWs.on('error', (error) => {
            console.error('OpenAI WebSocket error:', error);
            res.status(500).json({ error: 'Failed to communicate with OpenAI' });
          });
          
        } catch (error) {
          console.error('Error processing audio data:', error);
          res.status(500).json({ error: 'Error processing audio data.', details: error.message });
        }
      } else if (userMessage) {
        try {
          console.log('Sending text message to OpenAI:', { userMessage, systemMessageContent });
          const aiReply = await getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent);
          console.log('Received AI response:', aiReply);
          if (aiReply) {
            await updateAirtableConversation(sessionId, eagleViewChatUrl, headersAirtable, `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`, existingRecordId);
            return res.json({ reply: aiReply });
          } else {
            console.error('No text reply received from OpenAI.');
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
  res.setHeader("Allow", ["POST", "OPTIONS"])
  return res.status(405).json({ error: 'Method Not Allowed' })
}
}

async function getTextResponseFromOpenAI(userMessage, sessionId, systemMessageContent) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
    const data = await response.json();
    console.log('OpenAI response:', data);
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content;
    } else {
      console.error('No valid choices in OpenAI response.');
      return null;
    }
  } catch (error) {
    console.error('Error in getTextResponseFromOpenAI:', error);
    throw error;
  }
}

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
