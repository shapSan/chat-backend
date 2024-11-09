// /api/chatWithOpenAI.js
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import WebSocket from 'ws';

dotenv.config();

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    },
  },
};

const airtableApiKey = process.env.AIRTABLE_API_KEY;
const openAIApiKey = process.env.OPENAI_API_KEY;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userMessage, sessionId, audioData } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }

    // Get conversation context from Airtable
    const airtableBaseId = 'appTYnw2qIaBIGRbR';
    const eagleViewChatUrl = `https://api.airtable.com/v0/${airtableBaseId}/EagleView_Chat`;
    const headersAirtable = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${airtableApiKey}`
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

    if (audioData) {
      // Handle audio message
      const openaiResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIApiKey}`,
        },
        body: JSON.stringify({
          file: audioData,
          model: "whisper-1",
        })
      });

      if (!openaiResponse.ok) {
        throw new Error('Failed to transcribe audio');
      }

      const transcription = await openaiResponse.json();
      
      // Get completion for transcribed text
      const completionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openAIApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: `Previous conversation: ${conversationContext}` },
            { role: 'user', content: transcription.text }
          ],
        }),
      });

      if (!completionResponse.ok) {
        throw new Error('Failed to get completion');
      }

      const completion = await completionResponse.json();
      const aiReply = completion.choices[0].message.content;

      // Update conversation in Airtable
      const updatedConversation = `${conversationContext}\nUser: [Voice Message] ${transcription.text}\nAI: ${aiReply}`;
      
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

      return res.json({ reply: aiReply });

    } else if (userMessage) {
      // Handle text message
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openAIApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: `Previous conversation: ${conversationContext}` },
            { role: 'user', content: userMessage }
          ],
        }),
      });

      if (!openaiResponse.ok) {
        throw new Error('Failed to get completion');
      }

      const completion = await openaiResponse.json();
      const aiReply = completion.choices[0].message.content;

      // Update conversation in Airtable
      const updatedConversation = `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`;
      
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

      return res.json({ reply: aiReply });
    }

    return res.status(400).json({ error: 'Missing message content' });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
