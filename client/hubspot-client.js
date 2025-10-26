//client/hubspot-client.js

import fetch from 'node-fetch';
import { kv } from '@vercel/kv';
import { logStage, HB_KEYS } from '../lib/hbDebug.js';

export const hubspotApiKey = process.env.HUBSPOT_API_KEY;

// Normalize placeholder project names to null
function normalizeProjectName(name) {
  if (!name || typeof name !== 'string') return null;
  
  const cleaned = name.trim().toUpperCase();
  
  // Common placeholder patterns
  const placeholders = [
    'UNTITLED',
    'TBD',
    'TO BE DETERMINED',
    'PENDING',
    'N/A',
    'NONE',
    'NO TITLE',
    'NO NAME'
  ];
  
  // Check if it's just a placeholder
  if (placeholders.some(p => cleaned === p || cleaned.startsWith(p + ' '))) {
    return null;
  }
  
  // Return the original name if it's valid
  return name.trim();
}

// Rate limiter class for HubSpot API
class RateLimiter {
  constructor(requestsPerSecond) {
    this.tokens = requestsPerSecond;
    this.requestsPerSecond = requestsPerSecond;
    this.lastRefill = Date.now();
  }

  async acquire() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    this.tokens += elapsedSeconds * this.requestsPerSecond;
    this.lastRefill = now;

    this.tokens = Math.min(this.requestsPerSecond, this.tokens);

    if (this.tokens < 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.acquire();
    }

    this.tokens--;
    return true;
  }
}

// Create rate limiter instance (8 requests per second, staying below HubSpot's 10/sec limit)
const hubspotLimiter = new RateLimiter(8);

