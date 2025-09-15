// api/cacheGrowthPartners.js
import { kv } from '@vercel/kv';

export const config = {
  runtime: 'edge',
  maxDuration: 30, // Allow up to 30 seconds for this operation
};

// HubSpot API configuration
const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const HUBSPOT_BASE_URL = 'https://api.hubapi.com';

async function searchHubSpotContacts(filterGroups, properties, limit = 100) {
  const response = await fetch(`${HUBSPOT_BASE_URL}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups,
      properties,
      limit,
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }]
    }),
  });

  if (!response.ok) {
    throw new Error(`HubSpot API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

export default async function handler(req) {
  // CORS
  const origin = req.headers.get('origin');
  const headers = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers,
    });
  }

  try {
    console.log('[cacheGrowthPartners] Starting cache rebuild...');
    
    if (!HUBSPOT_API_KEY) {
      throw new Error('HUBSPOT_API_KEY environment variable is not configured');
    }
    
    const properties = [
      "firstname",
      "lastname", 
      "email",
      "company",
      "freelancer_board_id",
      "freelancer_board_url",
      "freelancer_dashboard",
      "contact_type"
    ];

    // Search for Freelance Salespersons (Growth Partners)
    console.log('[cacheGrowthPartners] Searching for Freelance Salesperson contacts...');
    
    const searchResults = await searchHubSpotContacts(
      [{
        filters: [
          {
            propertyName: "contact_type",
            operator: "EQ",
            value: "Freelance Salesperson"  // The correct value!
          }
        ]
      }],
      properties,
      100
    );

    // Transform the results to our format
    const allPartners = searchResults?.results?.map(contact => ({
      id: contact.id,
      firstname: contact.properties?.firstname || null,
      lastname: contact.properties?.lastname || null,
      email: contact.properties?.email || null,
      company: contact.properties?.company || null,
      freelancer_board_id: contact.properties?.freelancer_board_id || null,
      freelancer_board_url: contact.properties?.freelancer_board_url || null,
      freelancer_dashboard: contact.properties?.freelancer_dashboard || null,
      contactType: contact.properties?.contact_type || null
    })) || [];
    
    // Log what we're storing
    console.log(`[cacheGrowthPartners] Storing ${allPartners.length} partners in cache`);

    console.log(`[cacheGrowthPartners] Found ${allPartners.length} growth partners`);

    // Store in KV cache
    const cacheData = {
      partners: allPartners,
      timestamp: new Date().toISOString(),
      count: allPartners.length
    };

    await kv.set('growth-partners-cache', cacheData, {
      ex: 86400 // Cache for 24 hours
    });

    console.log('[cacheGrowthPartners] Cache rebuild complete');

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully cached ${allPartners.length} growth partners`,
        count: allPartners.length,
        timestamp: cacheData.timestamp
      }),
      { status: 200, headers }
    );
  } catch (error) {
    console.error('[cacheGrowthPartners] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to rebuild growth partners cache',
        details: error.message 
      }),
      { status: 500, headers }
    );
  }
}
