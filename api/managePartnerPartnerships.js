// api/managePartnerPartnerships.js - Manage partnerships linked to growth partners
import { kv } from '@vercel/kv';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const origin = req.headers.get('origin');
  const headers = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  const url = new URL(req.url);
  const partnerId = url.searchParams.get('partnerId');

  if (!partnerId) {
    return new Response(
      JSON.stringify({ error: 'partnerId is required' }),
      { status: 400, headers }
    );
  }

  try {
    if (req.method === 'GET') {
      // Fetch saved partnerships for this partner
      const saved = await kv.get(`partner-partnerships:${partnerId}`);
      return new Response(
        JSON.stringify({
          success: true,
          partnershipIds: saved || [],
        }),
        { status: 200, headers }
      );
    }

    if (req.method === 'POST') {
      // Save partnerships for this partner
      const body = await req.json();
      const { partnershipIds } = body;

      if (!Array.isArray(partnershipIds)) {
        return new Response(
          JSON.stringify({ error: 'partnershipIds must be an array' }),
          { status: 400, headers }
        );
      }

      await kv.set(`partner-partnerships:${partnerId}`, partnershipIds);

      console.log(`[managePartnerPartnerships] Saved ${partnershipIds.length} partnerships for partner ${partnerId}`);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Partnerships saved successfully',
          partnershipIds,
        }),
        { status: 200, headers }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers }
    );
  } catch (error) {
    console.error('[managePartnerPartnerships] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to manage partnerships',
        details: error.message 
      }),
      { status: 500, headers }
    );
  }
}
