// api/getGrowthPartners.js
import { kv } from '@vercel/kv';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // CORS
  const origin = req.headers.get('origin');
  const headers = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers,
    });
  }

  try {
    // Retrieve cached growth partners from KV
    const cachedData = await kv.get('growth-partners-cache');
    
    if (!cachedData) {
      console.log('[getGrowthPartners] No cached data found');
      return new Response(
        JSON.stringify({ 
          partners: [],
          message: 'No cached data found. Please rebuild cache.' 
        }),
        { status: 200, headers }
      );
    }

    console.log(`[getGrowthPartners] Retrieved ${cachedData.partners?.length || 0} growth partners from cache`);
    
    return new Response(
      JSON.stringify({
        partners: cachedData.partners || [],
        lastUpdated: cachedData.timestamp || null,
        count: cachedData.partners?.length || 0
      }),
      { status: 200, headers }
    );
  } catch (error) {
    console.error('[getGrowthPartners] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to retrieve growth partners',
        details: error.message 
      }),
      { status: 500, headers }
    );
  }
}
