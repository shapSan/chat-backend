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
      const { userMessage } = req.body;

      console.log('Received request');
      console.log('User Message:', userMessage);

      if (!userMessage) {
        console.error('Missing userMessage');
        return res.status(400).json({ error: 'Missing userMessage' });
      }

      // Simplified OpenAI Request
      console.log('Processing simple text message with OpenAI...');

      try {
        const openAIResponse = await fetch('https://api.openai.com/v1/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openAIApiKey}`,
          },
          body: JSON.stringify({
            model: 'text-davinci-003',
            prompt: `User: ${userMessage}\nAI:`,
            max_tokens: 50,
            temperature: 0.7,
          }),
        });

        console.log('OpenAI API response status:', openAIResponse.status);

        if (!openAIResponse.ok) {
          const openAIErrorDetails = await openAIResponse.text();
          console.error('OpenAI API error:', openAIResponse.statusText, openAIErrorDetails);
          return res.status(500).json({ error: 'Failed to get response from OpenAI', details: openAIErrorDetails });
        }

        const openAIData = await openAIResponse.json();
        console.log('OpenAI response data:', JSON.stringify(openAIData));

        const assistantReply = openAIData.choices?.[0]?.text?.trim();

        if (!assistantReply) {
          console.error('No valid reply from OpenAI');
          return res.status(500).json({ error: 'No valid reply from assistant' });
        }

        // Send the assistant's reply back to the client
        return res.status(200).json({ reply: assistantReply });

      } catch (error) {
        console.error('Error processing text message with OpenAI:', error);
        return res.status(500).json({ error: 'Failed to process text message', details: error.message });
      }

    } catch (error) {
      console.error('Unexpected server error:', error);
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
