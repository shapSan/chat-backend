require('dotenv').config();
const fetch = require('node-fetch');
const WebSocket = require('ws');

// Airtable setup
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = 'appTYnw2qIaBIGRbR';
const AIRTABLE_CHAT_TABLE_NAME = 'EagleView_Chat';
const AIRTABLE_KB_TABLE_NAME = 'KnowledgeBase';
const AIRTABLE_CHAT_API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CHAT_TABLE_NAME}`;
const AIRTABLE_KB_API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_KB_TABLE_NAME}`;

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
  // Handle CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { userMessage, sessionId, audioData } = JSON.parse(body);

        if (!sessionId) {
          console.error('Missing sessionId');
          return res.status(400).json({ error: 'Missing sessionId' });
        }

        let systemMessageContent = `You are a friendly, professional, and cheeky assistant specializing in AI & Automation.`;
        let conversationContext = '';
        let existingRecordId = null;
        let knowledgeBaseContent = '';

        // Fetch conversation history from Airtable
        try {
          console.log('Fetching existing conversation from Airtable...');
          const searchUrl = `${AIRTABLE_CHAT_API_URL}?filterByFormula=SessionID="${sessionId}"`;
          const historyResponse = await fetch(searchUrl, {
            headers: {
              Authorization: `Bearer ${AIRTABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
          });

          if (historyResponse.ok) {
            const result = await historyResponse.json();
            if (result.records.length > 0) {
              conversationContext = result.records[0].fields.Conversation || '';
              existingRecordId = result.records[0].id;
            } else {
              console.log('No existing conversation found for this session.');
            }
          } else {
            console.error('Error fetching conversation history:', historyResponse.statusText);
          }
        } catch (error) {
          console.error('Error fetching conversation history from Airtable:', error);
        }

        // Fetch knowledge base content from Airtable
        try {
          console.log('Fetching knowledge base from Airtable...');
          const kbResponse = await fetch(AIRTABLE_KB_API_URL, {
            headers: {
              Authorization: `Bearer ${AIRTABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
          });

          if (kbResponse.ok) {
            const kbResult = await kbResponse.json();
            if (kbResult.records.length > 0) {
              knowledgeBaseContent = kbResult.records
                .map(record => record.fields.Summary)
                .filter(summary => summary) // Ensure there's content in the summary field
                .join('\n');
              console.log('Knowledge base content fetched successfully.');
            } else {
              console.log('No knowledge base records found.');
            }
          } else {
            console.error('Error fetching knowledge base:', kbResponse.statusText);
          }
        } catch (error) {
          console.error('Error fetching knowledge base from Airtable:', error);
        }

        // Add current time and knowledge base to context
        const currentTimePDT = getCurrentTimeInPDT();
        systemMessageContent += ` The current time in PDT is ${currentTimePDT}.`;

        if (knowledgeBaseContent) {
          systemMessageContent += ` Here is some additional knowledge that might be helpful:\n${knowledgeBaseContent}`;
        } else {
          console.warn('No knowledge base content added to the system message.');
        }

        if (userMessage) {
          // Handle text message using OpenAI Chat Completion API
          try {
            console.log('Sending request to OpenAI...');
            const openaiResponse = await fetch(
              'https://api.openai.com/v1/chat/completions',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                  model: 'gpt-4',
                  messages: [
                    { role: 'system', content: systemMessageContent },
                    { role: 'user', content: userMessage },
                  ],
                  max_tokens: 500,
                  temperature: 0.7,
                }),
              }
            );

            console.log('OpenAI API response status:', openaiResponse.status);

            if (!openaiResponse.ok) {
              const errorText = await openaiResponse.text();
              console.error('OpenAI API response error:', errorText);
              throw new Error(`OpenAI API error: ${errorText}`);
            }

            const openaiData = await openaiResponse.json();
            const aiReply = openaiData.choices[0].message.content.trim();

            console.log('OpenAI reply:', aiReply);

            // Update conversation in Airtable
            const updatedConversation = `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`;

            try {
              console.log('Updating Airtable with conversation...');
              const airtablePayload = {
                fields: {
                  SessionID: sessionId,
                  Conversation: updatedConversation,
                },
              };

              const airtableResponse = existingRecordId
                ? await fetch(`${AIRTABLE_CHAT_API_URL}/${existingRecordId}`, {
                    method: 'PATCH',
                    headers: {
                      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(airtablePayload),
                  })
                : await fetch(AIRTABLE_CHAT_API_URL, {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(airtablePayload),
                  });

              if (!airtableResponse.ok) {
                console.error('Error updating Airtable:', airtableResponse.statusText);
              } else {
                console.log('Airtable record created or updated successfully.');
              }
            } catch (error) {
              console.error('Error updating Airtable:', error);
            }

            return res.status(200).json({ reply: aiReply });
          } catch (error) {
            console.error('Error in OpenAI communication:', error);
            return res.status(500).json({
              error: 'Failed to communicate with OpenAI',
              details: error.message,
            });
          }
        } else {
          console.error('No message or audio data provided');
          res.status(400).json({ error: 'No message or audio data provided' });
        }
      } catch (error) {
        console.error('Error in handler:', error);
        return res.status(500).json({
          error: 'Internal server error',
          details: error.message,
        });
      }
    });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
