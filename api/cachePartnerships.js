// api/cachePartnerships.js
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
    // Get current date for filtering - we want partnerships starting or releasing from today onwards
    const now = new Date();
    const currentDateISO = now.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    
    console.log(`[CACHE] Using filter: dates from ${currentDateISO} (today) onwards`);
    
    // Simple date-based filters only - including today
    const filterGroups = [
      {
        // Group 1: Production Start Date from today onwards
        filters: [
          {
            propertyName: 'start_date',  // CORRECT FIELD NAME
            operator: 'GTE',  // Greater than or equal to (includes today)
            value: currentDateISO
          }
        ]
      },
      {
        // Group 2: OR - Release date from today onwards  
        filters: [
          {
            propertyName: 'release__est__date',  // CORRECT FIELD NAME WITH DOUBLE UNDERSCORE
            operator: 'GTE',  // Greater than or equal to (includes today)
            value: currentDateISO
          }
        ]
      }
    ];
    
    console.log('[CACHE] Fetching partnerships with filters:');
    console.log(`  - Group 1: start_date >= ${currentDateISO}`);
    console.log(`  - Group 2: OR release__est__date >= ${currentDateISO}`);
    console.log('[CACHE] Filter groups:', JSON.stringify(filterGroups, null, 2));
    
    // Support pagination to get all matching partnerships
    let allPartnerships = [];
    let after = undefined;
    let pageCount = 0;
    const maxPages = 4; // Support up to 400 partnerships (100 per page x 4 pages)
    
    const partnershipProperties = [
      'partnership_name',
      'hs_pipeline_stage',
      'production_stage',         // Production stage field
      'start_date',               // Primary start date field
      'production_start_date',    // Alternative start date field
      'release__est__date',       // Primary release field with double underscores
      'release_est_date',         // Alternative release field
      'est__shooting_start_date', // Another possible start date field
      'movie_rating',             // MPAA movie ratings (G, PG, PG-13, R, NC-17)
      'tv_ratings',               // TV ratings (TV-G, TV-PG, TV-14, TV-MA)
      'sub_ratings_for_tv_content', // TV sub-ratings (D, L, S, V)
      'rating',                   // Generic rating field fallback
      'hs_lastmodifieddate',
      'genre_production',
      'production_type',
      'synopsis'
    ];
    
    // Fetch first page to see if pagination is even needed
    try {
      const firstPageParams = {
        limit: 100,  // HubSpot max per page
        filterGroups,
        properties: partnershipProperties
      };
      
      console.log(`[CACHE] Fetching partnerships page 1...`);
      const firstResult = await hubspotAPI.searchProductions(firstPageParams);
      
      // Debug: Log what we're getting back
      console.log(`[CACHE] API Response - Total results: ${firstResult.total || 0}`);
      if (firstResult.results && firstResult.results.length > 0) {
        // Log sample data to see what fields are populated
        const sample = firstResult.results[0];
        console.log('[CACHE] Sample partnership data:');
        console.log(`  - ID: ${sample.id}`);
        console.log(`  - Name: ${sample.properties?.partnership_name}`);
        console.log(`  - start_date: ${sample.properties?.start_date || 'NOT SET'}`);
        console.log(`  - production_start_date: ${sample.properties?.production_start_date || 'NOT SET'}`);
        console.log(`  - release__est__date: ${sample.properties?.release__est__date || 'NOT SET'}`);
        console.log(`  - hs_pipeline_stage: ${sample.properties?.hs_pipeline_stage || 'NOT SET'}`);
        
        allPartnerships = [...firstResult.results];
        console.log(`[CACHE] Page 1: ${firstResult.results.length} partnerships`);
      } else {
        console.log('[CACHE] No results returned from API');
      }
      
      // Only continue pagination if there's actually a next page cursor
      after = firstResult.paging?.next?.after;
      pageCount = 1;
      
      // Continue fetching additional pages ONLY if after cursor exists
      while (after && pageCount < maxPages) {
        try {
          // Add delay between requests to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 200));
          
          const nextPageParams = {
            limit: 100,
            filterGroups,
            properties: partnershipProperties,
            after: after  // Always include the after cursor
          };
          
          console.log(`[CACHE] Fetching page ${pageCount + 1} with cursor: ${after.substring(0, 20)}...`);
          const result = await hubspotAPI.searchProductions(nextPageParams);
          
          if (result.results && result.results.length > 0) {
            // Check if we're getting new results or duplicates
            const newResults = result.results.filter(p => 
              !allPartnerships.some(existing => existing.id === p.id)
            );
            
            if (newResults.length === 0) {
              console.log(`[CACHE] Page ${pageCount + 1}: All ${result.results.length} items were duplicates. Stopping pagination.`);
              break;
            }
            
            allPartnerships = [...allPartnerships, ...newResults];
            console.log(`[CACHE] Page ${pageCount + 1}: ${newResults.length} new, ${result.results.length - newResults.length} duplicates (total: ${allPartnerships.length})`);
          } else {
            console.log(`[CACHE] Page ${pageCount + 1}: No results. Stopping pagination.`);
            break;
          }
          
          // Check if there's a next page
          if (!result.paging?.next?.after || result.paging.next.after === after) {
            console.log(`[CACHE] No more pages or same cursor returned. Stopping.`);
            break;
          }
          
          after = result.paging.next.after;
          pageCount++;
          
        } catch (pageError) {
          console.error(`[CACHE] Error fetching page ${pageCount + 1}:`, pageError);
          break;
        }
      }
    } catch (error) {
      console.error('[CACHE] Error fetching first page:', error);
      throw error;
    }

    // Deduplicate partnerships by ID (in case of pagination issues)
    const uniquePartnerships = new Map();
    allPartnerships.forEach(partnership => {
      if (partnership.id && !uniquePartnerships.has(partnership.id)) {
        uniquePartnerships.set(partnership.id, partnership);
      }
    });
    
    let partnerships = Array.from(uniquePartnerships.values());
    console.log(`[CACHE] Total unique partnerships: ${partnerships.length} (from ${allPartnerships.length} total, ${pageCount} pages)`);
    
    // If no results with date filters, try without filters as fallback
    if (partnerships.length === 0) {
      console.log('[CACHE] No partnerships found with date filters. Trying without filters...');
      
      try {
        const fallbackParams = {
          limit: 100,
          properties: partnershipProperties,
          sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }]
        };
        
        const fallbackResult = await hubspotAPI.searchProductions(fallbackParams);
        
        if (fallbackResult.results && fallbackResult.results.length > 0) {
          partnerships = fallbackResult.results;
          console.log(`[CACHE] Fallback: Found ${partnerships.length} partnerships without filters`);
          
          // Log why they might not match the date filters
          const sample = partnerships[0];
          console.log('[CACHE] Sample partnership (no filters):');
          console.log(`  - Name: ${sample.properties?.partnership_name}`);
          console.log(`  - start_date: ${sample.properties?.start_date || 'NOT SET'}`);
          console.log(`  - production_start_date: ${sample.properties?.production_start_date || 'NOT SET'}`);
          console.log(`  - release__est__date: ${sample.properties?.release__est__date || 'NOT SET'}`);
        }
      } catch (fallbackError) {
        console.error('[CACHE] Fallback query also failed:', fallbackError);
      }
    }
    
    if (partnerships.length === 0) {
      return res.status(200).json({ 
        status: 'warning', 
        message: 'No active partnerships found',
        partnerships: 0
      });
    }

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
    
    for (const bucket of brandBuckets) {
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
      }
    }

    console.log(`[CACHE] Fetched ${partnerships.length} partnerships and ${allBrands.length} brands`);

    // Perform matching (simplified scoring logic)
    const matchedPartnerships = partnerships.map(partnership => {
      const props = partnership.properties;
      
      // Score each brand for this partnership
      const scoredBrands = allBrands.map(brand => {
        const brandProps = brand.properties;
        let score = Math.floor(Math.random() * 30) + 40; // Base score 40-70
        
        // Simple scoring based on available data
        // Bonus for active brands
        if (brandProps.client_status === 'Active') {
          score += 20;
        }
        
        // Bonus for high partnership count
        const partnershipCount = parseInt(brandProps.partnership_count || 0);
        if (partnershipCount > 10) score += 10;
        if (partnershipCount > 5) score += 5;
        
        // Genre-based scoring if genre exists
        if (props.genre_production && brandProps.main_category) {
          const genreCategories = {
            'Action': ['Automotive', 'Sports & Fitness', 'Electronics & Appliances'],
            'Comedy': ['Food & Beverage', 'Entertainment'],
            'Drama': ['Fashion & Apparel', 'Health & Beauty'],
            'Horror': ['Entertainment', 'Gaming'],
            'Romance': ['Fashion & Apparel', 'Health & Beauty', 'Floral'],
            'Thriller': ['Automotive', 'Security', 'Electronics & Appliances'],
            'Family': ['Food & Beverage', 'Baby Care', 'Entertainment']
          };
          
          const genres = (props.genre_production || '').split(';');
          genres.forEach(genre => {
            const categories = genreCategories[genre.trim()] || [];
            if (categories.includes(brandProps.main_category)) {
              score += 15;
            }
          });
        }
        
        return {
          id: brand.id,
          name: brandProps.brand_name || 'Unknown Brand',
          category: brandProps.main_category || 'General',
          status: brandProps.client_status || 'Unknown',
          score: Math.min(100, score) // Cap at 100
        };
      });
      
      // Sort by score and take top 30
      scoredBrands.sort((a, b) => b.score - a.score);
      const topBrands = scoredBrands.slice(0, 30);
      
      // Get the appropriate rating
      const getRating = () => {
        // Check movie rating first
        if (props.movie_rating && props.movie_rating !== null && props.movie_rating !== '') {
          return props.movie_rating;
        }
        // If no movie rating, check TV rating
        if (props.tv_ratings && props.tv_ratings !== null && props.tv_ratings !== '') {
          return props.tv_ratings;
        }
        // Check generic rating field as fallback
        if (props.rating && props.rating !== null && props.rating !== '') {
          return props.rating;
        }
        // If none exist, return TBD
        return 'TBD';
      };
      
      return {
        id: partnership.id,
        name: props.partnership_name || 'Untitled Project',
        genre: props.genre_production || 'General',
        rating: getRating(),
        releaseDate: props.release__est__date || props.release_est_date || null,  // Prioritize double underscore version
        startDate: props.start_date || props.production_start_date || null,  // Prioritize start_date
        productionStage: props.production_stage || '',
        pipelineStage: props.hs_pipeline_stage || '',
        synopsis: props.synopsis || '',
        stage: props.production_stage || props.hs_pipeline_stage || '',
        // Include sub-ratings if available for TV content
        subRatings: props.sub_ratings_for_tv_content || null,
        matchedBrands: topBrands
      };
    });

    // Cache the results
    await kv.set('hubspot-partnership-matches', matchedPartnerships, {
      ex: 300 // 5 minute TTL
    });
    
    // Also cache timestamp
    await kv.set('hubspot-partnership-matches-timestamp', Date.now());

    res.status(200).json({ 
      status: 'ok', 
      partnerships: matchedPartnerships.length,
      message: `Cached ${matchedPartnerships.length} partnerships with brand matches`
    });
    
  } catch (error) {
    console.error('[CACHE] Fatal error during partnership cache refresh:', error);
    res.status(500).json({ 
      error: 'Failed to refresh partnership cache', 
      details: error.message 
    });
  }
}
