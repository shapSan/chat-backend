// api/cachePartnerships.js
import { kv } from '@vercel/kv';
import hubspotAPI from '../client/hubspot-client.js';
import { logStage, HB_KEYS } from '../lib/hbDebug.js';

export const maxDuration = 300;

// Active pipeline stages for partnerships
const ACTIVE_STAGES = [
  "174586264",  // Pre-Production
  "174586263",  // Development  
  "174531873",  // In Production
  "174531874",  // Post-Production
];

export default async function handler(req, res) {
  // Enable CORS for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
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
    // Original correct filter logic
    const filterGroups = [
      {
        // Group 1: (Stage AND have_contacts AND main_cast)
        filters: [
          {
            propertyName: 'hs_pipeline_stage',
            operator: 'IN',
            values: ["1111899943", "174586264", "174531875", "239211589", "174586263"]
          },
          {
            propertyName: 'have_contacts',
            operator: 'HAS_PROPERTY'
          },
          {
            propertyName: 'main_cast',
            operator: 'HAS_PROPERTY'
          }
        ]
      },
      {
        // Group 2: OR (Franchise Property IS Yes)
        filters: [
          {
            propertyName: 'franchise_property',
            operator: 'EQ',
            value: 'Yes'
          }
        ]
      }
    ];
    
    console.log('[CACHE] Fetching partnerships in active stages WITH start_date:', ACTIVE_STAGES);
    console.log('[CACHE] Filter groups:', JSON.stringify(filterGroups, null, 2));
    
    // Support pagination to get all matching partnerships
    // NEW STRATEGY: Save partnerships incrementally instead of collecting in memory
    const partnershipList = []; // Lightweight list of IDs and names only
    let after = undefined;
    let pageCount = 0;
    const maxPages = 20; // Support up to 1000 partnerships
    let totalSaved = 0;
    
    const partnershipProperties = [
      'partnership_name',          // Essential - display name
      // 'hs_pipeline_stage',         // Essential - for filtering by active stages
      // 'start_date',                // Essential - for filtering + display
      // 'release__est__date',        // Essential - display
      // 'hs_lastmodifieddate',       // Essential - for sorting
      // 'main_cast',                 // Essential - display
      // 'genre_production',          // Essential - display/filtering
      // 'production_type',           // Essential - display/filtering
      // 'distributor',               // Useful - display
      // 'shoot_location__city_',     // Keep - location display
      // 'storyline_location__city_', // Keep - location fallback
      // 'audience_segment',          // Keep - targeting/matching
      // 'synopsis',                  // Keep - for context (can be large but needed)
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
        const result = await hubspotAPI.searchProductions(searchParams);
        
        console.log(`[CACHE] Got result, checking data...`);
        console.log(`[CACHE] result.results exists:`, !!result.results);
        console.log(`[CACHE] result.results.length:`, result.results?.length || 0);
        console.log(`[CACHE] result.paging:`, JSON.stringify(result.paging));
        
        if (result.results && result.results.length > 0) {
          // IMMEDIATELY save each partnership to its own key
          for (const partnership of result.results) {
            const props = partnership.properties;
            
            // Build the full partnership object (minimal for now)
            const fullPartnership = {
              id: partnership.id,
              name: props.partnership_name || 'Untitled Project',
              partnership_name: props.partnership_name || 'Untitled Project',
            };
            
            // Save full data to individual key
            try {
              await kv.set(`partnership:${partnership.id}`, fullPartnership);
              totalSaved++;
              
              // Add to lightweight list (ID and name only)
              partnershipList.push({
                id: partnership.id,
                name: props.partnership_name || 'Untitled Project'
              });
            } catch (saveError) {
              console.error(`[CACHE] Failed to save partnership ${partnership.id}:`, saveError);
            }
          }
          
          console.log(`[CACHE] Saved ${result.results.length} partnerships (total: ${totalSaved})`);
        }
        
        // Update progress status every 2 pages
        if (pageCount % 2 === 0) {
          try {
            await kv.set('partnership-cache-status', {
              status: 'running',
              progress: `Saved ${totalSaved} partnerships...`,
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
            count: totalSaved,
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

    console.log(`[CACHE] =========================================`);
    console.log(`[CACHE] PAGINATION SUMMARY:`);
    console.log(`[CACHE]   Total saved: ${totalSaved}`);
    console.log(`[CACHE]   Pages fetched: ${pageCount}`);
    console.log(`[CACHE]   Max pages: ${maxPages}`);
    console.log(`[CACHE]   Stopped because: ${after ? 'reached max pages limit' : 'no more pages from HubSpot'}`);
    console.log(`[CACHE] =========================================`);
    
    if (totalSaved === 0) {
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

    console.log('[CACHE] Skipping brand fetching and matching...');
    
    // Save the lightweight partnership list
    console.log(`[CACHE] Saving partnership list with ${partnershipList.length} entries...`);
    await kv.set('partnership-list', partnershipList);
    
    // Also cache timestamp
    await kv.set('partnership-list-timestamp', Date.now());

    console.log('[CACHE] ✅ Cache rebuild complete!', totalSaved, 'partnerships saved');
    
    // Update status to completed
    try {
      await kv.set('partnership-cache-status', {
        status: 'completed',
        count: totalSaved,
        endTime: Date.now(),
        message: `${totalSaved} partnerships cached.`
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
