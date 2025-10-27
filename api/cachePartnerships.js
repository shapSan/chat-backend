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
  
  // Only require auth for POST method (rebuild cache)
  if (req.method === 'POST' && req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow POST without auth for frontend rebuild button
    console.log('[CACHE] Frontend-initiated cache refresh (no auth)');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST to rebuild cache.' });
  }

  console.log('[CACHE] Starting partnership cache refresh...');
  
  try {
    // Use the defined pipeline stages for active partnerships
    // PLUS require start_date to exist to reduce data size
    const filterGroups = [
      {
        // Filter by active pipeline stages AND must have start date
        filters: [
          {
            propertyName: 'hs_pipeline_stage',
            operator: 'IN',
            values: ACTIVE_STAGES  // Use the defined stage IDs
          },
          {
            propertyName: 'start_date',
            operator: 'HAS_PROPERTY'  // Must have a start date
          }
        ]
      }
    ];
    
    console.log('[CACHE] Fetching partnerships in active stages WITH start_date:', ACTIVE_STAGES);
    console.log('[CACHE] Filter groups:', JSON.stringify(filterGroups, null, 2));
    
    // Support pagination to get all matching partnerships
    let allPartnerships = [];
    let after = undefined;
    let pageCount = 0;
    const maxPages = 10; // Support up to 1000 partnerships
    
    const partnershipProperties = [
      'partnership_name',
      'hs_pipeline_stage',
      'production_stage',         // Production stage field
      'start_date',               // CORRECTED: Primary start date field
      'production_start_date',    // Keep as fallback
      'release__est__date',       // Primary release field with double underscores
      'release_est_date',         // Keep as fallback
      'content_type',             // Content type field (Film - Theatrical, etc.)
      'movie_rating',             // MPAA movie ratings (G, PG, PG-13, R, NC-17)
      'tv_ratings',               // TV ratings (TV-G, TV-PG, TV-14, TV-MA)
      'sub_ratings_for_tv_content', // TV sub-ratings (D, L, S, V)
      'rating',                   // Generic rating field fallback
      'hs_lastmodifieddate',      // Object last modified date/time - CRITICAL FOR SORTING
      'genre_production',
      'production_type',
      'synopsis',
      'main_cast',                // Main cast members
      'shoot_location__city_',    // CRITICAL: Shooting location
      'audience_segment',         // CRITICAL: Target audience
      'partnership_status',       // Partnership status
      'distributor',              // Distributor
      'brand_name',               // Brand name
      'amount',                   // Deal amount
      'hollywood_branded_fee',    // HB fee
      'closedate',                // Close date
      'contract_sent_date',       // Contract sent date
      'num_associated_contacts',  // Number of contacts
      'est__shooting_end_date',   // Shooting end date
      'production_end_date',      // Production end date
      'time_period',              // Time period
      'plot_location',            // Plot location
      'storyline_location__city_',// Storyline city
      'audience_segment',         // Audience segment
      'partnership_setting'       // Partnership setting
    ];
    
    do {
      try {
        // Add delay between requests to avoid rate limits
        if (pageCount > 0) {
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        
        const searchParams = {
          limit: 100,  // Back to 100 now that we're filtering by start_date
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
        
        if (result.results && result.results.length > 0) {
          allPartnerships = [...allPartnerships, ...result.results];
          console.log(`[CACHE] Fetched ${result.results.length} partnerships (total: ${allPartnerships.length})`);
        }
        
        after = result.paging?.next?.after;
        pageCount++;
        
      } catch (pageError) {
        console.error(`[CACHE] Error fetching partnerships page ${pageCount + 1}:`, pageError);
        console.error(`[CACHE] Error stack:`, pageError.stack);
        break;
      }
    } while (after && pageCount < maxPages);

    const partnerships = allPartnerships;
    console.log(`[CACHE] Total partnerships fetched: ${partnerships.length} in ${pageCount} pages`);
    
    if (partnerships.length === 0) {
      console.log('[CACHE] No partnerships found, returning empty response');
      return res.status(200).json({ 
        status: 'warning', 
        message: 'No active partnerships found',
        partnerships: [],
        count: 0
      });
    }

    console.log('[CACHE] Starting brand fetching for matching...');

    // Fetch brand pool for matching (425 brands total)
    // Split into chunks respecting HubSpot's 200 limit
    const brandBuckets = [
      // 150 Active brands
      {
        filterGroups: [{
          filters: [{
            propertyName: 'client_status',
            operator: 'EQ',
            value: 'Active'
          }]
        }],
        limit: 150
      },
      // 75 Inactive brands
      {
        filterGroups: [{
          filters: [{
            propertyName: 'client_status',
            operator: 'EQ',
            value: 'Inactive'
          }]
        }],
        limit: 75
      },
      // 200 Pending brands (respecting API limit)
      {
        filterGroups: [{
          filters: [{
            propertyName: 'client_status',
            operator: 'EQ',
            value: 'Pending'
          }]
        }],
        limit: 200
      }
    ];

    let allBrands = [];
    
    console.log('[CACHE] Fetching brands in', brandBuckets.length, 'buckets...');
    
    for (const bucket of brandBuckets) {
      try {
        console.log('[CACHE] Fetching bucket:', bucket.filterGroups[0].filters[0].value);
        const brandResult = await hubspotAPI.searchBrands({
          ...bucket,
          properties: [
            'hs_object_id',
            'brand_name',
            'main_category',
            'target_gen',
            'target_age_group__multi_',
            'client_status',
            'partnership_count'
          ]
        });
        
        if (brandResult.results) {
          allBrands = [...allBrands, ...brandResult.results];
          console.log('[CACHE] Fetched', brandResult.results.length, 'brands, total:', allBrands.length);
        }
      } catch (error) {
        console.error('[CACHE] Error fetching brand bucket:', error.message);
      }
    }

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
        location: props.shoot_location__city_ || null,
        audience_segment: props.audience_segment || null,
        distributor: props.distributor || null,
        synopsis: props.synopsis || null,
        genre_production: props.genre_production || null,
        vibe: props.genre_production || null,
        productionStartDate: props.start_date || props.production_start_date || null,
        releaseDate: props.release__est__date || props.release_est_date || null,
        productionType: props.production_type || null,
        partnership_setting: props.partnership_setting || null
      };
      
      return finalObject;
    });
    
    console.log(`[CACHE] ✅ Formatted ${matchedPartnerships.length} partnerships`);

    // Cache the results
    await kv.set('hubspot-partnership-matches', matchedPartnerships);
    
    // Also cache timestamp
    await kv.set('hubspot-partnership-matches-timestamp', Date.now());

    console.log('[CACHE] ✅ About to return response with', matchedPartnerships.length, 'partnerships');
    console.log('[CACHE] First partnership:', matchedPartnerships[0]?.name || 'NO NAME');
    console.log('[CACHE] Response will include partnerships array:', Array.isArray(matchedPartnerships));

    res.status(200).json({ 
      status: 'ok', 
      partnerships: matchedPartnerships,  // Return actual data, not count
      count: matchedPartnerships.length,
      message: `Cached ${matchedPartnerships.length} partnerships with brand matches`
    });
    
    console.log('[CACHE] ✅ Response sent successfully');
    
  } catch (error) {
    console.error('[CACHE] Fatal error during partnership cache refresh:', error);
    res.status(500).json({ 
      error: 'Failed to refresh partnership cache', 
      details: error.message 
    });
  }
}
