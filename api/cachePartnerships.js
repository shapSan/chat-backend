// api/cachePartnerships.js
import { kv } from '@vercel/kv';
import hubspotAPI from '../client/hubspot-client.js';
import { logStage, HB_KEYS } from '../lib/hbDebug.js';

export const maxDuration = 300;

// Active pipeline stages for partnerships
const ACTIVE_STAGES = [
  "1111899943",  // From your filter
  "174586264",   // From your filter
  "174531875",   // From your filter
  "239211589",   // From your filter
  "174586263"    // From your filter
];

export default async function handler(req, res) {
  // Enable CORS for all requests - MUST BE FIRST
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Handle GET requests - return current cache status
    if (req.method === 'GET') {
      try {
        const status = await kv.get('partnership-cache-status');
        
        if (!status) {
          return res.status(200).json({
            status: 'idle',
            message: 'No cache rebuild in progress.'
          });
        }
        
        return res.status(200).json(status);
      } catch (error) {
        console.error('[CACHE] Error reading status:', error);
        return res.status(500).json({
          status: 'error',
          error: 'Failed to read cache status',
          message: error.message
        });
      }
    }
    
    // Handle POST requests - trigger cache rebuild
    if (req.method === 'POST') {
      // Only require auth for POST method (rebuild cache)
      if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
        // Allow POST without auth for frontend rebuild button
        console.log('[CACHE] Frontend-initiated cache refresh (no auth)');
      }

      // Set initial 'starting' status before responding
      try {
        await kv.set('partnership-cache-status', {
          status: 'starting',
          message: 'Cache rebuild initiated...',
          startTime: Date.now()
        });
      } catch (err) {
        console.error('[CACHE] Failed to set starting status:', err);
      }

      // IMMEDIATELY return success - don't wait for the cache to build
      res.status(200).json({ 
        status: 'ok',
        message: 'Cache rebuild started. Poll GET /api/cachePartnerships for status updates.'
      });

      // Now rebuild the cache in the background
      // Vercel will keep this running for up to 5 minutes
      rebuildCacheBackground().catch(err => {
        console.error('[CACHE] Background rebuild failed:', err);
      });
      
      return;
    }
    
    // Method not allowed
    return res.status(405).json({ error: 'Method not allowed. Use GET for status or POST to rebuild cache.' });
  } catch (error) {
    console.error('[CACHE] Unhandled error in handler:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

async function rebuildCacheBackground() {

  console.log('[CACHE] Starting partnership cache refresh...');
  
  // Capture the original start time
  const startTime = Date.now();
  
  // Update status to 'running'
  try {
    await kv.set('partnership-cache-status', {
      status: 'running',
      startTime,
      message: 'Fetching data from HubSpot...'
    });
  } catch (err) {
    console.error('[CACHE] Failed to set running status:', err);
  }
  
  try {
    // Use the defined pipeline stages for active partnerships
    const filterGroups = [
      {
        // Filter by active pipeline stages only
        filters: [
          {
            propertyName: 'hs_pipeline_stage',
            operator: 'IN',
            values: ACTIVE_STAGES  // Use the defined stage IDs
          }
        ]
      }
    ];
    
    console.log('[CACHE] Fetching partnerships in active stages:', ACTIVE_STAGES);
    console.log('[CACHE] Filter groups:', JSON.stringify(filterGroups, null, 2));
    
    // Support pagination to get all matching partnerships
    let allPartnerships = [];
    let after = undefined;
    let pageCount = 0;
    const maxPages = 10; // Support up to 1000 partnerships
    
    const partnershipProperties = [
      'partnership_name',          // Essential - display name
      // 'hs_pipeline_stage',         // Essential - for filtering by active stages
      // 'start_date',                // Essential - for filtering + display
      // 'release__est__date',        // Essential - display
      'hs_lastmodifieddate',       // Essential - for sorting
      // 'main_cast',                 // Essential - display
      // 'genre_production',          // Essential - display/filtering
      // 'production_type',           // Essential - display/filtering
      // 'distributor',               // Useful - display
      // 'shoot_location__city_',     // Keep - location display
      // 'storyline_location__city_', // Keep - location fallback
      // 'audience_segment',          // Keep - targeting/matching
      // 'synopsis',                  // Keep - for context (can be large but needed)
      // REMOVED: production_stage, content_type, movie_rating, tv_ratings, 
      // sub_ratings_for_tv_content, rating, partnership_status, brand_name,
      // amount, hollywood_branded_fee, closedate, contract_sent_date,
      // num_associated_contacts, est__shooting_end_date, production_end_date,
      // time_period, plot_location, partnership_setting, production_start_date,
      // release_est_date (keeping only primary date fields)
    ];
    
    do {
      try {
        const searchParams = {
          limit: 50,  // Reduced from 100 to prevent timeouts
          filterGroups,
          properties: partnershipProperties,
          // Add explicit sorting for stable pagination
          sorts: [{
            propertyName: 'hs_lastmodifieddate',
            direction: 'DESCENDING'
          }]
        };
        
        if (after) {
          searchParams.after = after;
        }
        
        console.log(`[CACHE] Fetching partnerships page ${pageCount + 1}...`);
        console.log('[CACHE] FULL REQUEST DETAILS:');
        console.log('  URL:', `https://api.hubapi.com/crm/v3/objects/2-27025032/search`);
        console.log('  Body:', JSON.stringify(searchParams, null, 2));
        const result = await hubspotAPI.searchProductions(searchParams);
        
        console.log(`[CACHE] Got result, checking data...`);
        console.log(`[CACHE] result.results exists:`, !!result.results);
        console.log(`[CACHE] result.results.length:`, result.results?.length || 0);
        console.log(`[CACHE] result.paging:`, JSON.stringify(result.paging));
        
        if (result.results && result.results.length > 0) {
          allPartnerships = [...allPartnerships, ...result.results];
          console.log(`[CACHE] Fetched ${result.results.length} partnerships (total: ${allPartnerships.length})`);
        }
        
        // Update progress status every 2 pages
        if (pageCount % 2 === 0) {
          try {
            await kv.set('partnership-cache-status', {
              status: 'running',
              progress: `Fetched ${allPartnerships.length} partnerships...`,
              page: pageCount,
              startTime // Keep original start time
            });
          } catch (err) {
            console.error('[CACHE] Failed to update progress:', err);
          }
        }
        
        after = result.paging?.next?.after;
        if (after) {
          console.log(`[CACHE] ✅ Has next page, after token: ${after}`);
        } else {
          console.log(`[CACHE] ⚠️ No next page - stopping pagination`);
        }
        pageCount++;
        
      } catch (pageError) {
        console.error(`[CACHE] Error fetching partnerships page ${pageCount + 1}:`, pageError);
        console.error(`[CACHE] Error stack:`, pageError.stack);
        
        // Update status with partial failure info
        try {
          await kv.set('partnership-cache-status', {
            status: 'failed',
            error: `Error fetching page ${pageCount + 1}: ${pageError.message}`,
            partial: true,
            count: allPartnerships.length,
            endTime: Date.now()
          });
        } catch (err) {
          console.error('[CACHE] Failed to update error status:', err);
        }
        
        // Check if this is a rate limit error - if so, don't break immediately
        if (pageError.message?.includes('429') || pageError.message?.toLowerCase().includes('rate limit')) {
          console.log('[CACHE] Rate limit detected, will retry after backoff...');
          // The hubspot-client RateLimiter should handle the retry
          // Continue to next iteration rather than breaking
          continue;
        }
        
        break;
      }
    } while (after && pageCount < maxPages);

    const partnerships = allPartnerships;
    console.log(`[CACHE] =========================================`);
    console.log(`[CACHE] PAGINATION SUMMARY:`);
    console.log(`[CACHE]   Total fetched: ${partnerships.length}`);
    console.log(`[CACHE]   Pages fetched: ${pageCount}`);
    console.log(`[CACHE]   Max pages: ${maxPages}`);
    console.log(`[CACHE]   Stopped because: ${after ? 'reached max pages limit' : 'no more pages from HubSpot'}`);
    console.log(`[CACHE] =========================================`);
    
    if (partnerships.length === 0) {
      console.log('[CACHE] No partnerships found, updating status...');
      // Update status to indicate no data found
      try {
        await kv.set('partnership-cache-status', {
          status: 'completed',
          count: 0,
          endTime: Date.now(),
          message: 'No active partnerships found matching filters.'
        });
      } catch (err) {
        console.error('[CACHE] Failed to set no-data status:', err);
      }
      return;
    }

    console.log('[CACHE] Starting brand fetching for matching...');

    // SKIP BRAND FETCHING - not needed for now
    const allBrands = [];
    console.log('[CACHE] ⚠️ Skipping brand fetching to speed up cache build');
    
    console.log(`[CACHE] ✅ Fetched ${partnerships.length} partnerships and ${allBrands.length} brands`);
    console.log('[CACHE] Skipping matching, just formatting partnerships...');

    // SIMPLIFIED: Skip brand matching entirely, just format partnerships
    const matchedPartnerships = partnerships.map(partnership => {
      const props = partnership.properties;
      
      // Just return the partnership with empty matchedBrands
      const finalObject = {
        ...props,
        id: partnership.id,
        name: props.partnership_name || 'Untitled Project',
        matchedBrands: [], // Empty for now
        main_cast: props.main_cast || null,
        cast: props.main_cast || null,
        shoot_location__city_: props.shoot_location__city_ || null,
        storyline_location__city_: props.storyline_location__city_ || null,
        location: props.shoot_location__city_ || props.storyline_location__city_ || null,
        audience_segment: props.audience_segment || null,
        distributor: props.distributor || null,
        synopsis: props.synopsis || null,
        genre_production: props.genre_production || null,
        vibe: props.genre_production || null,
        productionStartDate: props.start_date || null,
        releaseDate: props.release__est__date || null,
        productionType: props.production_type || null,
      };
      
      return finalObject;
    });
    
    console.log('[CACHE] ✅ Formatted ${matchedPartnerships.length} partnerships');

    // Cache ALL the results - no limit needed since we're not returning in response
    console.log(`[CACHE] Caching all ${matchedPartnerships.length} partnerships to KV...`);

    // Cache the results
    await kv.set('hubspot-partnership-matches', matchedPartnerships);
    
    // Also cache timestamp
    await kv.set('hubspot-partnership-matches-timestamp', Date.now());

    console.log('[CACHE] ✅ Cache rebuild complete!', matchedPartnerships.length, 'partnerships cached');
    
    // Update status to completed
    try {
      await kv.set('partnership-cache-status', {
        status: 'completed',
        count: matchedPartnerships.length,
        endTime: Date.now(),
        message: `${matchedPartnerships.length} partnerships cached.`
      });
    } catch (err) {
      console.error('[CACHE] Failed to set completion status:', err);
    }
    
  } catch (error) {
    console.error('[CACHE] Fatal error during partnership cache refresh:', error);
    
    // Update status with fatal error info
    try {
      await kv.set('partnership-cache-status', {
        status: 'failed',
        error: error.message,
        details: error.stack || '',
        endTime: Date.now()
      });
    } catch (err) {
      console.error('[CACHE] Failed to set error status:', err);
    }
  }
}
