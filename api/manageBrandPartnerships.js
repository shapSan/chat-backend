// api/manageBrandPartnerships.js
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    const { brandId } = req.query;
    
    if (!brandId) {
      return res.status(400).json({ 
        error: 'brandId is required',
        success: false 
      });
    }
    
    const kvKey = `brand-associations:${brandId}`;
    
    // GET: Retrieve associated partnership IDs for a brand
    if (req.method === 'GET') {
      const associatedIds = await kv.get(kvKey) || [];
      
      return res.status(200).json({ 
        success: true,
        brandId,
        partnershipIds: associatedIds,
        count: associatedIds.length
      });
    }
    
    // POST: Update associated partnership IDs for a brand
    if (req.method === 'POST') {
      const { partnershipIds } = req.body;
      
      if (!Array.isArray(partnershipIds)) {
        return res.status(400).json({ 
          error: 'partnershipIds must be an array',
          success: false 
        });
      }
      
      // Store the array of partnership IDs
      await kv.set(kvKey, partnershipIds);
      
      return res.status(200).json({ 
        success: true,
        brandId,
        partnershipIds,
        count: partnershipIds.length,
        message: 'Brand partnerships updated successfully'
      });
    }
    
    // Method not allowed
    return res.status(405).json({ 
      error: `Method ${req.method} not allowed`,
      success: false 
    });
    
  } catch (error) {
    console.error('[MANAGE_BRAND_PARTNERSHIPS] Error:', error);
    res.status(500).json({ 
      error: 'Failed to manage brand partnerships', 
      details: error.message,
      success: false
    });
  }
}
