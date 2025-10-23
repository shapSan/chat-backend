//api/getBrands.js

import { kv } from '@vercel/kv';
import { logStage, HB_KEYS } from '../lib/hbDebug.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Try multiple possible KV key names to be tolerant
    const candidates = [
      'hubspot-brand-cache',
      'brands-cache',
      'brand-cache',
      'hubspot-brands',
      'brands',
    ];
    let cached = [];
    let ts = null;

    for (const key of candidates) {
      const val = await kv.get(key);
      if (Array.isArray(val) && val.length) {
        cached = val;
        ts = await kv.get(`${key}-timestamp`);
        break;
      }
    }

    // Transform the raw HubSpot data to match what the panel expects
    const transformedBrands = cached.map(brand => ({
      id: brand.id || brand,
      name: brand.properties?.brand_name || brand.name || 'Unknown',
      category: brand.properties?.new_product_main_category || brand.properties?.main_category || brand.category || 'N/A',
      tier: brand.properties?.client_status || brand.tier || 'Unknown',
      relationshipType: brand.properties?.relationship_type || '',
      score: brand.properties?.partnership_count || brand.score || 0,
      website: brand.properties?.website || brand.website || '',
      hasOwner: !!brand.properties?.hubspot_owner_id,
      // Include raw properties for debugging
      _raw: brand.properties
    }));
    
    logStage(HB_KEYS.GET_BRANDS_TRANSFORM, {
      count: transformedBrands.length,
      cacheAge: ts ? Math.round((Date.now() - Number(ts)) / 60000) : null
    });

    res.status(200).json({
      brands: transformedBrands,
      cacheAge: ts ? Math.round((Date.now() - Number(ts)) / 60000) : null,
      timestamp: ts || null,
    });
  } catch (err) {
    console.error('[GET_BRANDS] Error:', err);
    res.status(500).json({ 
      error: 'Failed to fetch brands', 
      details: String(err?.message || err) 
    });
  }
}
