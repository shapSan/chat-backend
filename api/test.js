export default async function handler(req, res) {
  // Super simple CORS - allow everything
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  return res.status(200).json({ 
    message: 'Test endpoint working!',
    method: req.method,
    timestamp: new Date().toISOString()
  });
}
