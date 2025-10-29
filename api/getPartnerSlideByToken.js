// api/getPartnerSlideByToken.js - Get partner radar by token or partnerId
import { kv } from '@vercel/kv';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
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
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers }
    );
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const partnerId = url.searchParams.get('partnerId');

  try {
    // Case 1: Fetch by token (get full slide data with images)
    if (token) {
      const slideData = await kv.get(`slide:${token}`);
      
      if (!slideData) {
        return new Response(
          JSON.stringify({ 
            success: false,
            error: 'Slide not found' 
          }),
          { status: 404, headers }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          token: slideData.token,
          slides: slideData.slides || [],
          brandData: slideData.brandData,
          partnershipData: slideData.partnershipData,
          templateId: slideData.templateId,
          projectName: slideData.projectName,
          brandName: slideData.brandName,
          createdAt: slideData.createdAt,
          updatedAt: slideData.updatedAt,
        }),
        { status: 200, headers }
      );
    }

    // Case 2: Check if partner has a radar (get token only)
    if (partnerId) {
      const radarToken = await kv.get(`partner-radar-token:${partnerId}`);
      
      if (!radarToken) {
        return new Response(
          JSON.stringify({ 
            success: true,
            hasRadar: false,
            message: 'No radar found for this partner'
          }),
          { status: 200, headers }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          hasRadar: true,
          token: radarToken,
        }),
        { status: 200, headers }
      );
    }

    return new Response(
      JSON.stringify({ 
        error: 'Either token or partnerId is required' 
      }),
      { status: 400, headers }
    );
  } catch (error) {
    console.error('[getPartnerSlideByToken] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to fetch slide data',
        details: error.message 
      }),
      { status: 500, headers }
    );
  }
}
