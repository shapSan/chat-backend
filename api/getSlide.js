// API route to fetch published slide content
// This goes in /api/getSlide.js or similar

export default async function handler(req, res) {
  const { token } = req.query;
  
  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }
  
  try {
    // For direct blob access, you'd fetch from your blob storage
    // This is a simplified version - adjust based on your Vercel Blob setup
    const blobUrl = `${process.env.VERCEL_BLOB_URL || 'https://your-blob-url.vercel-storage.com'}/slides/${token}/index.html`;
    
    const response = await fetch(blobUrl);
    
    if (!response.ok) {
      return res.status(404).json({ error: 'Slide not found' });
    }
    
    const html = await response.text();
    
    // Return the HTML directly
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } catch (error) {
    console.error('Error fetching slide:', error);
    res.status(500).json({ error: 'Failed to fetch slide' });
  }
}
