require('dotenv').config();
const fetch = require('node-fetch');

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
        const { userMessage, sessionId } = JSON.parse(body);

        if (!sessionId || !userMessage) {
          console.error('Missing sessionId or userMessage');
          return res.status(400).json({ error: 'Missing sessionId or userMessage' });
        }

        let systemMessageContent = `You are a friendly, professional, and cheeky assistant specializing in AI & Automation.`;

        // Add the current time to the context (Optional)
        const currentTimePDT = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        systemMessageContent += ` The current time in PDT is ${currentTimePDT}.`;

        // OpenAI Chat Completion Request
        try {
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

          // Send the assistant's reply back to the client
          return res.status(200).json({ reply: aiReply });
        } catch (error) {
          console.error('Error in OpenAI communication:', error);
          return res.status(500).json({
            error: 'Failed to communicate with OpenAI',
            details: error.message,
          });
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
