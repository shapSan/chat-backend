import { kv } from '@vercel/kv';

// Set max duration
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
    const { token, brandId } = req.query;
    
    // Mode 1: Get token by brandId (for Brand Radar)
    if (brandId && !token) {
      const radarToken = await kv.get(`brand-radar-token:${brandId}`);
      
      if (!radarToken) {
        return res.status(200).json({ 
          success: true,
          hasRadar: false,
          token: null 
        });
      }
      
      return res.status(200).json({
        success: true,
        hasRadar: true,
        token: radarToken
      });
    }
    
    // Mode 2: Get slides by token (existing functionality)
    if (!token) {
      return res.status(400).json({ error: 'Token or brandId required' });
    }
    
    // Fetch from KV
    const doc = await kv.get(`slide:${token}`);
    
    console.log('[getSlideByToken] Retrieved from KV:', {
      token,
      'doc exists': !!doc,
      'has slides': !!doc?.slides,
      'has brandData': !!doc?.brandData,
      'has partnershipData': !!doc?.partnershipData,
    });
    
    if (!doc) {
      return res.status(404).json({ error: 'Slide not found' });
    }
    
    // Return structured data (ready for editor)
    // NO password check - the token itself is the auth
    return res.status(200).json({
      success: true,
      slides: doc.slides,
      templateId: doc.templateId,
      brandName: doc.brandName,
      projectName: doc.projectName,
      brandData: doc.brandData,
      partnershipData: doc.partnershipData,
      token: doc.token
    });
    
  } catch (error) {
    console.error('[getSlideByToken] Error:', error);
    return res.status(500).json({ error: 'Failed to load slide' });
  }
}
