export default async function handler(req, res) {
  // Dead simple CORS that always works
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { slides, title, sessionId } = req.body;

    // For now, just return a mock response to test if the endpoint works
    const mockToken = Date.now().toString(36);
    const mockUrl = `https://chat-backend-sigma-five.vercel.app/s/${mockToken}`;
    
    return res.status(200).json({
      success: true,
      url: mockUrl,
      token: mockToken,
      message: 'Mock publish successful - endpoint is working!'
    });
    
  } catch (error) {
    console.error('Error in publishSlide:', error);
    return res.status(500).json({ 
      error: 'Failed to publish slides', 
      details: error.message 
    });
  }
}
