// api/cachePartnerships.js
import { kv } from '@vercel/kv';
import hubspotAPI from '../client/hubspot-client.js';

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
    // No date filtering - we want ALL partnerships in active stages
    const filterGroups = [
      {
        // Filter by active pipeline stages using the IDs
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
      'synopsis'
    ];
    
    do {
      try {
        // Add delay between requests to avoid rate limits
        if (pageCount > 0) {
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        
        const searchParams = {
          limit: 100,
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
        
        if (result.results && result.results.length > 0) {
          allPartnerships = [...allPartnerships, ...result.results];
          console.log(`[CACHE] Fetched ${result.results.length} partnerships (total: ${allPartnerships.length})`);
        }
        
        after = result.paging?.next?.after;
        pageCount++;
        
      } catch (pageError) {
        console.error(`[CACHE] Error fetching partnerships page ${pageCount + 1}:`, pageError);
        break;
      }
    } while (after && pageCount < maxPages);

    const partnerships = allPartnerships;
    console.log(`[CACHE] Total partnerships fetched: ${partnerships.length} in ${pageCount} pages`);
    
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
      
      // Debug log to see what fields we're getting
      console.log('[CACHE] Sample partnership properties:', {
        name: props.partnership_name,
        hs_lastmodifieddate: props.hs_lastmodifieddate,
        all_keys: Object.keys(props)
      });
      
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
      
      // Debug: Log first partnership to verify lastModified is present
      if (partnership === partnerships[0]) {
        console.log('[CACHE] First partnership lastModified value:', props.hs_lastmodifieddate);
      }
      
      return {
        id: partnership.id,
        name: props.partnership_name || 'Untitled Project',
        genre: props.genre_production || 'General',
        production_type: props.production_type || '',  // Add production type
        rating: getRating(),
        releaseDate: props.release__est__date || props.release_est_date || null,  // Prioritize double underscore version
        startDate: props.start_date || props.production_start_date || null,  // Prioritize start_date
        productionStage: props.production_stage || '',
        pipelineStage: props.hs_pipeline_stage || '',
        synopsis: props.synopsis || '',
        stage: props.production_stage || props.hs_pipeline_stage || '',
        lastModified: props.hs_lastmodifieddate || null,  // Add last modified date
        // Include sub-ratings if available for TV content
        subRatings: props.sub_ratings_for_tv_content || null,
        matchedBrands: topBrands
      };
    });

    // Cache the results (no TTL - persistent like brands cache)
    await kv.set('hubspot-partnership-matches', matchedPartnerships);
    
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