const hubspotAPI = {
  baseUrl: 'https://api.hubapi.com',
  portalId: '442891', // Updated to correct portal ID
  isInitialized: false,
  initializationPromise: null,

  OBJECTS: {
    BRANDS: '2-26628489',
    PARTNERSHIPS: '2-27025032',
    DEALS: 'deals',
    COMPANIES: 'companies',
    CONTACTS: 'contacts'
  },

  // Add initialization method to warm up the connection
  async initialize() {
    if (this.isInitialized) return true;
    
    // If already initializing, wait for it
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    
    this.initializationPromise = (async () => {
      try {
        console.log('[DEBUG HubSpot] Initializing connection...');
        
        // Make a simple test call to warm up the connection
        const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.BRANDS}?limit=1`, {
          headers: {
            'Authorization': `Bearer ${hubspotApiKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          console.error('[DEBUG HubSpot] Initialization failed:', response.status);
          this.isInitialized = false;
          return false;
        }
        
        console.log('[DEBUG HubSpot] Connection initialized successfully');
        this.isInitialized = true;
        return true;
      } catch (error) {
        console.error('[DEBUG HubSpot] Initialization error:', error.message);
        this.isInitialized = false;
        return false;
      }
    })();
    
    return this.initializationPromise;
  },

  async searchBrands(filters = {}) {
    // Acquire rate limit token first
    await hubspotLimiter.acquire();
    
    console.log('[DEBUG searchBrands] Starting with filters:', filters);
    
    // Ensure we're initialized before searching
    if (!this.isInitialized) {
      console.log('[DEBUG searchBrands] Not initialized, initializing now...');
      await this.initialize();
      // Add a small delay after initialization to ensure everything is ready
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    try {
      // Default properties to request - include new filter fields
      const defaultProperties = [
        'id',
        'brand_name',
        'client_status',
        'client_type',
        'main_category',
        'new_product_main_category',  // NEW: Required for filtering
        'relationship_type',           // NEW: Required for filtering
        'partner_agency_id',           // NEW: For partner agency tracking
        'product_sub_category__multi_',
        'partnership_count',
        'deals_count',
        'target_gender_',
        'target_geography',
        'hs_lastmodifieddate',
        'one_sheet_link',  // Brand one-sheet document
        // Owner field variations
        'secondary_owner',  // Client Team Lead
        'secondaryowner',   // Alternative naming
        'secondary_owner_id',
        'specialty_lead',   // Specialty Lead
        'specialtylead',    // Alternative naming
        'specialty_lead_id',
        'partnerships_lead', // Partnerships Lead
        'partnershipslead',  // Alternative naming
        'partnerships_lead_id',
        'hubspot_owner_id',  // Primary Owner - REQUIRED for filtering
        'hubspot_owner',
        'hs_owner_id',
        'owner'  // Generic owner field
      ];
      
      let searchBody = {
        properties: filters.properties || defaultProperties,  // Use provided properties or defaults
        limit: filters.limit || 50,
        sorts: [{
          propertyName: 'partnership_count',
          direction: 'DESCENDING'
        }]
      };

      // Add pagination support
      if (filters.after) {
        searchBody.after = filters.after;
        console.log('[DEBUG searchBrands] Paginating with after:', filters.after);
      }
      
      // Check if explicit filterGroups are provided (from bucket searches)
      if (filters.filterGroups && filters.filterGroups.length > 0) {
        console.log('[DEBUG searchBrands] Using provided filterGroups:', JSON.stringify(filters.filterGroups));
        searchBody.filterGroups = filters.filterGroups;
        
        // Use provided sorts if available
        if (filters.sorts && filters.sorts.length > 0) {
          searchBody.sorts = filters.sorts;
        }
      } else if (filters.searchType === 'synopsis') {
        console.log('[DEBUG searchBrands] Using synopsis/genre search logic...');

        // Extract genre from synopsis for category matching
        const genreMap = {
          'action': ['Automotive', 'Electronics & Appliances', 'Sports & Fitness'],
          'comedy': ['Food & Beverage', 'Entertainment'],
          'drama': ['Fashion & Apparel', 'Health & Beauty', 'Home & Garden'],
          'romance': ['Floral', 'Fashion & Apparel', 'Health & Beauty'],
          'family': ['Food & Beverage', 'Baby Care', 'Entertainment'],
          'horror': ['Entertainment', 'Gaming'],
          'crime': ['Automotive', 'Security', 'Electronics & Appliances'],
          'thriller': ['Automotive', 'Security', 'Electronics & Appliances'],
          'sci-fi': ['Electronics & Appliances', 'Gaming', 'Automotive']
        };

        // Simple genre detection
        const queryLower = (filters.query || '').toLowerCase();
        let categories = [];

        for (const [genre, cats] of Object.entries(genreMap)) {
          if (queryLower.includes(genre)) {
            categories = [...categories, ...cats];
          }
        }

        // Remove duplicates
        categories = [...new Set(categories)];

        // Build filter groups - MUST have active status
        searchBody.filterGroups = [{
          filters: [{
            propertyName: 'client_status',
            operator: 'IN',
            values: ['Active', 'In Negotiation', 'Contract']
          }]
        }];

        // Add category filter if we found matching categories
        if (categories.length > 0) {
          searchBody.filterGroups.push({
            filters: [{
              propertyName: 'main_category',
              operator: 'IN',
              values: categories
            }]
          });
        }

      } else if (filters.query) {
        // This is the logic for 'keywords' or default search
        console.log('[DEBUG searchBrands] Keyword search for:', filters.query);
        
        searchBody.filterGroups = [{
          filters: [{
            propertyName: 'brand_name',
            operator: 'CONTAINS_TOKEN',
            value: filters.query
          }]
        }];
        
        // Add the limit higher for keyword searches to get more results
        searchBody.limit = filters.limit || 30;
        
        // Sort by relevance (partnership count) rather than filtering by status
        searchBody.sorts = [{
          propertyName: 'partnership_count',
          direction: 'DESCENDING'
        }];
        
      } else {
        // Default: New filter logic for brand cache
        // Matches if EITHER group is true:
        // Group 1: Active/Pending with category and owner
        // Group 2: Partner Agency Client
        searchBody.filterGroups = [
          {
            // Group 1: ALL conditions must be met
            filters: [
              {
                propertyName: 'client_status',
                operator: 'IN',
                values: ['Active', 'Pending (Prospect)']
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
            // Group 2: Partner Agency Client
            filters: [
              {
                propertyName: 'relationship_type',
                operator: 'EQ',
                value: 'Partner Agency Client'
              }
            ]
          }
        ];

        // Sort by last modified to get most recent first
        searchBody.sorts = [{
          propertyName: 'hs_lastmodifieddate',
          direction: 'DESCENDING'
        }];
      }

      console.log('[DEBUG searchBrands] Making HubSpot API request with searchBody:', JSON.stringify(searchBody, null, 2));
      
      // Make the actual search request with retry logic
      let attempts = 0;
      const maxAttempts = 2;
      let lastError = null;
      
      while (attempts < maxAttempts) {
        attempts++;
        
        try {
          const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.BRANDS}/search`, {
          method: 'POST',
          headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
          },
          body: JSON.stringify(searchBody)
          });

          if (!response.ok) {
          // Clone the response BEFORE reading body to avoid "body used already" error
          const errorBody = await response.clone().text();
          console.error(`[DEBUG searchBrands] HubSpot API error (attempt ${attempts}/${maxAttempts}):`, response.status, errorBody);
          
          // Handle rate limiting with exponential backoff
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(1000 * Math.pow(2, attempts), 10000);
            console.log(`[DEBUG searchBrands] Rate limited. Waiting ${waitTime}ms before retry...`);
            
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          }
          
            lastError = new Error(`HubSpot API error: ${response.status} - ${errorBody}`);
        
        // If it's a 401, don't retry
        if (response.status === 401) {
          throw lastError;
        }
        
        // Wait before retry for other errors
        if (attempts < maxAttempts) {
          console.log('[DEBUG searchBrands] Retrying after delay...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
      }

          const result = await response.json();
          console.log(`[DEBUG searchBrands] Success (attempt ${attempts}), got`, result.results?.length || 0, 'brands');
          
          // ADD DETAILED BRAND LOGGING
          if (result.results && result.results.length > 0) {
            const brandDetails = result.results.map(b => ({
              name: b.properties.brand_name,
              category: b.properties.main_category,
              sub_category: b.properties.product_sub_category__multi_
            }));
            console.log(`[DEBUG searchBrands] Data returned for query "${filters.searchType || 'bucket'}"`, brandDetails);
          }
          
          // If we got 0 results on first attempt with a specific query, try different search method
          if (attempts === 1 && result.results?.length === 0 && filters.query && filters.query.length < 50) {
            console.log('[DEBUG searchBrands] Got 0 results for keyword search, trying without filters...');
            
            // Fallback: Try with just the query parameter and no filters
            const fallbackBody = {
              query: filters.query,
              properties: searchBody.properties,
              limit: 30
            };
            
            const fallbackResponse = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.BRANDS}/search`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${hubspotApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(fallbackBody)
            });
            
            if (fallbackResponse.ok) {
              const fallbackResult = await fallbackResponse.json();
              console.log('[DEBUG searchBrands] Fallback search got', fallbackResult.results?.length || 0, 'brands');
              if (fallbackResult.results?.length > 0) {
                return fallbackResult;
              }
            }
            
            // If still no results, try one more time with a broader search
            console.log('[DEBUG searchBrands] Trying broader search without any filters...');
            const broaderBody = {
              properties: searchBody.properties,
              limit: 100,
              sorts: [{
                propertyName: 'hs_lastmodifieddate',
                direction: 'DESCENDING'
              }]
            };
            
            const broaderResponse = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.BRANDS}/search`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${hubspotApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(broaderBody)
            });
            
            if (broaderResponse.ok) {
              const broaderResult = await broaderResponse.json();
              console.log('[DEBUG searchBrands] Broader search got', broaderResult.results?.length || 0, 'brands');
              
              // Filter results client-side to match the query
              if (broaderResult.results?.length > 0) {
                const queryLower = filters.query.toLowerCase();
                broaderResult.results = broaderResult.results.filter(brand => {
                  const brandName = (brand.properties.brand_name || '').toLowerCase();
                  return brandName.includes(queryLower);
                });
                console.log('[DEBUG searchBrands] After client-side filtering:', broaderResult.results.length, 'brands match');
                return broaderResult;
              }
            }
          }

          // Include the search context in the result
          if (filters.query && result.results) {
            // Attach the genre categories that were used (if any)
            const queryLower = filters.query.toLowerCase();
            const genreMap = {
              'action': ['Automotive', 'Electronics & Appliances', 'Sports & Fitness'],
              'comedy': ['Food & Beverage', 'Entertainment'],
              'drama': ['Fashion & Apparel', 'Health & Beauty', 'Home & Garden'],
              'romance': ['Floral', 'Fashion & Apparel', 'Health & Beauty'],
              'thriller': ['Automotive', 'Security', 'Electronics & Appliances']
            };

            let detectedGenres = [];
            for (const [genre, cats] of Object.entries(genreMap)) {
              if (queryLower.includes(genre)) {
                detectedGenres.push(genre);
              }
            }

            if (detectedGenres.length > 0) {
              result.searchContext = detectedGenres.join(', ');
            }
          }

          return result;
          
        } catch (error) {
          lastError = error;
          if (attempts < maxAttempts) {
            console.log(`[DEBUG searchBrands] Error on attempt ${attempts}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      // If we get here, all attempts failed
      console.error("[DEBUG searchBrands] All attempts failed:", lastError);
      console.error("[DEBUG searchBrands] Stack trace:", lastError?.stack);
      return {
        results: []
      };
      
    } catch (error) {
      console.error("[DEBUG searchBrands] Unexpected error:", error);
      console.error("[DEBUG searchBrands] Stack trace:", error.stack);
      return {
        results: []
      };
    }
  },

  async searchProductions(filters = {}) {
    // Acquire rate limit token first
    await hubspotLimiter.acquire();
    
    // Ensure initialization
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    try {
      // Build the request body
      const requestBody = {
        filterGroups: filters.filterGroups || [{
          filters: []
        }],
        properties: filters.properties || [
          'partnership_name',      // Primary name field
          'partnership_status',
          'hs_pipeline_stage',
          'production_stage',      // Production stage (Pre-Production, Production, etc.)
          'synopsis',
          'content_type',
          'distributor',
          'brand_name',
          'amount',
          'hollywood_branded_fee',
          'closedate',
          'contract_sent_date',
          'num_associated_contacts',
          'hubspot_owner_id',
          'hs_lastmodifieddate',
          'release_est_date',      // Standard release date field
          'release__est__date',    // Legacy release date field
          'production_start_date', // Standard production start date
          'start_date',            // Legacy production start date
          'est__shooting_end_date', // Estimated shooting end date
          'production_end_date',   // Production end date
          'production_type',       // Type of production
          // CRITICAL: Cast fields that were MISSING
          'main_cast',             // Primary cast field
          'cast',                  // Alternative cast field
          'stars',                 // Alternative stars field
          'talent',                // Alternative talent field
          'lead_actors',           // Alternative lead actors field
          // Rating fields
          'movie_rating',          // MPAA movie ratings (G, PG, PG-13, R, NC-17)
          'tv_ratings',            // TV ratings (TV-G, TV-PG, TV-14, TV-MA)
          'sub_ratings_for_tv_content', // TV sub-ratings (D, L, S, V)
          'rating',                // Generic rating field fallback
          // Add contextual fields for better matching:
          'genre_production',      // Genre of the production
          'vibe',                  // Alternative genre field
          'time_period',           // Era/time period setting
          'shoot_location__city_', // CRITICAL: Actual shooting location field
          'storyline_location__city_',  // Story setting location
          'plot_location',         // Where the story takes place
          'audience_segment',      // Target audience
          'partnership_setting'    // Partnership setting/location
        ],
        limit: filters.limit || 30,
        sorts: filters.sorts || [{
          propertyName: 'hs_lastmodifieddate',
          direction: 'DESCENDING'
        }]
      };
      
      // CRITICAL FIX: Add the 'after' parameter for pagination if provided
      if (filters.after) {
        requestBody.after = filters.after;
        console.log('[DEBUG searchProductions] Paginating with after:', filters.after);
      }
      
      // === DETAILED API DEBUGGING ===
      const url = `${this.baseUrl}/crm/v3/objects/${this.OBJECTS.PARTNERSHIPS}/search`;
      const maskedApiKey = hubspotApiKey ? `${hubspotApiKey.substring(0, 8)}...${hubspotApiKey.substring(hubspotApiKey.length - 4)}` : 'NOT_SET';
      
      console.log('[DEBUG searchProductions] === API REQUEST DETAILS ===');
      console.log(`  URL: ${url}`);
      console.log(`  API Key (masked): ${maskedApiKey}`);
      console.log(`  Request Body:`);
      console.log(JSON.stringify(requestBody, null, 2));
      console.log('=======================================');
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      // === LOG RAW RESPONSE ===
      console.log('[DEBUG searchProductions] === API RESPONSE ===');
      console.log(`  Status: ${response.status} ${response.statusText}`);
      console.log(`  Headers:`, Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorBody = await response.text();
        console.error('[DEBUG searchProductions] ❌ API ERROR:');
        console.error(`  Status: ${response.status}`);
        console.error(`  Error Body:`, errorBody);
        console.log('=======================================');
        throw new Error(`HubSpot API error: ${response.status}`);
      }
      
      // Clone response to log raw text before parsing
      const responseClone = response.clone();
      const rawText = await responseClone.text();
      console.log(`  Raw Response (first 500 chars): ${rawText.substring(0, 500)}...`);
      
      const data = await response.json();
      console.log(`  Results Count: ${data.results?.length || 0}`);
      console.log(`  Has Paging: ${!!data.paging}`);
      if (data.paging?.next) {
        console.log(`  Next Page Available: ${data.paging.next.after}`);
      }
      console.log('=======================================');
      
      // REMOVED: Debug logging that was causing crash
      // The logStage call was failing with "keys is not iterable"
      // if (Array.isArray(data?.results)) {
      //   for (const rec of data.results) {
      //     logStage('A RAW', rec, HB_KEYS);
      //   }
      // }
      
      return data;
    } catch (error) {
      console.error('[DEBUG searchProductions] Exception:', error.message);
      console.error('[DEBUG searchProductions] Stack:', error.stack);
      return {
        results: []
      };
    }
  },

  async getPartnershipForProject(projectName) {
    if (!projectName) return null;
    
    console.log(`\n========================================`);
    console.log(`[getPartnershipForProject] STARTING SEARCH`);
    console.log(`  Project Name: "${projectName}"`);
    console.log(`========================================\n`);
    
    // --- Cache check first ---
    const cleanProjectName = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 100);
    const cacheKey = `partnership-data:${cleanProjectName}`;
    
    try {
      const cachedData = await kv.get(cacheKey);
      if (cachedData) {
        // Check cache staleness (3 hour threshold)
        const cacheAge = cachedData.cachedAt ? Date.now() - new Date(cachedData.cachedAt).getTime() : Infinity;
        const CACHE_STALENESS_THRESHOLD = 3 * 60 * 60 * 1000; // 3 hours
        
        if (cacheAge < CACHE_STALENESS_THRESHOLD) {
          console.log(`[getPartnershipForProject] ✅ Cache HIT for: "${projectName}" (age: ${Math.round(cacheAge / 60000)}min)`);
          
          // CRITICAL: Validate cached cast data to fix any previously cached corrupt data
          if (cachedData.cast && typeof cachedData.cast === 'string') {
            const castLower = cachedData.cast.toLowerCase();
            // Check if the cached cast is actually synopsis text
            if (castLower.startsWith('of characters') || 
                castLower.includes('ensemble cast') ||
                castLower.includes('confront') ||
                castLower.includes('re-emergence')) {
              console.log('[getPartnershipForProject] ⚠️ FIXING corrupt cached cast data');
              cachedData.cast = null;
              cachedData.main_cast = null;
              // Don't return yet - let it re-save the fixed data below
            } else {
              // Good cache, return it
              return cachedData;
            }
          } else {
            // No cast or cast is already null, cache is fine
            return cachedData;
          }
        } else {
          console.log(`[getPartnershipForProject] ⚠️ Cache STALE for: "${projectName}" (age: ${Math.round(cacheAge / 60000)}min) - refetching`);
        }
      } else {
        console.log(`[getPartnershipForProject] ❌ Cache MISS for: "${projectName}"`);
      }
    } catch (e) {
      console.error('[getPartnershipForProject] ⚠️ KV cache check failed:', e.message);
    }
    // --- End cache check ---
    
    // Acquire rate limit token first
    await hubspotLimiter.acquire();
    
    console.log(`\n--- LIVE HUBSPOT SEARCH ---`);
    console.log(`Strategy: Multi-approach search with scoring`);
    
    try {
      let allResults = [];
      
      // STRATEGY 0: Exact match with EQ operator (fastest, most reliable)
      console.log(`\n[Strategy 0] EXACT MATCH search for: "${projectName}"`);
      let results0 = await this.searchProductions({
        filterGroups: [{
          filters: [{
            propertyName: 'partnership_name',
            operator: 'EQ',
            value: projectName
          }]
        }],
        limit: 5
      });
      console.log(`  → Found ${results0?.results?.length || 0} results`);
      if (results0?.results?.length) {
        results0.results.forEach(r => {
          console.log(`    - "${r.properties.partnership_name}" (ID: ${r.id})`);
        });
        allResults.push(...results0.results);
      }
      
      // STRATEGY 1: CONTAINS_TOKEN match (if no exact match)
      if (!allResults.length) {
        console.log(`\n[Strategy 1] CONTAINS_TOKEN search for: "${projectName}"`);
        let results1 = await this.searchProductions({
          filterGroups: [{
            filters: [{
              propertyName: 'partnership_name',
              operator: 'CONTAINS_TOKEN',
              value: projectName
            }]
          }],
          limit: 10
        });
        console.log(`  → Found ${results1?.results?.length || 0} results`);
        if (results1?.results?.length) {
          results1.results.forEach(r => {
            console.log(`    - "${r.properties.partnership_name}" (ID: ${r.id})`);
          });
          allResults.push(...results1.results);
        }
      }
      
      // STRATEGY 2: If no exact match and has spaces, try word-by-word OR search (IMPROVED)
      if (!allResults.length && projectName.includes(' ')) {
        // Extract ALL significant words (length >= 2, not common stopwords)
        const allWords = projectName.split(' ');
        console.log(`\n[Strategy 2] DEBUG: All words from split: [${allWords.join(', ')}]`);
        
        const words = allWords.filter(word => 
          word.length >= 2 && !['the', 'and', 'for', 'with', 'of'].includes(word.toLowerCase())
        );
        
        console.log(`[Strategy 2] DEBUG: After filtering (length>=2, no stopwords): [${words.join(', ')}]`);
        
        if (words.length > 0) {
          console.log(`[Strategy 2] Word-by-word OR search for ALL significant words: [${words.join(', ')}]`);
          const filterGroups = words.map(word => ({
            filters: [{
              propertyName: 'partnership_name',
              operator: 'CONTAINS_TOKEN',
              value: word
            }]
          }));
          
          console.log(`[Strategy 2] DEBUG: Created ${filterGroups.length} filter groups`);
          console.log(`[Strategy 2] DEBUG: Filter groups structure:`, JSON.stringify(filterGroups, null, 2));
          
          let results2 = await this.searchProductions({
            filterGroups,
            limit: 30 // Increased to catch more matches
          });
          console.log(`  → Found ${results2?.results?.length || 0} results`);
          if (results2?.results?.length) {
            results2.results.forEach(r => {
              if (!allResults.find(ar => ar.id === r.id)) {
                console.log(`    - "${r.properties.partnership_name}" (ID: ${r.id})`);
                allResults.push(r);
              }
            });
          }
        }
      }
      
      // STRATEGY 3: Fallback - get recent partnerships and filter client-side
      if (!allResults.length) {
        console.log(`\n[Strategy 3] Broad search + client-side filtering`);
        let results3 = await this.searchProductions({
          limit: 100, // Increased from 50 to get more candidates
          sorts: [{
            propertyName: 'hs_lastmodifieddate',
            direction: 'DESCENDING'
          }]
        });
        
        console.log(`\n[Strategy 3 DEBUG] Raw HubSpot results:`);
        if (results3?.results?.length) {
          console.log(`  Total partnerships returned: ${results3.results.length}`);
          console.log(`  First 10 partnership names:`);
          results3.results.slice(0, 10).forEach((r, idx) => {
            console.log(`    ${idx + 1}. "${r.properties.partnership_name}" (ID: ${r.id})`);
          });
          
          // Client-side filtering with detailed logging
          const projectLower = projectName.toLowerCase();
          console.log(`\n  Filtering for matches with: "${projectLower}"`);
          
          const filtered = results3.results.filter(r => {
            const prodName = (r.properties.partnership_name || '').toLowerCase();
            const matches = prodName.includes(projectLower) || projectLower.includes(prodName);
            
            if (matches) {
              console.log(`    ✅ MATCH: "${r.properties.partnership_name}" contains "${projectName}"`);
            }
            
            return matches;
          });
          
          console.log(`  → Found ${results3.results.length} total, ${filtered.length} matched "${projectName}"`);
          
          if (filtered.length) {
            filtered.forEach(r => {
              console.log(`    - "${r.properties.partnership_name}" (ID: ${r.id})`);
            });
            allResults.push(...filtered);
          } else {
            console.log(`  ⚠️ No matches found in client-side filtering`);
            console.log(`  🔍 Trying fuzzy matching on individual words...`);
            
            // Try fuzzy word matching as last resort
            const projectWords = projectLower.split(/\s+/).filter(w => w.length > 2);
            const fuzzyFiltered = results3.results.filter(r => {
              const prodName = (r.properties.partnership_name || '').toLowerCase();
              const matchCount = projectWords.filter(word => prodName.includes(word)).length;
              const matchRatio = matchCount / projectWords.length;
              
              if (matchRatio >= 0.5) { // At least 50% of words match
                console.log(`    🔍 Fuzzy match (${Math.round(matchRatio * 100)}%): "${r.properties.partnership_name}"`);
                return true;
              }
              return false;
            });
            
            if (fuzzyFiltered.length) {
              console.log(`  → Fuzzy matching found ${fuzzyFiltered.length} candidates`);
              allResults.push(...fuzzyFiltered);
            }
          }
        } else {
          console.log(`  ⚠️ Broad search returned NO results at all!`);
        }
      }
      
      console.log(`\n--- SCORING RESULTS ---`);
      console.log(`Total candidates: ${allResults.length}`);
      
      if (allResults.length > 0) {
        // Score each result based on similarity
        const projectLower = projectName.toLowerCase();
        const projectWords = projectLower.split(/\s+/).filter(w => w.length > 0);
        
        const scoredResults = allResults.map(r => {
          const prodName = r.properties.partnership_name?.toLowerCase() || '';
          const prodWords = prodName.split(/\s+/).filter(w => w.length > 0);
          let score = 0;
          let reasons = [];
          
          // Exact match gets highest score
          if (prodName === projectLower) {
            score = 100;
            reasons.push('exact match');
          } else {
            // Count matching words
            let matchedWords = 0;
            projectWords.forEach(word => {
              if (prodWords.includes(word)) {
                score += 10;
                matchedWords++;
              } else if (prodName.includes(word)) {
                score += 5;
                matchedWords++;
              }
            });
            
            if (matchedWords > 0) {
              reasons.push(`${matchedWords}/${projectWords.length} words matched`);
            }
            
            // Bonus if starts with same word
            if (projectWords[0] && prodWords[0] === projectWords[0]) {
              score += 20;
              reasons.push('same first word');
            }
            
            // Bonus for similar length (avoids matching very short or long names)
            const lengthDiff = Math.abs(prodWords.length - projectWords.length);
            if (lengthDiff <= 1) {
              score += 10;
              reasons.push('similar length');
            }
          }
          
          console.log(`  "${r.properties.partnership_name}" → Score: ${score} (${reasons.join(', ')})`);
          return { ...r, score, reasons };
        });
        
        // Sort by score and get best match
        scoredResults.sort((a, b) => b.score - a.score);
        const partnership = scoredResults[0];
        
        console.log(`\n--- BEST MATCH ---`);
        console.log(`  Name: "${partnership.properties.partnership_name}"`);
        console.log(`  Score: ${partnership.score}`);
        console.log(`  Reasons: ${partnership.reasons.join(', ')}`);
        
        if (partnership && partnership.score > 0) {
          const props = partnership.properties;
          console.log('[getPartnershipForProject] Found partnership data (score:', partnership.score, '):', props.partnership_name);
          
          // DEBUG: Log ALL relevant fields to find where the corrupt data is
          console.log('[getPartnershipForProject] DEBUG - ALL FIELDS:');
          console.log('  synopsis:', props.synopsis?.substring(0, 200));
          console.log('  main_cast:', props.main_cast?.substring(0, 200));
          console.log('  cast:', props.cast?.substring(0, 200));
          console.log('  stars:', props.stars?.substring(0, 200));
          console.log('  talent:', props.talent?.substring(0, 200));
          console.log('  logline:', props.logline?.substring(0, 200));
          console.log('  description:', props.description?.substring(0, 200));
          
          // Normalize the project name to handle placeholders
          const cleanedProjectName = normalizeProjectName(props.partnership_name);
          
          const partnershipResult = {
            // CRITICAL: Include the actual project name!
            title: cleanedProjectName || null,
            partnership_name: cleanedProjectName || null,
            name: cleanedProjectName || null,
            distributor: props.distributor || null,
            studio: props.distributor || null,
            // Release date fields
            releaseDate: props.release_est_date || props.release__est__date || null,
            release_date: props.release_est_date || props.release__est__date || null,
            release_est_date: props.release_est_date || null,
            release__est__date: props.release__est__date || null,
            // Production start date fields
            startDate: props.production_start_date || props.start_date || null,
            start_date: props.production_start_date || props.start_date || null,
            productionStartDate: props.production_start_date || props.start_date || null,
            production_start_date: props.production_start_date || null,
            // Production stage
            productionStage: props.production_stage || null,
            production_stage: props.production_stage || null,
            // Other production dates
            est__shooting_end_date: props.est__shooting_end_date || null,
            estimatedShootingEndDate: props.est__shooting_end_date || null,
            production_end_date: props.production_end_date || null,
            productionEndDate: props.production_end_date || null,
            // Production details
            productionType: props.production_type || null,
            production_type: props.production_type || null,
            synopsis: props.synopsis || null,
            content_type: props.content_type || null,
            partnership_status: props.partnership_status || null,
            brand_name: props.brand_name || null,
            amount: props.amount || null,
            hollywood_branded_fee: props.hollywood_branded_fee || null,
            hs_lastmodifieddate: props.hs_lastmodifieddate || null,
            partnershipId: partnership.id,
            // Contextual fields
            genre: props.genre_production || props.vibe || null,
            genre_production: props.genre_production || props.vibe || null,
            vibe: props.vibe || props.genre_production || null,
            // Location - handled exactly like synopsis
            location: props.shoot_location__city_ || null,
            shoot_location__city_: props.shoot_location__city_ || null,
            // Other contextual fields
            timePeriod: props.time_period || null,
            time_period: props.time_period || null,
            plotLocation: props.plot_location || null,
            plot_location: props.plot_location || null,
            storylineCity: props.storyline_location__city_ || null,
            storyline_location__city_: props.storyline_location__city_ || null,
            audienceSegment: props.audience_segment || null,
            audience_segment: props.audience_segment || null,
            // Cast information - Handle exactly like other fields
            cast: props.main_cast || null,
            main_cast: props.main_cast || null,
            // Rating information
            rating: props.movie_rating || props.tv_ratings || props.rating || null,
            movie_rating: props.movie_rating || null,
            tv_ratings: props.tv_ratings || null,
            // Partnership setting
            partnership_setting: props.partnership_setting || null,
            setting: props.partnership_setting || props.setting || null
          };
          
          // --- Save to cache with timestamp (3 hour TTL) ---
          try {
            const cacheData = {
              ...partnershipResult,
              cachedAt: new Date().toISOString()
            };
            await kv.set(cacheKey, cacheData, { ex: 10800 }); // 3 hours
            console.log(`\n[getPartnershipForProject] ✅ Saved to cache: "${cacheKey}" (3hr TTL)`);
          } catch (e) {
            console.error('[getPartnershipForProject] ⚠️ KV cache set failed:', e.message);
          }
          console.log(`========================================\n`);
          // --- End cache save ---
          
          return partnershipResult;
        }
      }
    } catch (error) {
      console.error('[getPartnershipForProject] error:', error);
    }
    
    console.log('[getPartnershipForProject] No partnership data found for:', projectName);
    return null;
  },

  async searchDeals(filters = {}) {
    // Acquire rate limit token first
    await hubspotLimiter.acquire();
    
    // Ensure initialization
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    try {
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.DEALS}/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filterGroups: filters.filterGroups || [{
            filters: []
          }],
          properties: [
            'dealname',
            'amount',
            'closedate',
            'dealstage',
            'pipeline',
            'dealtype',
            'hubspot_owner_id',
            'hs_lastmodifieddate'
          ],
          limit: filters.limit || 30,
          sorts: [{
            propertyName: 'hs_lastmodifieddate',
            direction: 'DESCENDING'
          }]
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HubSpot API error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      return {
        results: []
      };
    }
  },

  async getContactsForBrand(brandId) {
    // Ensure initialization
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    try {
      const response = await fetch(
        `${this.baseUrl}/crm/v3/objects/${this.OBJECTS.BRANDS}/${brandId}/associations/${this.OBJECTS.CONTACTS}`, {
          headers: {
            'Authorization': `Bearer ${hubspotApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        return [];
      }

      const associations = await response.json();

      if (associations.results && associations.results.length > 0) {
        const contactIds = associations.results.slice(0, 3).map(r => r.id);
        const batchResponse = await fetch(`${this.baseUrl}/crm/v3/objects/contacts/batch/read`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hubspotApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            inputs: contactIds.map(id => ({
              id
            })),
            properties: ['firstname', 'lastname', 'email', 'jobtitle']
          })
        });

        if (batchResponse.ok) {
          const contactData = await batchResponse.json();
          return contactData.results || [];
        }
      }

      return [];
    } catch (error) {
      return [];
    }
  },

  async searchSpecificBrand(brandName) {
    // Acquire rate limit token first
    await hubspotLimiter.acquire();
    
    // Ensure initialization
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    try {
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.BRANDS}/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: brandName,
          properties: [
            'brand_name',
            'client_status',
            'client_type',
            'brand_website_url',
            'num_associated_contacts',
            'partner_agency_name',
            'hubspot_owner_id',
            'domain',
            'phone'
          ],
          limit: 5
        })
      });

      if (!response.ok) {
        throw new Error(`HubSpot API error: ${response.status}`);
      }

      const data = await response.json();

      const exactMatch = data.results?.find(r =>
        r.properties.brand_name?.toLowerCase() === brandName.toLowerCase()
      );

      return exactMatch || data.results?.[0] || null;
    } catch (error) {
      return null;
    }
  },

  async testConnection() {
    try {
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.BRANDS}?limit=1`, {
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('[DEBUG testConnection] Failed:', response.status, errorBody);
        return false;
      }

      console.log('[DEBUG testConnection] Connection successful');
      return true;
    } catch (error) {
      console.error('[DEBUG testConnection] Error:', error.message);
      return false;
    }
  },

  async listAssociations({ objectType, objectId, toObjectType }) {
    await hubspotLimiter.acquire();
    const url = `${this.baseUrl}/crm/v3/objects/${objectType}/${objectId}/associations/${toObjectType}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${hubspotApiKey}` }
    });
    if (!response.ok) return { results: [] };
    return response.json();
  },

  async batchReadContacts(contactIds) {
    if (!contactIds || contactIds.length === 0) return { results: [] };
    await hubspotLimiter.acquire();
    const url = `${this.baseUrl}/crm/v3/objects/contacts/batch/read`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hubspotApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: contactIds.map(id => ({ id })),
        properties: ['email', 'firstname', 'lastname', 'jobtitle']
      })
    });
    if (!response.ok) return { results: [] };
    return response.json();
  }
};

export default hubspotAPI;
