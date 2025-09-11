//api/getBrands.js

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Read cached brands + timestamp set by /api/cacheBrands
    const cachedBrands = (await kv.get('hubspot-brand-cache')) || [];
    const cacheTimestamp = await kv.get('hubspot-brand-cache-timestamp');

    let cacheAgeMinutes = null;
    if (cacheTimestamp) {
      cacheAgeMinutes = Math.round((Date.now() - Number(cacheTimestamp)) / 60000);
    }

    res.status(200).json({
      brands: cachedBrands,
      cacheAge: cacheAgeMinutes,
      timestamp: cacheTimestamp,
    });
  } catch (error) {
    console.error('[GET_BRANDS] Error:', error);
    res.status(500).json({
      error: 'Failed to fetch brands',
      details: error.message,
    });
  }
}
