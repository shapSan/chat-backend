// lib/core.tags.js (clean split)
import fetch from 'node-fetch';
import hubspotAPI from '../client/hubspot-client.js';
import { firefliesApiKey } from '../client/fireflies-client.js';
import {
  MODELS,
  openAIApiKey,
  anthropicApiKey,
} from './config.js';
import { extractJson } from './core.utils.js';

/**
 * Helper to check if a value is meaningful (not null, empty, or placeholder)
 */
function isMeaningful(value) {
  if (!value) return false;
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase();
    // Reject common placeholder values
    if (['tbd', 'n/a', 'na', 'unknown', 'none', ''].includes(cleaned)) return false;
    return cleaned.length > 0;
  }
  return true;
}

/**
 * Validate that a cast value actually looks like cast names, not plot text
 */
function isValidCast(value) {
  if (!value || typeof value !== 'string') return false;
  
  const lower = value.toLowerCase();
  
  // CRITICAL: Reject if it contains "cast of characters" or similar plot phrases
  if (lower.includes('cast of characters') || 
      lower.includes('ensemble cast') ||
      lower.includes('follows an') ||
      lower.includes('confront') ||
      lower.includes('re-emergence')) {
    console.log('[isValidCast] Rejecting cast field - contains synopsis phrases:', value.substring(0, 100));
    return false;
  }
  
  // If it contains plot-related keywords, it's probably synopsis text in the wrong field
  const plotKeywords = ['protagonist', 'plot', 'story', 'shares', 'memories', 'over a cup', 
                        'importance of', 'comforting', 'heritage', 'emphasizing', 'feared', 'evil'];
  if (plotKeywords.some(keyword => lower.includes(keyword))) {
    console.log('[isValidCast] Rejecting cast field - contains plot keywords:', value.substring(0, 100));
    return false;
  }
  
  // If it's longer than 700 characters, it's probably not a cast list
  if (value.length > 700) {
    console.log('[isValidCast] Rejecting cast field - too long (likely plot text):', value.length, 'chars');
    return false;
  }
  
  // Additional check: Real cast lists usually contain commas or "and"
  // If it's a sentence structure without these, it's likely not a cast list
  if (value.length > 50 && !value.includes(',') && !lower.includes(' and ')) {
    console.log('[isValidCast] Rejecting cast field - appears to be a sentence, not a list:', value.substring(0, 100));
    return false;
  }
  
  return true;
}

/**
 * Intelligently extract the first meaningful value from multiple possible fields
 */
function firstMeaningful(...values) {
  for (const val of values) {
    if (isMeaningful(val)) return val;
  }
  return null;
}

export function normalizePartnership(src = {}) {
  // This function cleans up the inconsistent field names from HubSpot
  
  // DEBUG: Log what we're receiving
  console.log('[normalizePartnership] Input data fields:');
  console.log('  title:', src.title);
  console.log('  partnership_name:', src.partnership_name);
  console.log('  synopsis:', src.synopsis?.substring(0, 200));
  console.log('  main_cast:', src.main_cast?.substring(0, 200));
  console.log('  cast:', src.cast?.substring(0, 200));
  console.log('  talent:', src.talent?.substring(0, 200));
  
  return {
    // Project name
    title: firstMeaningful(src.title, src.partnership_name, src.name),
    partnership_name: firstMeaningful(src.partnership_name, src.title, src.name),
    distributor: firstMeaningful(src.distributor, src.studio, src.distribution_partner),
    releaseDate: firstMeaningful(src.releaseDate, src.release__est__date, src.release_estimated, src.release, src.release_date),
    productionStartDate: firstMeaningful(src.start_date, src.productionStartDate, src.production_start, src.prod_start),
    productionType: firstMeaningful(src.production_type, src.productionType, src.prod_type),
    location: firstMeaningful(src.storyline_location__city_, src.plot_location, src.location, src.city, src.shooting_location),
    time_period: firstMeaningful(src.time_period, src.period),
    audience_segment: firstMeaningful(src.audience_segment, src.audience, src.target_audience),
    genre_production: firstMeaningful(src.genre_production, src.genre, src.genres),
    // JUST USE THE HUBSPOT DATA AS-IS
    main_cast: src.main_cast || null,
    cast: src.main_cast || null,
    synopsis: firstMeaningful(src.synopsis, src.logline, src.description),
    vibe: firstMeaningful(src.vibe, src.genre_production, src.genre, src.genres),
    partnership_setting: firstMeaningful(src.partnership_setting, src.setting)
  };
}

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
