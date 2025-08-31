// Absolutely minimal endpoint with no imports at all
export default function handler(req, res) {
  // Set CORS headers - most permissive possible
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Handle GET for testing
  if (req.method === 'GET') {
    res.status(200).json({ 
      message: 'publishSlide endpoint is alive!',
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Handle POST for actual publishing
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      
      // Just return a mock success response
      res.status(200).json({
        success: true,
        url: `https://example.com/slides/${Date.now()}`,
        token: Math.random().toString(36).substring(7),
        received: {
          slideCount: body.slides ? body.slides.length : 0,
          title: body.title || 'Untitled'
        }
      });
    } catch (err) {
      res.status(500).json({ 
        error: 'Server error',
        message: err.message 
      });
    }
    return;
  }

  // Other methods not allowed
  res.status(405).json({ error: 'Method not allowed' });
}
