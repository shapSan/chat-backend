// api/cacheBrands.js
import { kv } from '@vercel/kv';
import hubspotAPI from '../client/hubspot-client.js';

export const maxDuration = 300;

export default async function handler(req, res) {
  // Enable CORS for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET method - return cached brands for table display
  if (req.method === 'GET') {
    try {
      const cachedBrands = await kv.get('hubspot-brand-cache');
      const cacheTimestamp = await kv.get('hubspot-brand-cache-timestamp');
      
      if (!cachedBrands || !Array.isArray(cachedBrands)) {
        return res.status(404).json({ 
          error: 'No cached brands found',
          message: 'Cache is empty - trigger a refresh first'
        });
      }
      
      // Transform for table display
      const tableData = cachedBrands.map(brand => ({
        id: brand.id,
        name: brand.properties?.brand_name || 'Unknown',
        category: brand.properties?.main_category || 'N/A',
        subcategories: brand.properties?.product_sub_category__multi_ || '',
        status: brand.properties?.client_status || 'Unknown',
        clientType: brand.properties?.client_type || '',
        partnershipCount: parseInt(brand.properties?.partnership_count || 0),
        dealsCount: parseInt(brand.properties?.deals_count || 0),
        lastModified: brand.properties?.hs_lastmodifieddate || null,
        oneSheetLink: brand.properties?.one_sheet_link || null,
        hubspotUrl: `https://app.hubspot.com/contacts/${process.env.HUBSPOT_PORTAL_ID}/company/${brand.id}`
      }));
      
      return res.status(200).json({
        success: true,
        totalBrands: tableData.length,
        lastUpdated: cacheTimestamp || null,
        brands: tableData
      });
    } catch (error) {
      console.error('[CACHE] Error fetching cached brands:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch cached brands',
        details: error.message 
      });
    }
  }
  
  // POST method - refresh cache (existing logic)
  if (req.method === 'POST') {
    // Allow POST without auth for frontend rebuild button
    if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
      console.log('[CACHE] Frontend-initiated cache refresh (no auth)');
    }

  console.log('[CACHE] Starting incremental brand cache refresh...');
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).getTime();
    const updatedBrandsResult = await hubspotAPI.searchBrands({
      limit: 100,
      filterGroups: [{
        filters: [{
          propertyName: 'hs_lastmodifieddate',
          operator: 'GTE',
          value: yesterday,
        }],
      }],
      properties: [
        'brand_name', 'main_category', 'product_sub_category__multi_', 
        'client_status', 'client_type', 'partnership_count', 'deals_count', 
        'hs_lastmodifieddate', 'one_sheet_link'
      ],
    });
    const updatedBrands = updatedBrandsResult.results || [];
    if (updatedBrands.length === 0) {
      return res.status(200).json({ status: 'ok', updated: 0, total: 'unchanged' });
    }
    const existingCache = await kv.get('hubspot-brand-cache') || [];
    const brandMap = new Map(existingCache.map(brand => [brand.id, brand]));
    updatedBrands.forEach(brand => brandMap.set(brand.id, brand));
    const newCache = Array.from(brandMap.values());
    await kv.set('hubspot-brand-cache', newCache);
    await kv.set('hubspot-brand-cache-timestamp', Date.now());  // Add timestamp
    res.status(200).json({ status: 'ok', updated: updatedBrands.length, total: newCache.length });
  } catch (error) {
    console.error('[CACHE] Fatal error during cache refresh:', error);
    res.status(500).json({ error: 'Failed to refresh brand cache', details: error.message });
  }
  } // Close POST method
  
  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' });
}
