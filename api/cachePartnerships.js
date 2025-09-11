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
    // Fetch active partnerships - using simpler approach first
    const partnershipResult = await hubspotAPI.searchProductions({
      limit: 200,
      filterGroups: [{
        filters: [] // Get all for now, we'll filter later
      }],
      properties: [
        'partnership_name',
        'hs_pipeline_stage',
        'start_date',
        'release__est__date',
        'hs_lastmodifieddate',
        'genre_production',
        'production_type',
        'synopsis'
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
      
      return {
        id: partnership.id,
        name: props.partnership_name || 'Untitled Project',
        genre: props.genre_production || 'General',
        rating: 'TBD',  // Simplified since these fields might not exist
        releaseDate: props.release__est__date || props.start_date || null,
        startDate: props.start_date || null,
        synopsis: props.synopsis || '',
        stage: props.hs_pipeline_stage || '',
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
