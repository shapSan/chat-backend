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
      
      // Transform for table display with new fields
      const tableData = cachedBrands.map(brand => ({
        id: brand.id,
        name: brand.properties?.brand_name || 'Unknown',
        category: brand.properties?.main_category || brand.properties?.new_product_main_category || 'N/A',
        subcategories: brand.properties?.product_sub_category__multi_ || '',
        status: brand.properties?.client_status || 'Unknown',
        relationshipType: brand.properties?.relationship_type || '',
        clientType: brand.properties?.client_type || '',
        partnershipCount: parseInt(brand.properties?.partnership_count || 0),
        dealsCount: parseInt(brand.properties?.deals_count || 0),
        hasOwner: !!brand.properties?.hubspot_owner_id,
        lastModified: brand.properties?.hs_lastmodifieddate || null,
        oneSheetLink: brand.properties?.one_sheet_link || null,
        hubspotUrl: `https://app.hubspot.com/contacts/${process.env.HUBSPOT_PORTAL_ID}/company/${brand.id}`
      }));
      
      // Alert if cache exceeds 500 brands
      if (tableData.length > 500) {
        console.warn(`[CACHE WARNING] Brand cache exceeds 500 limit: ${tableData.length} brands`);
      }
      
      return res.status(200).json({
        success: true,
        totalBrands: tableData.length,
        lastUpdated: cacheTimestamp || null,
        brands: tableData,
        warning: tableData.length > 500 ? `Cache exceeds 500 limit: ${tableData.length} brands` : null
      });
    } catch (error) {
      console.error('[CACHE] Error fetching cached brands:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch cached brands',
        details: error.message 
      });
    }
  }
  
  // POST method - Full cache rebuild with new filter logic
  if (req.method === 'POST') {
    console.log('[CACHE] Starting full brand cache refresh with new filter logic...');
    
    try {
      // Fetch ALL brands matching the new filter criteria
      let allBrands = [];
      let after = undefined;
      let pageCount = 0;
      const maxPages = 20; // Support up to 2000 brands (expecting 300-500)
      
      do {
        try {
          // Add delay between requests to avoid rate limits
          if (pageCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 150));
          }
          
          const searchParams = {
            limit: 100,
            properties: [
              'brand_name',
              'brand_website_url', // ADDED for deep dive cards
              'main_category',
              'new_product_main_category',  // NEW filter field
              'relationship_type',           // NEW filter field
              'partner_agency_id',           // NEW field
              'product_sub_category__multi_',
              'client_status',
              'client_type',
              'partnership_count',
              'deals_count',
              'hubspot_owner_id',           // Required for filter
              'hs_lastmodifieddate',
              'one_sheet_link',
              'target_gen', // ADDED for deep dive cards
              'target_age_group__multi_' // ADDED for deep dive cards
            ],
            // Explicitly pass filterGroups to ensure correct filtering
            filterGroups: [
              {
                // Group 1: ALL conditions must be met (AND)
                filters: [
                  {
                    propertyName: 'client_status',
                    operator: 'IN',
                    values: ['Active', 'Pending (Prospect)', 'Pending']  // Include both Pending variations
                  },
                  {
                    propertyName: 'new_product_main_category',
                    operator: 'HAS_PROPERTY'
                  },
                  {
                    propertyName: 'hubspot_owner_id',
                    operator: 'HAS_PROPERTY'
                  }
                ]
              },
              {
                // Group 2: Partner Agency Client (OR with Group 1)
                filters: [
                  {
                    propertyName: 'relationship_type',
                    operator: 'EQ',
                    value: 'Partner Agency Client'
                  }
                ]
              }
            ],
            sorts: [{
              propertyName: 'hs_lastmodifieddate',
              direction: 'DESCENDING'
            }]
          };
          
          if (after) {
            searchParams.after = after;
          }
          
          console.log(`[CACHE] Fetching page ${pageCount + 1}...`);
          const result = await hubspotAPI.searchBrands(searchParams);
          
          if (result.results && result.results.length > 0) {
            // No need for additional validation since we're using proper API filters
            allBrands = [...allBrands, ...result.results];
            console.log(`[CACHE] Fetched ${result.results.length} brands (total: ${allBrands.length})`);
          }
          
          after = result.paging?.next?.after;
          pageCount++;
          
        } catch (pageError) {
          console.error(`[CACHE] Error fetching page ${pageCount + 1}:`, pageError);
          if (pageError.message?.includes('429') || pageError.message?.includes('rate')) {
            console.log('[CACHE] Rate limit hit, waiting 2 seconds...');
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            break;
          }
        }
      } while (after && pageCount < maxPages);
      
      console.log(`[CACHE] Fetched ${allBrands.length} total valid brands in ${pageCount} pages`);
      
      // Alert if exceeds expected threshold
      if (allBrands.length > 500) {
        console.warn(`[CACHE ALERT] Brand count exceeds 500: ${allBrands.length} brands found`);
      }
      
      // Update cache
      if (allBrands.length > 0) {
        await kv.set('hubspot-brand-cache', allBrands);
        await kv.set('hubspot-brand-cache-timestamp', Date.now());
        
        // Log cache update for audit trail
        console.log(`[CACHE AUDIT] Cache updated: ${allBrands.length} brands at ${new Date().toISOString()}`);
      }
      
      return res.status(200).json({ 
        status: 'ok', 
        mode: 'full_refresh', 
        pages: pageCount,
        total: allBrands.length,
        warning: allBrands.length > 500 ? `Exceeds 500 limit: ${allBrands.length} brands` : null
      });
      
    } catch (error) {
      console.error('[CACHE] Fatal error during cache refresh:', error);
      return res.status(500).json({ 
        error: 'Failed to refresh brand cache', 
        details: error.message 
      });
    }
  }
  
  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' });
}
