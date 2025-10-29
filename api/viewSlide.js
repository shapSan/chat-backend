export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const { token } = req.query;
  
  if (!token) {
    return res.status(400).send('No token provided');
  }
  
  try {
    // --- CHANGE 1: Add cache-buster query parameter ---
    // This forces our server to get the *latest* file from the blob
    const cacheBuster = `v=${new Date().getTime()}`;
    const url = `https://w24qls9w8lqauhdf.public.blob.vercel-storage.com/slides/${token}/index.html?${cacheBuster}`;
    
    // We also tell our fetch to bypass any intermediate caches
    const response = await fetch(url, { cache: 'no-store' });
    
    if (!response.ok) {
      return res.status(404).send('Presentation not found');
    }
    
    const html = await response.text();
    
    // Serve HTML with proper headers
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    
    // --- CHANGE 2: Update Cache-Control header ---
    // This tells the browser/CDN not to cache this API route's response
    res.setHeader(
      'Cache-Control',
      'no-cache, no-store, must-revalidate'
    );
    res.status(200).send(html);
  } catch (error) {
    console.error('Error serving slide:', error);
    res.status(500).send('Error loading presentation');
  }
}
