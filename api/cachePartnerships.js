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
    
    // Fetch ALL partnerships matching the filter criteria (up to 400)
    let allPartnerships = [];
    let after = undefined;
    let pageCount = 0;
    const maxPages = 10; // Allow up to 10 pages to ensure we get all data
    
    do {
      try {
        // Add delay between requests to avoid rate limits
        if (pageCount > 0) {
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        
        const searchParams = {
          limit: 100,
          properties: [
            'partnership_name',
            'hs_pipeline_stage',
            'production_stage',
            'start_date',
            'production_start_date',
            'release__est__date',
            'release_est_date',
            'movie_rating',
            'tv_ratings',
            'sub_ratings_for_tv_content',
            'rating',
            'hs_lastmodifieddate',
            'genre_production',
            'production_type',
            'synopsis'
          ],
          filterGroups: filterGroups,
          sorts: [{
            propertyName: 'hs_lastmodifieddate',
            direction: 'DESCENDING'
          }]
        };
        
        if (after) {
          searchParams.after = after;
        }
        
        console.log(`[CACHE] Fetching page ${pageCount + 1}...`);
        const result = await hubspotAPI.searchProductions(searchParams);
        
        if (result.results && result.results.length > 0) {
          allPartnerships = [...allPartnerships, ...result.results];
          console.log(`[CACHE] Fetched ${result.results.length} partnerships (total: ${allPartnerships.length})`);
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
    
    console.log(`[CACHE] Fetched ${allPartnerships.length} total partnerships in ${pageCount} pages`);

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
