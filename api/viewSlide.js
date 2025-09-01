import { get } from '@vercel/blob';

export default async function handler(req, res) {
  const { token } = req.query;
  
  if (!token) {
    return res.status(400).send('No token provided');
  }
  
  try {
    const url = `https://w24qls9w8lqauhdf.public.blob.vercel-storage.com/slides/${token}/index.html`;
    const response = await fetch(url);
    
    if (!response.ok) {
      return res.status(404).send('Presentation not found');
    }
    
    const html = await response.text();
    
    // Serve HTML with proper headers
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(html);
  } catch (error) {
    console.error('Error serving slide:', error);
    res.status(500).send('Error loading presentation');
  }
}
