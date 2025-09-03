//client/hubspot-client.js

import fetch from 'node-fetch';

export const hubspotApiKey = process.env.HUBSPOT_API_KEY;

const hubspotAPI = {
  baseUrl: 'https://api.hubapi.com',
  portalId: '2944980',
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
    console.log('[DEBUG searchBrands] Starting with filters:', filters);
    
    // Ensure we're initialized before searching
    if (!this.isInitialized) {
      console.log('[DEBUG searchBrands] Not initialized, initializing now...');
      await this.initialize();
      // Add a small delay after initialization to ensure everything is ready
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    try {
      let searchBody = {
        properties: [
          'id',
          'brand_name',
          'client_status',
          'client_type',
          'main_category',
          'product_sub_category__multi_',
          'partnership_count',
          'deals_count',
          'target_gender_',
          'target_geography',
          'hs_lastmodifieddate',
          'one_sheet_link',  // Brand one-sheet document
          'secondary_owner',  // User ID for later resolution
          'specialty_lead'    // User ID for later resolution
        ],
        limit: filters.limit || 50,
        sorts: [{
          propertyName: 'partnership_count',
          direction: 'DESCENDING'
        }]
      };

      // If a query (like a synopsis) is passed, use category matching
      if (filters.query && filters.query.length > 50) {
        console.log('[DEBUG searchBrands] Detected synopsis, extracting genre...');

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
        const queryLower = filters.query.toLowerCase();
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
        // Short keyword search - search by brand name
        console.log('[DEBUG searchBrands] Keyword search for:', filters.query);
        
        // For keyword searches, we'll try a more flexible approach
        // Remove the status filter initially to ensure we get results
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
        // Default: Get low hanging fruit - active brands with high activity
        searchBody.filterGroups = [{
          filters: [{
            propertyName: 'client_status',
            operator: 'IN',
            values: ['Active', 'Contract']
          }, {
            propertyName: 'partnership_count',
            operator: 'GTE',
            value: '5'
          }]
        }];

        // Sort by deals count for commercial opportunities
        searchBody.sorts = [{
          propertyName: 'deals_count',
          direction: 'DESCENDING'
        }];
      }

      console.log('[DEBUG searchBrands] Making HubSpot API request...');
      
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
            const errorBody = await response.text();
            console.error(`[DEBUG searchBrands] HubSpot API error (attempt ${attempts}/${maxAttempts}):`, response.status, errorBody);
            lastError = new Error(`HubSpot API error: ${response.status} - ${errorBody}`);
            
            // If it's a 401, don't retry
            if (response.status === 401) {
              throw lastError;
            }
            
            // Wait before retry
            if (attempts < maxAttempts) {
              console.log('[DEBUG searchBrands] Retrying after delay...');
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            }
          }

          const result = await response.json();
          console.log(`[DEBUG searchBrands] Success (attempt ${attempts}), got`, result.results?.length || 0, 'brands');
          
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
    // Ensure initialization
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    try {
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/${this.OBJECTS.PARTNERSHIPS}/search`, {
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
            'partnership_name',
            'production_name',
            'partnership_status',
            'hs_pipeline_stage',
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
            'release__est__date',    // Release date
            'start_date',            // Production start date
            'production_type'        // Type of production
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

  async getPartnershipForProject(projectName) {
    // Search for partnership data related to the project
    if (!projectName) return null;
    
    console.log('[getPartnershipForProject] Searching for:', projectName);
    
    try {
      const results = await this.searchProductions({
        filterGroups: [{
          filters: [{
            propertyName: 'production_name',
            operator: 'CONTAINS_TOKEN',
            value: projectName
          }]
        }],
        limit: 5  // Get more results in case the first isn't the best match
      });
      
      if (results?.results?.length > 0) {
        // Try to find exact match first
        let partnership = results.results.find(r => 
          r.properties.production_name?.toLowerCase() === projectName.toLowerCase()
        );
        
        // If no exact match, use the first result
        if (!partnership) {
          partnership = results.results[0];
        }
        
        const props = partnership.properties;
        console.log('[getPartnershipForProject] Found partnership data:', props);
        
        return {
          distributor: props.distributor || null,
          studio: props.distributor || null,  // Also provide as 'studio'
          releaseDate: props.release__est__date || null,
          release_date: props.release__est__date || null,  // Also snake_case
          startDate: props.start_date || null,
          production_start_date: props.start_date || null,  // Full name
          productionType: props.production_type || null,
          production_type: props.production_type || null,  // Snake case
          synopsis: props.synopsis || null,
          content_type: props.content_type || null,
          partnership_status: props.partnership_status || null,
          brand_name: props.brand_name || null,
          amount: props.amount || null,
          hollywood_branded_fee: props.hollywood_branded_fee || null
        };
      }
    } catch (error) {
      console.error('[getPartnershipForProject] error:', error);
    }
    
    console.log('[getPartnershipForProject] No partnership data found for:', projectName);
    return null;
  },

  async searchDeals(filters = {}) {
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
  }
};

export default hubspotAPI;
