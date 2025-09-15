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
      "freelancer_board_url",
      "freelancer_dashboard",
      "growth_partner_invite_link",
      "hs_lastmodifieddate",
      "contact_type"
    ];

    // Search for Growth Partners by newsletter subscription
    const searchResults = await searchHubSpotContacts(
      [{
        filters: [
          {
            propertyName: "blog_growth_partner_newsletter_195515316647_subscription",
            operator: "EQ",
            value: "true"  // Subscribed to Growth Partner Newsletter
          }
        ]
      }],
      properties,
      100
    );

    // Transform the results to our format
    const partners = searchResults.results?.map(contact => ({
      id: contact.id,
      firstname: contact.properties?.firstname || null,
      lastname: contact.properties?.lastname || null,
      email: contact.properties?.email || null,
      company: contact.properties?.company || null,
      freelancer_board_url: contact.properties?.freelancer_board_url || null,
      freelancer_dashboard: contact.properties?.freelancer_dashboard || null,
      growth_partner_invite_link: contact.properties?.growth_partner_invite_link || null,
      lastModified: contact.properties?.hs_lastmodifieddate || null,
      contactType: contact.properties?.contact_type || null
    })) || [];

    // Also try searching by contact_type if it exists
    let additionalPartners = [];
    try {
      const typeSearchResults = await searchHubSpotContacts(
        [{
          filters: [
            {
              propertyName: "contact_type",
              operator: "EQ", 
              value: "Growth Partner"
            }
          ]
        }],
        properties,
        100
      );

      additionalPartners = typeSearchResults.results?.map(contact => ({
        id: contact.id,
        firstname: contact.properties?.firstname || null,
        lastname: contact.properties?.lastname || null,
        email: contact.properties?.email || null,
        company: contact.properties?.company || null,
        freelancer_board_url: contact.properties?.freelancer_board_url || null,
        freelancer_dashboard: contact.properties?.freelancer_dashboard || null,
        growth_partner_invite_link: contact.properties?.growth_partner_invite_link || null,
        lastModified: contact.properties?.hs_lastmodifieddate || null,
        contactType: contact.properties?.contact_type || null
      })) || [];
    } catch (e) {
      console.log('[cacheGrowthPartners] Could not search by contact_type:', e.message);
    }

    // Merge and deduplicate partners
    const allPartners = [...partners];
    const existingIds = new Set(partners.map(p => p.id));
    
    for (const partner of additionalPartners) {
      if (!existingIds.has(partner.id)) {
        allPartners.push(partner);
      }
    }

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
