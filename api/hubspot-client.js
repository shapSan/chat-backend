import fetch from 'node-fetch';

export const hubspotApiKey = process.env.HUBSPOT_API_KEY;

const hubspotAPI = {
  baseUrl: 'https://api.hubapi.com',
  portalId: '2944980',

  OBJECTS: {
    BRANDS: '2-26628489',
    PARTNERSHIPS: '2-27025032',
    DEALS: 'deals',
    COMPANIES: 'companies',
    CONTACTS: 'contacts'
  },

  async searchBrands(filters = {}) {
    console.log('[DEBUG searchBrands] Starting with filters:', filters);
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
          'hs_lastmodifieddate'
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
        searchBody.query = filters.query;
        searchBody.filterGroups = [{
          filters: [{
            propertyName: 'client_status',
            operator: 'IN',
            values: ['Active', 'In Negotiation', 'Contract', 'Pending']
          }]
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
        console.error('[DEBUG searchBrands] HubSpot API error:', response.status, errorBody);
        throw new Error(`HubSpot API error: ${response.status} - ${errorBody}`);
      }

      const result = await response.json();
      console.log('[DEBUG searchBrands] Success, got', result.results?.length || 0, 'brands');

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
      console.error("[DEBUG searchBrands] Error:", error);
      console.error("[DEBUG searchBrands] Stack trace:", error.stack);
      return {
        results: []
      };
    }
  },

  async searchProductions(filters = {}) {
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

  async searchDeals(filters = {}) {
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
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }
};

export default hubspotAPI;
