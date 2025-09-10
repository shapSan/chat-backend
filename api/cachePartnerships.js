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
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('[CACHE] Starting partnership cache refresh...');
  
  try {
    // Fetch active partnerships
    const partnershipResult = await hubspotAPI.searchProductions({
      limit: 200,
      filterGroups: [{
        filters: [
          {
            propertyName: 'hs_pipeline_stage',
            operator: 'IN',
            values: ACTIVE_STAGES
          }
        ]
      }],
      properties: [
        'hs_object_id',
        'partnership_name',
        'hs_pipeline_stage',
        'start_date',
        'release__est__date',
        'hs_lastmodifieddate',
        'genre_production',
        'production_type',
        'movie_rating',
        'tv_ratings',
        'synopsis',
        'hb_priority'
      ]
    });

    const partnerships = partnershipResult.results || [];
    
    if (partnerships.length === 0) {
      return res.status(200).json({ 
        status: 'warning', 
        message: 'No active partnerships found',
        partnerships: 0
      });
    }

    // Fetch brand pool for matching (500 brands)
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
      // 275 Pending brands
      {
        filterGroups: [{
          filters: [{
            propertyName: 'client_status',
            operator: 'EQ',
            value: 'Pending'
          }]
        }],
        limit: 275
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
        let score = 0;
        
        // Genre to category mapping
        const genreCategories = {
          'Action': ['Automotive', 'Sports & Fitness', 'Electronics & Appliances'],
          'Comedy': ['Food & Beverage', 'Entertainment'],
          'Drama': ['Fashion & Apparel', 'Health & Beauty'],
          'Horror': ['Entertainment', 'Gaming'],
          'Romance': ['Fashion & Apparel', 'Health & Beauty', 'Floral'],
          'Thriller': ['Automotive', 'Security', 'Electronics & Appliances'],
          'Family': ['Food & Beverage', 'Baby Care', 'Entertainment']
        };
        
        // Check genre match
        const genres = (props.genre_production || '').split(';');
        genres.forEach(genre => {
          const categories = genreCategories[genre] || [];
          if (categories.includes(brandProps.main_category)) {
            score += 30;
          }
        });
        
        // Rating to age group mapping
        const ratingAgeMap = {
          'G': ['0-12', '13-17'],
          'PG': ['0-12', '13-17', '18-20'],
          'PG-13': ['13-17', '18-20', '21-24'],
          'R': ['18-20', '21-24', '25-34', '35-44'],
          'TV-Y': ['0-12'],
          'TV-Y7': ['0-12', '13-17'],
          'TV-14': ['13-17', '18-20', '21-24'],
          'TV-MA': ['18-20', '21-24', '25-34', '35-44']
        };
        
        const rating = props.movie_rating || props.tv_ratings;
        if (rating) {
          const targetAges = ratingAgeMap[rating] || [];
          const brandAges = (brandProps.target_age_group__multi_ || '').split(';');
          
          targetAges.forEach(age => {
            if (brandAges.includes(age)) {
              score += 20;
            }
          });
        }
        
        // Bonus for active brands
        if (brandProps.client_status === 'Active') {
          score += 15;
        }
        
        // Bonus for high partnership count
        const partnershipCount = parseInt(brandProps.partnership_count || 0);
        if (partnershipCount > 10) score += 10;
        if (partnershipCount > 5) score += 5;
        
        return {
          id: brand.id,
          name: brandProps.brand_name,
          category: brandProps.main_category,
          status: brandProps.client_status,
          score
        };
      });
      
      // Sort by score and take top 30
      scoredBrands.sort((a, b) => b.score - a.score);
      const topBrands = scoredBrands.slice(0, 30);
      
      return {
        id: partnership.id,
        name: props.partnership_name,
        genre: props.genre_production,
        rating: props.movie_rating || props.tv_ratings,
        releaseDate: props.release__est__date,
        startDate: props.start_date,
        synopsis: props.synopsis,
        priority: props.hb_priority,
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
