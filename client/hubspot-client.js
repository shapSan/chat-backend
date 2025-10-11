//client/hubspot-client.js

import fetch from 'node-fetch';
import { kv } from '@vercel/kv';

export const hubspotApiKey = process.env.HUBSPOT_API_KEY;

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
          // Clone the response to avoid "body used already" error
          const responseClone = response.clone();
          const errorBody = await response.text();
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
          // Rating fields
          'movie_rating',          // MPAA movie ratings (G, PG, PG-13, R, NC-17)
          'tv_ratings',            // TV ratings (TV-G, TV-PG, TV-14, TV-MA)
          'sub_ratings_for_tv_content', // TV sub-ratings (D, L, S, V)
          'rating',                // Generic rating field fallback
          // Add contextual fields for better matching:
          'genre_production',      // Genre of the production
          'time_period',           // Era/time period setting
          'plot_location',         // Where the story takes place
          'storyline_location__city_',  // Specific city location
          'audience_segment'       // Target audience
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
      
      console.log('[DEBUG searchProductions] Making request with body:', JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.PARTNERSHIPS}/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
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

  async getPartnershipForProject(projectName) {
    if (!projectName) return null;
    
    // --- Cache check first ---
    const cleanProjectName = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 100);
    const cacheKey = `partnership-data:${cleanProjectName}`;
    
    try {
      const cachedData = await kv.get(cacheKey);
      if (cachedData) {
        console.log(`[getPartnershipForProject] Cache HIT for: "${projectName}"`);
        return cachedData;
      }
      console.log(`[getPartnershipForProject] Cache MISS for: "${projectName}"`);
    } catch (e) {
      console.error('[getPartnershipForProject] KV cache check failed:', e.message);
    }
    // --- End cache check ---
    
    // Acquire rate limit token first
    await hubspotLimiter.acquire();
    
    console.log('[getPartnershipForProject] Searching for:', projectName);
    
    try {
      // First try with CONTAINS_TOKEN for partial matching
      let results = await this.searchProductions({
        filterGroups: [{
          filters: [{
            propertyName: 'partnership_name',
            operator: 'CONTAINS_TOKEN',
            value: projectName
          }]
        }],
        limit: 10  // Get more results for better matching
      });
      
      // If no results, try a more relaxed search with just the main words
      if (!results?.results?.length && projectName.includes(' ')) {
        const mainWords = projectName.split(' ').filter(word => 
          word.length > 3 && !['the', 'and', 'for', 'with'].includes(word.toLowerCase())
        );
        
        if (mainWords.length > 0) {
          console.log('[getPartnershipForProject] Trying with main words:', mainWords);
          
          // Search for any of the main words
          const filterGroups = mainWords.map(word => ({
            filters: [{
              propertyName: 'partnership_name',
              operator: 'CONTAINS_TOKEN',
              value: word
            }]
          }));
          
          results = await this.searchProductions({
            filterGroups,
            limit: 20
          });
        }
      }
      
      if (results?.results?.length > 0) {
        // Score each result based on similarity
        const projectLower = projectName.toLowerCase();
        const scoredResults = results.results.map(r => {
          const prodName = r.properties.partnership_name?.toLowerCase() || '';
          let score = 0;
          
          // Exact match gets highest score
          if (prodName === projectLower) {
            score = 100;
          } else {
            // Count matching words
            const projectWords = projectLower.split(/\s+/);
            const prodWords = prodName.split(/\s+/);
            
            projectWords.forEach(word => {
              if (prodWords.includes(word)) score += 10;
              else if (prodName.includes(word)) score += 5;
            });
            
            // Bonus if starts with same word
            if (projectWords[0] && prodWords[0] === projectWords[0]) {
              score += 20;
            }
          }
          
          return { ...r, score };
        });
        
        // Sort by score and get best match
        scoredResults.sort((a, b) => b.score - a.score);
        const partnership = scoredResults[0];
        
        if (partnership && partnership.score > 0) {
          const props = partnership.properties;
          console.log('[getPartnershipForProject] Found partnership data (score:', partnership.score, '):', props.partnership_name);
          
          const partnershipResult = {
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
            genre: props.genre_production || null,
            genre_production: props.genre_production || null,
            timePeriod: props.time_period || null,
            time_period: props.time_period || null,
            plotLocation: props.plot_location || null,
            plot_location: props.plot_location || null,
            storylineCity: props.storyline_location__city_ || null,
            storyline_location__city_: props.storyline_location__city_ || null,
            audienceSegment: props.audience_segment || null,
            audience_segment: props.audience_segment || null
          };
          
          // --- Save to cache (1 hour TTL) ---
          try {
            await kv.set(cacheKey, partnershipResult, { ex: 3600 });
            console.log(`[getPartnershipForProject] Saved to cache: "${cacheKey}"`);
          } catch (e) {
            console.error('[getPartnershipForProject] KV cache set failed:', e.message);
          }
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
