import { kv } from '@vercel/kv';

export const maxDuration = 10;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { brandId } = req.query;
    
    if (!brandId) {
      return res.status(400).json({ error: 'brandId required' });
    }
    
    // Get token for this brand
    const token = await kv.get(`brand-radar-token:${brandId}`);
    
    if (!token) {
      return res.status(404).json({ 
        success: false,
        error: 'No Brand Radar found for this brand' 
      });
    }
    
    // Get the slide data
    const slideData = await kv.get(`slide:${token}`);
    
    if (!slideData) {
      return res.status(404).json({ 
        success: false,
        error: 'Brand Radar data not found' 
      });
    }
    
    // Get partnerships for this brand
    const partnershipIds = await kv.get(`brand-associations:${brandId}`) || [];
    
    // Return only the images and partnerships - text comes from HubSpot
    return res.status(200).json({
      success: true,
      token,
      brandId,
      templateId: slideData.templateId,
      // Return full slide data including images
      slides: slideData.slides?.map(s => ({
        ...s, // Keep all slide data including id, type, content
        // Ensure image fields are present
        image: s.image,
        imageFit: s.imageFit,
        mediaType: s.mediaType,
        mediaName: s.mediaName
      })),
      partnershipIds,
      url: `https://www.hollywoodbranded.com/agentpitch/published?token=${token}`,
      updatedAt: slideData.updatedAt
    });
    
  } catch (error) {
    console.error('[getBrandRadar] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to load Brand Radar',
      details: error.message 
    });
  }
}
