// api/cacheBrands.js
import { kv } from '@vercel/kv';
import hubspotAPI from '../client/hubspot-client.js';

export const maxDuration = 300;

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
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
    res.status(200).json({ status: 'ok', updated: updatedBrands.length, total: newCache.length });
  } catch (error) {
    console.error('[CACHE] Fatal error during cache refresh:', error);
    res.status(500).json({ error: 'Failed to refresh brand cache', details: error.message });
  }
}
