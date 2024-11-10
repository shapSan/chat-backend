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

      // Make a dummy response to verify backend is functioning
      return res.status(200).json({ reply: 'This is a dummy response to verify the backend works.' });
    } catch (error) {
      console.error('Unexpected server error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
