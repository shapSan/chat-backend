// api/getPartnerships.js
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Get cached partnership matches
    const cachedMatches = await kv.get('hubspot-partnership-matches');
    const cacheTimestamp = await kv.get('hubspot-partnership-matches-timestamp');
    
    if (!cachedMatches) {
      return res.status(404).json({ 
        error: 'No cached partnerships found', 
        message: 'Please run the cache refresh first' 
      });
    }
    
    // Calculate cache age
    const cacheAge = cacheTimestamp ? Date.now() - cacheTimestamp : null;
    const cacheAgeMinutes = cacheAge ? Math.floor(cacheAge / 60000) : null;
    
    res.status(200).json({ 
      partnerships: cachedMatches,
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
