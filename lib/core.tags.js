// lib/core.tags.js (clean split)
import fetch from 'node-fetch';
import hubspotAPI from '../client/hubspot-client.js';
import { firefliesApiKey } from '../client/fireflies-client.js';
import {
  MODELS,
  openAIApiKey,
  anthropicApiKey,
} from './config.js';

export function normalizePartnership(src = {}

export async function narrowWithIntelligentTags(
  hubspotBrands,
  firefliesTranscripts,
  emails,
  userMessage
) {
  if (!hubspotBrands || hubspotBrands.length === 0) {
    return { topBrands: [], taggedBrands: [] };
  }
  if (!anthropicApiKey) {
    return { topBrands: hubspotBrands.slice(0, 15), taggedBrands: [] };
  }

  try {
    const brandsForAI = hubspotBrands.map((b) => {
      const brandData = {
        id: b.id,
        name: b.properties.brand_name || 'Unknown',
        category: b.properties.main_category || 'General',
        subcategories: b.properties.product_sub_category__multi_ || '',
        partnershipCount: parseInt(b.properties.partnership_count || 0),
        dealsCount: parseInt(b.properties.deals_count || 0),
        clientStatus: b.properties.client_status || '',
        clientType: b.properties.client_type || '',
        helper_tags: [],
      };
      if (brandData.clientStatus === 'Active' || brandData.clientStatus === 'Contract') {
        brandData.helper_tags.push('Active Client');
      }
      if (brandData.clientType === 'Retainer') {
        brandData.helper_tags.push('Retainer Client (Premium)');
      }
      if (brandData.partnershipCount >= 10) {
        brandData.helper_tags.push(`Proven Partner (${brandData.partnershipCount} partnerships)`);
      }
      if (brandData.dealsCount >= 5) {
        brandData.helper_tags.push(`High Activity (${brandData.dealsCount} deals)`);
      }
      return brandData;
    });

    const systemPrompt =
      'Return ONLY valid JSON: {"results": [{"id":"<input id>","relevanceScore":0-100,"tags":["..."],"reason":"..."}...]}';

    let truncated = userMessage.length > 500 ? userMessage.slice(0, 500) + '...' : userMessage;
    truncated = truncated.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

    const brandsForAISafe = JSON.stringify(brandsForAI, (k, v) => {
      if (typeof v === 'string') {
        return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      }
      return v;
    });

    const userPrompt = `Production/Request: "${truncated}"\n\nBrand List:\n\`\`\`json\n${brandsForAISafe}\n\`\`\``;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELS.anthropic.claude,
        max_tokens: 1000,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: `${systemPrompt}\n\n${userPrompt}\n\nIMPORTANT: Return ONLY brands from the input list.`,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      if (openAIApiKey) {
        return narrowWithIntelligentTagsOpenAI(hubspotBrands, firefliesTranscripts, emails, userMessage);
      }
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const rawContent = data.content?.[0]?.text || '{}';
    const rankedData = extractJson(rawContent) || { results: [] };
    const rankedResults = rankedData.results || [];

    const inputBrandIds = new Set(brandsForAI.map((b) => b.id));
    const validResults = rankedResults.filter((r) => inputBrandIds.has(r.id));

    const taggedBrands = validResults
      .map((r) => {
        const originalBrand = hubspotBrands.find((b) => b.id === r.id);
        if (!originalBrand) return null;
        return {
          source: 'hubspot',
          id: originalBrand.id,
          name: originalBrand.properties.brand_name || '',
          category: originalBrand.properties.main_category || 'General',
          subcategories: originalBrand.properties.product_sub_category__multi_ || '',
          clientStatus: originalBrand.properties.client_status || '',
          clientType: originalBrand.properties.client_type || '',
          partnershipCount: originalBrand.properties.partnership_count || '0',
          dealsCount: originalBrand.properties.deals_count || '0',
          lastActivity: originalBrand.properties.hs_lastmodifieddate,
          hubspotUrl: `https://app.hubspot.com/contacts/${
            hubspotAPI?.portalId || process.env.HUBSPOT_PORTAL_ID || '0'
          }/company/${originalBrand.id}`,
          relevanceScore: r.relevanceScore,
          tags: r.tags,
          reason: r.reason,
        };
      })
      .filter(Boolean);

    const topBrands = taggedBrands.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return { topBrands, taggedBrands };
  } catch (error) {
    console.error('[narrowWithIntelligentTags] error:', error?.message);
    return { topBrands: hubspotBrands.slice(0, 15), taggedBrands: [] };
  }
}




/* ========================================================================
 * COMMUNICATIONS-FIRST BRAND DISCOVERY ENGINE
 * ====================================================================== */

/**
 * New orchestrator that searches communications first, then extracts brands
 */
// INSIDE core.js


async function runBrandSearchOrchestrator(intent, { add, knownProjectName, userMessage, mcpThinking, conversationContext }) {
  
  let projectName = knownProjectName;
  let extractedData = {};
  
  // STEP 1: FIXED AI EXTRACTION - Now asks for all fields
  if (openAIApiKey) {
    try {
      const extractionPrompt = `Analyze the following text. Extract the primary title, a brief synopsis, distributor, production start date, release date, location, and a list of key cast members. Use null for any missing fields.

**Text:**
\`\`\`
${userMessage}
\`\`\`

**JSON Output:**
\`\`\`json
{
  "title": "...",
  "synopsis": "...",
  "distributor": "...",
  "startDate": "...",
  "releaseDate": "...",
  "location": "...",
  "cast": ["...", "..."]
}
\`\`\``;
      
      const extractResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
        body: JSON.stringify({
          model: MODELS.openai.chatMini,
          messages: [
            { role: 'system', content: 'You are a data extraction assistant. Return ONLY valid JSON.' },
            { role: 'user', content: extractionPrompt }
          ],
          temperature: 0.1,
          max_tokens: 400
        })
      });
      
      if (extractResponse.ok) {
        const extractResult = await extractResponse.json();
        const extracted = extractJson(extractResult.choices?.[0]?.message?.content);
        if (extracted) {
          extractedData = extracted;
          if (extracted.title && !projectName) {
            projectName = extracted.title;
          }
          add({ type: 'info', text: `🎬 Analyzing project: "${projectName}
