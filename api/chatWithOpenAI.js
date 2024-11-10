import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const airtableApiKey = process.env.AIRTABLE_API_KEY;

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
      const { sessionId, userMessage } = req.body;

      console.log('Received request');
      console.log('Session ID:', sessionId);
      console.log('User Message:', userMessage);

      if (!sessionId || !userMessage) {
        return res.status(400).json({ error: 'Missing sessionId or userMessage' });
      }

      // Reintroduce Airtable call
      const airtableBaseId = 'appTYnw2qIaBIGRbR';
      const eagleViewChatUrl = `https://api.airtable.com/v0/${airtableBaseId}/EagleView_Chat`;
      const headersAirtable = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${airtableApiKey}`,
      };

      let conversationContext = '';
      let existingRecordId = null;

      try {
        // Fetching the existing record from Airtable
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
          return res.status(500).json({ error: 'Failed to fetch conversation context from Airtable' });
        }
      } catch (error) {
        console.error('Error fetching conversation history from Airtable:', error);
        return res.status(500).json({ error: 'Airtable request failed' });
      }

      // Update or create a new record in Airtable
      try {
        const updatedConversation = `${conversationContext}\nUser: ${userMessage}`;

        if (existingRecordId) {
          console.log('Updating existing Airtable record...');
          const updateResponse = await fetch(`${eagleViewChatUrl}/${existingRecordId}`, {
            method: 'PATCH',
            headers: headersAirtable,
            body: JSON.stringify({
              fields: { Conversation: updatedConversation },
            }),
          });

          console.log('Airtable update response status:', updateResponse.status);
          if (!updateResponse.ok) {
            console.error('Failed to update Airtable record:', updateResponse.statusText);
            return res.status(500).json({ error: 'Failed to update Airtable record' });
          }
        } else {
          console.log('Creating new Airtable record...');
          const createResponse = await fetch(eagleViewChatUrl, {
            method: 'POST',
            headers: headersAirtable,
            body: JSON.stringify({
              fields: {
                SessionID: sessionId,
                Conversation: updatedConversation,
              },
            }),
          });

          console.log('Airtable create response status:', createResponse.status);
          if (!createResponse.ok) {
            console.error('Failed to create Airtable record:', createResponse.statusText);
            return res.status(500).json({ error: 'Failed to create Airtable record' });
          }
        }
      } catch (airtableError) {
        console.error('Error updating Airtable:', airtableError);
        return res.status(500).json({ error: 'Failed to update Airtable' });
      }

      // Send a response back to confirm Airtable write success
      return res.status(200).json({ reply: 'Airtable record created or updated successfully.' });

    } catch (error) {
      console.error('Unexpected server error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
