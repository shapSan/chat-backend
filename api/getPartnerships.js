// api/getPartnerships.js
import { kv } from '@vercel/kv';
import { logStage, HB_KEYS } from '../lib/hbDebug.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Check if requesting a specific partnership detail
  const { id } = req.query;
  
  if (id) {
    // GET PARTNERSHIP DETAIL BY ID
    try {
      console.log(`[GET_PARTNERSHIPS] Fetching partnership detail for ID: ${id}`);
      
      const partnership = await kv.get(`partnership:${id}`);
      
      if (!partnership) {
        console.log(`[GET_PARTNERSHIPS] Partnership ${id} not found in cache`);
        return res.status(404).json({ error: 'Partnership not found' });
      }
      
      console.log(`[GET_PARTNERSHIPS] Successfully retrieved partnership: ${partnership.name}`);
      return res.status(200).json(partnership);
      
    } catch (error) {
      console.error('[GET_PARTNERSHIPS] Error fetching partnership detail:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch partnership detail',
        message: error.message 
      });
    }
  }
  
  // GET PARTNERSHIP LIST (default behavior)
  try {
    // Get cached partnership list (lightweight - just IDs and names)
    const partnershipList = await kv.get('partnership-list');
    const cacheTimestamp = await kv.get('partnership-list-timestamp');
    
    if (!partnershipList) {
      return res.status(404).json({ 
        error: 'No cached partnerships found', 
        message: 'Please run the cache refresh first' 
      });
    }
    
    // Calculate cache age
    const cacheAge = cacheTimestamp ? Date.now() - cacheTimestamp : null;
    const cacheAgeMinutes = cacheAge ? Math.floor(cacheAge / 60000) : null;
    
    console.log(`[GET_PARTNERSHIPS] Returning ${partnershipList.length} partnerships from list`);
    
    res.status(200).json({ 
      partnerships: partnershipList,
      cacheAge: cacheAgeMinutes,
      timestamp: cacheTimestamp
    });
    
  } catch (error) {
    console.error('[GET_PARTNERSHIPS] Error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch partnerships', 
      details: error.message 
    });
  }
}
