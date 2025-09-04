// lib/core.js
import fetch from 'node-fetch';
import { kv } from '@vercel/kv';

import hubspotAPI from '../client/hubspot-client.js';
import { firefliesApiKey } from '../client/fireflies-client.js';

import {
  MODELS,
  openAIApiKey,
  anthropicApiKey,
  msftTenantId,
  msftClientId,
  msftClientSecret,
  RECS_FIX_MERGE,
  RECS_COOLDOWN,
  RECS_DIVERSIFY,
  RECS_JITTER_TARGET,
} from './config.js';

import {
  o365API,
  searchFireflies,
  extractKeywordsForHubSpot,
  extractKeywordsForContextSearch,
  generateWildcardBrands,
} from './services.js';

/* =========================
 * KV PROGRESS HELPERS
 * ======================= */
export const progKey = (sessionId, runId) =>
  runId ? `progress:${sessionId}:${runId}` : `mcp:${sessionId}`;

export async function progressInit(sessionId, runId) {
  const key = progKey(sessionId, runId);
  await kv.set(
    key,
    { steps: [], done: false, runId: runId || null, ts: Date.now() },
    { ex: 900 }
  );
}

export async function progressPush(sessionId, runId, step) {
  const key = progKey(sessionId, runId);
  const s =
    (await kv.get(key)) || { steps: [], done: false, runId: runId || null, ts: Date.now() };
  const now = Date.now();
  const relativeMs = now - s.ts;
  s.steps.push({
    ...step,
    timestamp: relativeMs,
    ms: relativeMs,
    at: now,
  });
  if (s.steps.length > 100) s.steps = s.steps.slice(-100);
  await kv.set(key, s, { ex: 900 });
}

export async function progressDone(sessionId, runId) {
  const key = progKey(sessionId, runId);
  const s =
    (await kv.get(key)) || { steps: [], done: false, runId: runId || null, ts: Date.now() };
  s.done = true;
  await kv.set(key, s, { ex: 300 });
}

/* =========================
 * GENERAL UTILITIES
 * ======================= */
export function getCurrentTimeInPDT() {
  const timeZone = 'America/Los_Angeles';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    timeZoneName: 'short',
  }).format(new Date());
}

export function withTimeout(promise, ms, defaultValue) {
  let timeoutId = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(defaultValue), ms);
  });
  return Promise.race([promise, timeoutPromise]).then((result) => {
    clearTimeout(timeoutId);
    return result;
  });
}

export function normalizeTerm(t) {
  return String(t || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

export function uniqShort(list, max) {
  const out = [];
  const seen = new Set();
  for (const t of list.map(normalizeTerm)) {
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Merges keywords with fields. No sentences. No boolean. No quotes. 7-term budget for comms.
 */
export function buildSearchTerms({ title, distributor, talent = [], keywords = [], location, vibe }) {
  const fieldEntities = [title, distributor, ...talent.slice(0, 3)].filter(Boolean);
  const base = Array.isArray(keywords) ? keywords : String(keywords || '').split(/[,\|]/);
  
  // Add location and vibe/genre terms if available
  const additionalTerms = [];
  if (location && !location.includes('[') && location.length < 30) {
    additionalTerms.push(location);
  }
  if (vibe && !vibe.includes('[') && vibe.length < 30) {
    // Extract genre from vibe if it's descriptive
    const genreWords = vibe.match(/\b(action|comedy|drama|horror|thriller|romance|sci-fi|family)\b/gi);
    if (genreWords) {
      additionalTerms.push(...genreWords);
    }
  }
  
  const commsTerms = uniqShort([...fieldEntities, ...base, ...additionalTerms], 7); // entities then keywords
  const hubspotTerms = uniqShort([...base, title, ...additionalTerms].filter(Boolean), 8); // keywords then title
  return { commsTerms, hubspotTerms };
}

export async function getConversationHistory(sessionId, projectId, chatUrl, headersAirtable) {
  try {
    const searchUrl = `${chatUrl}?filterByFormula=AND(SessionID="${sessionId}",ProjectID="${
      projectId || 'default'
    }")`;
    const historyResponse = await fetch(searchUrl, { headers: headersAirtable });
    if (historyResponse.ok) {
      const result = await historyResponse.json();
      if (result.records.length > 0) {
        return result.records[0].fields.Conversation || '';
      }
    }
  } catch (error) {
    console.error('Error fetching conversation history:', error);
  }
  return '';
}

export function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function extractGenreFromSynopsis(synopsis) {
  if (!synopsis) return null;
  const genrePatterns = {
    action: /\b(action|fight|chase|explosion|battle|war|combat|hero|villain)\b/i,
    comedy: /\b(comedy|funny|humor|hilarious|laugh|sitcom|comedic)\b/i,
    drama: /\b(drama|emotional|family|relationship|struggle|journey)\b/i,
    horror: /\b(horror|scary|terror|thriller|suspense|supernatural)\b/i,
    documentary: /\b(documentary|docu|non-fiction|true story|real|factual)\b/i,
    sports: /\b(sports|athletic|fitness|game|match|competition|championship)\b/i,
    scifi: /\b(sci-fi|science fiction|future|space|alien|technology|dystopian)\b/i,
    romance: /\b(romance|love|romantic|relationship|dating)\b/i,
    crime: /\b(crime|detective|investigation|murder|police|criminal)\b/i,
  };
  for (const [genre, pattern] of Object.entries(genrePatterns)) {
    if (pattern.test(synopsis)) return genre;
  }
  return 'general';
}

export function extractLastProduction(conversation) {
  if (!conversation) return null;
  const patterns = [
    /Synopsis:([\s\S]+?)(?=\nUser:|\nAI:|$)/gi,
    /Production:([\s\S]+?)(?=\nUser:|\nAI:|$)/gi,
    /(?:movie|film|show|series|production)[\s\S]{0,500}?(?:starring|featuring|about|follows)[\s\S]+?(?=\nUser:|\nAI:|$)/gi,
  ];
  let lastProduction = null;
  for (const pattern of patterns) {
    const matches = conversation.match(pattern);
    if (matches && matches.length > 0) {
      lastProduction = matches[matches.length - 1];
      break;
    }
  }
  if (lastProduction) {
    lastProduction = lastProduction.replace(/^(Synopsis:|Production:)\s*/i, '').trim();
  }
  return lastProduction;
}

export function shouldUseSearch(userMessage) {
  const searchKeywords = [
    'brand',
    'production',
    'show',
    'movie',
    'series',
    'find',
    'search',
    'recommend',
    'suggestion',
    'partner',
  ];
  const messageLower = userMessage.toLowerCase();
  return searchKeywords.some((k) => messageLower.includes(k));
}

export async function updateAirtableConversation(
  sessionId,
  projectId,
  chatUrl,
  headersAirtable,
  updatedConversation,
  existingRecordId,
  projectName = null
) {
  try {
    let conversationToSave = updatedConversation;
    
    // Add project marker if we have a project name
    if (projectName) {
      // Add marker for easier extraction later
      conversationToSave = `[PRODUCTION:${projectName}]\n${conversationToSave}`;
    }
    
    if (conversationToSave.length > 10000) {
      conversationToSave = '...' + conversationToSave.slice(-10000);
    }
    const recordData = {
      fields: {
        SessionID: sessionId,
        ProjectID: projectId || 'default',
        Conversation: conversationToSave,
      },
    };
    if (existingRecordId) {
      await fetch(`${chatUrl}/${existingRecordId}`, {
        method: 'PATCH',
        headers: headersAirtable,
        body: JSON.stringify({ fields: recordData.fields }),
      });
    } else {
      await fetch(chatUrl, {
        method: 'POST',
        headers: headersAirtable,
        body: JSON.stringify(recordData),
      });
    }
  } catch (error) {
    console.error('[updateAirtableConversation] error:', error?.message);
  }
}

/* =========================
 * INTENT ROUTING
 * ======================= */
export async function routeUserIntent(userMessage, conversationContext, lastProductionContext) {
  if (!openAIApiKey) return { tool: 'answer_general_question' };

  const tools = [
    {
      type: 'function',
      function: {
        name: 'find_brands',
        description:
          'Use when user wants brand recommendations or suggestions. Includes: asking for brands for a project/production, requesting "more brands", finding brands by criteria. If they reference "this project/production", combine with last production context.',
        parameters: {
          type: 'object',
          properties: { search_term: { type: 'string' } },
          required: ['search_term'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_brand_activity',
        description:
          'Use when user wants to see communications (emails/meetings) about a specific brand, person, or partnership. ALWAYS use for requests about emails OR meetings OR both.',
        parameters: {
          type: 'object',
          properties: { search_query: { type: 'string' } },
          required: ['search_query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_pitches_for_brands',
        description: 'Use when user wants detailed integration ideas for specific named brands.',
        parameters: {
          type: 'object',
          properties: { brand_names: { type: 'array', items: { type: 'string' } } },
          required: ['brand_names'],
        },
      },
    },
    {
      type: 'function',
      function: { name: 'answer_general_question', description: 'General chat/questions' },
    },
  ];

  try {
    const systemPrompt = `You are an intelligent router.

ROUTING:
- "find brands" / "more brands" / vague brand search → find_brands (use last production context if vague)
- any request for emails/meetings/communications → get_brand_activity
- "create pitches for [brands]" → create_pitches_for_brands
- else → answer_general_question`;

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Last Production Context:\n"""\n${lastProductionContext || 'None'}\n"""\n\nUser's Request:\n"""\n${userMessage}\n"""`,
      },
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: MODELS.openai.chatMini,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.3,
      }),
    });

    if (!response.ok) throw new Error('AI router failed');
    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (toolCall) {
      const args = JSON.parse(toolCall.function.arguments || '{}');

      if (toolCall.function.name === 'find_brands') {
        const vagueTerms = [
          'this project',
          'this production',
          'more brands',
          'additional brands',
          'other brands',
        ];
        const isVague =
          args.search_term && vagueTerms.some((t) => args.search_term.toLowerCase().includes(t));
        if ((!args.search_term || isVague) && lastProductionContext) {
          args.search_term = lastProductionContext;
        } else if (!args.search_term) {
          args.search_term = userMessage;
        }
      }

      if (toolCall.function.name === 'get_brand_activity' && args.search_query) {
        args.brand_name = args.search_query;
        delete args.search_query;
      }

      return { tool: toolCall.function.name, args };
    }

    return { tool: 'answer_general_question' };
  } catch (error) {
    console.error('[routeUserIntent] error:', error?.message);
    return { tool: 'answer_general_question' };
  }
}

/* =========================
 * BRAND RANKING (AI)
 * ======================= */
export async function narrowWithIntelligentTagsOpenAI(
  hubspotBrands,
  firefliesTranscripts,
  emails,
  userMessage
) {
  if (!hubspotBrands || hubspotBrands.length === 0) {
    return { topBrands: [], taggedBrands: [] };
  }
  if (!openAIApiKey) {
    return { topBrands: hubspotBrands.slice(0, 15), taggedBrands: [] };
  }

  try {
    const rankedBrands = hubspotBrands
      .map((brand) => {
        const partnershipCount = parseInt(brand.properties.partnership_count || 0);
        const dealsCount = parseInt(brand.properties.deals_count || 0);
        const activityScore = partnershipCount * 2 + dealsCount;
        return {
          source: 'hubspot',
          id: brand.id,
          name: brand.properties.brand_name || '',
          category: brand.properties.main_category || 'General',
          subcategories: brand.properties.product_sub_category__multi_ || '',
          clientStatus: brand.properties.client_status || '',
          clientType: brand.properties.client_type || '',
          partnershipCount: brand.properties.partnership_count || '0',
          dealsCount: brand.properties.deals_count || '0',
          lastActivity: brand.properties.hs_lastmodifieddate,
          hubspotUrl: `https://app.hubspot.com/contacts/${
            hubspotAPI?.portalId || process.env.HUBSPOT_PORTAL_ID || '0'
          }/company/${brand.id}`,
          relevanceScore: Math.min(100, 50 + activityScore),
          tags: ['Activity-Based Ranking'],
          reason: `${partnershipCount} partnerships, ${dealsCount} deals`,
        };
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 15);

    return { topBrands: rankedBrands, taggedBrands: rankedBrands };
  } catch (error) {
    console.error('[narrowWithIntelligentTagsOpenAI] error:', error?.message);
    return { topBrands: hubspotBrands.slice(0, 15), taggedBrands: [] };
  }
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

/* =========================
 * COMBINING & TAGGING LISTS
 * ======================= */
export function tagAndCombineBrands({
  subCategoryBrands,
  activityBrands,
  synopsisBrands,
  genreBrands,
  activeBrands,
  dormantBrands,
  wildcardCategories,
  synopsis,
  context,
}) {
  const brandMap = new Map();

  const findBrandContext = (brandName) => {
    if (!context) return null;
    if (context.meetings?.length) {
      for (const meeting of context.meetings) {
        if (
          meeting.title?.toLowerCase().includes(brandName.toLowerCase()) ||
          meeting.summary?.overview?.toLowerCase().includes(brandName.toLowerCase())
        ) {
          const segments = [];
          if (meeting.summary?.action_items?.length > 0) {
            segments.push({ type: 'text', content: 'Active discussions noted with action items from ' });
          } else if (meeting.summary?.overview) {
            segments.push({ type: 'text', content: 'Recent meeting activity discussed in ' });
          } else {
            segments.push({ type: 'text', content: 'Mentioned in ' });
          }
          segments.push({
            type: 'link',
            content: `"${meeting.title}" on ${meeting.dateString}`,
            url: meeting.transcript_url || '#',
          });
          if (meeting.summary?.action_items?.length > 0) {
            segments.push({ type: 'text', content: ` - "${meeting.summary.action_items[0]}"` });
          }
          return { segments, rawText: segments.map((s) => s.content).join('') };
        }
      }
    }
    if (context.emails?.length) {
      for (const email of context.emails) {
        if (
          email.subject?.toLowerCase().includes(brandName.toLowerCase()) ||
          email.preview?.toLowerCase().includes(brandName.toLowerCase())
        ) {
          const date = new Date(email.receivedDate).toLocaleDateString();
          const segments = [
            {
              type: 'text',
              content: `Recent email from ${email.fromName || email.from}: "${email.subject}" (${date})`,
            },
          ];
          return { segments, rawText: segments[0].content };
        }
      }
    }
    return null;
  };

  const generatePitch = (brand, synopsisText) => {
    const category = (brand.category || '').toLowerCase();
    const genre = extractGenreFromSynopsis(synopsisText);
    if (category.includes('automotive') && genre === 'action')
      return 'Hero car for chase sequences - proven track record with action films';
    if (category.includes('fashion') && (genre === 'drama' || genre === 'romance'))
      return 'Wardrobe partner for character development - luxury meets storytelling';
    if (category.includes('tech') && genre === 'scifi') return 'Future-tech integration - product as narrative device';
    if (category.includes('beverage') && genre === 'comedy')
      return 'Social scenes product placement - natural comedy moments';
    if (parseInt(brand.partnershipCount) > 10)
      return `${brand.partnershipCount} successful integrations - knows entertainment value`;
    if (brand.clientType === 'Retainer') return 'Retainer client with flexible integration budget';
    if (parseInt(brand.dealsCount) > 5) return `Active in ${brand.dealsCount} current productions - high engagement`;
    return `${brand.category} leader - natural fit for ${genre || 'this'} production`;
  };

  const addBrandBase = (id, brand, primaryTag, reason, contextData) => {
    // Ensure ID is always a string
    const brandId = id
      ? String(id)
      : `brand-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Extract brand name - handle both direct properties and nested properties
    const brandName = brand.properties?.brand_name || brand.name || brand.brand || 'Unknown Brand';

    // Extract HubSpot owner IDs - handle various property names
    const secondaryOwner = brand.properties?.secondary_owner || 
                           brand.properties?.secondaryOwnerId || 
                           brand.secondary_owner || 
                           brand.secondaryOwnerId || null;
    const specialtyLead = brand.properties?.specialty_lead || 
                         brand.properties?.specialtyLeadId || 
                         brand.specialty_lead || 
                         brand.specialtyLeadId || null;

    brandMap.set(brandId, {
      source: 'hubspot',
      id: brandId,
      name: brandName, // Ensure name is always set
      brand: brandName, // Also set as 'brand' for compatibility
      category: brand.properties?.main_category || brand.category || 'General',
      subcategories: brand.properties?.product_sub_category__multi_ || brand.subcategories || '',
      clientStatus: brand.properties?.client_status || brand.clientStatus || '',
      clientType: brand.properties?.client_type || brand.clientType || '',
      partnershipCount: brand.properties?.partnership_count || brand.partnershipCount || '0',
      dealsCount: brand.properties?.deals_count || brand.dealsCount || '0',
      lastActivity: brand.properties?.hs_lastmodifieddate || brand.lastActivity,
      hubspotUrl:
        brand.hubspotUrl ||
        `https://app.hubspot.com/contacts/${
          hubspotAPI?.portalId || process.env.HUBSPOT_PORTAL_ID || '0'
        }/company/${brandId}`,
      oneSheetLink: brand.properties?.one_sheet_link || brand.oneSheetLink || null,
      secondary_owner: secondaryOwner,
      specialty_lead: specialtyLead,
      // Also keep the camelCase versions for compatibility
      secondaryOwnerId: secondaryOwner,
      specialtyLeadId: specialtyLead,
      tags: [primaryTag],
      relevanceScore: 50,  // Default base score - will be recalculated with multipliers
      reason,
      insight: contextData,
    });
  };

  // AI-driven sub-category brands (highest priority)
  subCategoryBrands?.results?.forEach((b) => {
    const brandId = b.id
      ? String(b.id)
      : `subcategory-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextData = findBrandContext(b.properties?.brand_name || b.name || '');
    if (!brandMap.has(brandId)) {
      addBrandBase(
        brandId,
        b,
        '🎯 Perfect Context Match',
        'AI-identified as perfect fit for production context',
        contextData
      );
    } else {
      const br = brandMap.get(brandId);
      br.tags.push('🎯 Perfect Context Match');
      if (contextData && !br.insight) br.insight = contextData;
    }
  });

  // activity & synopsis pools
  activityBrands?.results?.forEach((b) => {
    const brandId = b.id
      ? String(b.id)
      : `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextData = findBrandContext(b.properties?.brand_name || b.name || '');
    if (!brandMap.has(brandId)) {
      addBrandBase(
        brandId,
        b,
        '📧 Recent Activity',
        `Recent engagement - last activity ${new Date(
          b.properties?.hs_lastmodifieddate || b.lastActivity || Date.now()
        ).toLocaleDateString()}`,
        contextData
      );
    } else {
      const br = brandMap.get(brandId);
      br.tags.push('📧 Recent Activity');
      if (contextData && !br.insight) br.insight = contextData;
    }
  });

  synopsisBrands?.results?.forEach((b) => {
    const brandId = b.id
      ? String(b.id)
      : `synopsis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextData = findBrandContext(b.properties?.brand_name || b.name || '');
    if (!brandMap.has(brandId)) {
      addBrandBase(brandId, b, '🎯 Genre Match', 'Matches production genre and themes', contextData);
    } else {
      const br = brandMap.get(brandId);
      br.tags.push('🎯 Genre Match');
      if (contextData && !br.insight) br.insight = contextData;
    }
  });

  genreBrands?.results?.forEach((b) => {
    const brandId = b.id
      ? String(b.id)
      : `genre-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextData = findBrandContext(b.properties?.brand_name || b.name || '');
    const brandProps = b.properties || b;
    if (!brandMap.has(brandId)) {
      addBrandBase(brandId, b, '🎭 Vibe Match', generatePitch(brandProps, synopsis), contextData);
    } else {
      const br = brandMap.get(brandId);
      br.tags.push('🎭 Vibe Match');
      if (contextData && !br.insight) br.insight = contextData;
    }
  });

  activeBrands?.results?.forEach((b) => {
    const brandId = b.id
      ? String(b.id)
      : `active-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextData = findBrandContext(b.properties?.brand_name || b.name || '');
    const dealsCount = b.properties?.deals_count || b.dealsCount || '0';
    const partnershipCount = b.properties?.partnership_count || b.partnershipCount || '0';
    if (!brandMap.has(brandId)) {
      addBrandBase(
        brandId,
        b,
        '💰 Active Big-Budget Client',
        `Budget proven: ${dealsCount} deals, ${partnershipCount} partnerships`,
        contextData
      );
      const br = brandMap.get(brandId);
      br.tags.push('🔥 Active Client');
    } else {
      const br = brandMap.get(brandId);
      if (!br.tags.includes('💰 Big Budget')) br.tags.push('💰 Big Budget');
      if (!br.tags.includes('🔥 Active Client')) br.tags.push('🔥 Active Client');
      if (contextData && !br.insight) br.insight = contextData;
    }
  });

  // Dormant brands pool - re-ignition opportunities
  dormantBrands?.results?.forEach((b) => {
    const brandId = b.id
      ? String(b.id)
      : `dormant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextData = findBrandContext(b.properties?.brand_name || b.name || '');
    const lastActivity = b.properties?.hs_lastmodifieddate || b.lastActivity;
    if (!brandMap.has(brandId)) {
      addBrandBase(
        brandId,
        b,
        '📈 Re-Ignition Opportunity',  // Updated emoji for consistency
        `Previously successful partner - last activity ${new Date(lastActivity || Date.now()).toLocaleDateString()}`,
        contextData
      );
    } else {
      const br = brandMap.get(brandId);
      br.tags.push('📈 Re-Ignition Opportunity');
      if (contextData && !br.insight) br.insight = contextData;
    }
  });

  if (wildcardCategories?.length) {
    const genre = extractGenreFromSynopsis(synopsis);
    wildcardCategories.slice(0, 5).forEach((brandName, idx) => {
      let pitch = `Perfect ${genre || 'creative'} synergy - worth cold outreach`;
      const nameLower = brandName.toLowerCase();
      if (nameLower.includes('luxury')) pitch = 'Elevates production value - luxury brand cachet';
      else if (nameLower.includes('tech')) pitch = 'Innovation angle - tech-forward narrative integration';
      else if (nameLower.includes('sustainable'))
        pitch = 'ESG story angle - sustainability messaging opportunity';

      brandMap.set(`wildcard_${idx}`, {
        source: 'suggestion',
        id: `wildcard_${idx}`,
        name: brandName, // Ensure name is set
        brand: brandName, // Also set as 'brand' for compatibility
        category: 'Suggested for Cold Outreach',
        tags: ['🚀 Cold Outreach Opportunity', '💡 Creative Suggestion', '🎭 Vibe Match'],
        relevanceScore: 50,  // Will be recalculated with multipliers
        reason: pitch,
        isWildcard: true,
      });
    });
  }

  // Process all brands and ensure proper tagging logic
  const sorted = Array.from(brandMap.values()).map(brand => {
    // Ensure Active and Re-Ignition tags are mutually exclusive
    if (brand.clientStatus === 'Active' || brand.clientStatus === 'Contract') {
      // If it's active, ensure it has the Active tag
      if (!brand.tags.includes('🔥 Active Client')) {
        brand.tags.push('🔥 Active Client');
      }
      // CRITICAL: Remove any re-ignition tag it might have
      brand.tags = brand.tags.filter(tag => tag !== '📈 Re-Ignition Opportunity');
    } else if (brand.clientStatus === 'Inactive') {
      // If it's inactive, it can be a re-ignition opportunity
      if (!brand.tags.includes('📈 Re-Ignition Opportunity')) {
        brand.tags.push('📈 Re-Ignition Opportunity');
      }
      // Remove any active client tags
      brand.tags = brand.tags.filter(tag => tag !== '🔥 Active Client');
    }
    
    // NEW MULTIPLIER-BASED SCORING SYSTEM
    // =================================================================
    const partnershipCount = parseInt(brand.partnershipCount) || 0;
    
    // 1. Create a NORMALIZED base score from activity (0-30 points).
    // This prevents massive outliers from dominating.
    const activityScore = 10 + Math.min(20, Math.round(partnershipCount / 5));
    
    // 2. Determine the CONTEXT MULTIPLIER. This is where the magic happens.
    let contextMultiplier = 1.0;
    
    // Check for AI-identified perfect context match (highest priority)
    if (brand.tags.includes('🎯 Perfect Context Match')) {
      contextMultiplier = 6.0; // Highest multiplier for AI sub-category matches
    } else if (brand.tags.includes('🎯 Genre Match') || brand.tags.includes('🎭 Vibe Match')) {
      // Give a HUGE boost for genre/vibe context matches
      contextMultiplier = 5.0;
    } else if (brand.tags.includes('📈 Re-Ignition Opportunity')) {
      // Give a strong boost to dormant brands
      contextMultiplier = 2.5;
    } else if (brand.clientStatus === 'Active' || brand.clientStatus === 'Contract') {
      // Give only a small boost for being an active client without context match
      contextMultiplier = 1.5;
    }
    
    // 3. Calculate the final score.
    brand.relevanceScore = Math.round(activityScore * contextMultiplier);
    // =================================================================
    
    return brand;
  }).sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Jitter target size if enabled
  let targetSize = 15;
  if (RECS_JITTER_TARGET && synopsis) {
    const hashCode = synopsis
      .split('')
      .reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0);
    const jitter = (Math.abs(hashCode) % 7) - 3; // -3..+3
    targetSize = Math.max(12, Math.min(20, 15 + jitter));
  }

  return sorted.slice(0, Math.min(targetSize, sorted.length));
}

/* ========================================================================
 * REWRITTEN BRAND SEARCH ORCHESTRATOR AND HELPERS (SEPTEMBER 2025)
 * ====================================================================== */

/**
 * A resilient function to fetch all required data from external and internal sources.
 * If a non-critical search fails, it returns an empty array instead of crashing.
 */
async function fetchAllBrandData(intent, { add, knownProjectName, userMessage, partnershipData }) {
  add({ type: 'start', text: '🔎 Beginning data acquisition...' });

  const search_term = intent.args.search_term || userMessage;
  
  // Build rich production context for AI-powered search
  const productionContext = `
    Project Name: ${partnershipData?.title || knownProjectName || 'Unknown'}
    Genre: ${partnershipData?.genre_production || partnershipData?.genre || partnershipData?.vibe || 'N/A'}
    Time Period: ${partnershipData?.time_period || partnershipData?.timePeriod || 'N/A'}
    Plot Location: ${partnershipData?.plot_location || partnershipData?.plotLocation || partnershipData?.storyline_location__city_ || partnershipData?.storylineCity || partnershipData?.location || 'N/A'}
    Audience: ${partnershipData?.audience_segment || partnershipData?.audienceSegment || 'N/A'}
    Cast: ${Array.isArray(partnershipData?.cast) ? partnershipData.cast.join(', ') : (partnershipData?.cast || 'N/A')}
    Synopsis: ${partnershipData?.synopsis || search_term}
  `.trim();
  
  // AI-powered sub-category generation for contextual matching
  let aiGeneratedSubCategories = [];
  if (openAIApiKey && productionContext) {
    try {
      const categoryGenerationPrompt = `Your task is to act as an expert brand integration strategist. Analyze the provided project context.
Your ONLY output must be a single, valid JSON array of strings.
The strings in the array must be the 5 most relevant and specific brand sub-categories from our HubSpot database that would be a natural fit for this project.

CRITICAL RULES:
1. You MUST return ONLY a JSON array.
2. Do NOT include any conversational text, explanations, or markdown formatting like \`\`\`json.
3. The sub-categories should be specific (e.g., "Luxury Electric Vehicles", "Sustainable Activewear", "Artisanal Coffee") rather than generic ("Automotive", "Fashion").

Project Context:
---
${productionContext}
---

JSON Array Output:`;
      
      const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: categoryGenerationPrompt
            }
          ],
          temperature: 0.3,
          max_tokens: 150
        })
      });
      
      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const aiResponseContent = aiData.choices?.[0]?.message?.content;
        
        // ADD DIAGNOSTIC LOG
        console.log('[AI-DIAGNOSTIC] Raw response from AI:', aiResponseContent);
        
        // Use the robust extractJson function to handle markdown formatting
        const categoryData = extractJson(aiResponseContent);
        
        // Handle both direct array and object with categories property
        aiGeneratedSubCategories = Array.isArray(categoryData) 
          ? categoryData 
          : (categoryData?.categories || []);
          
        if (Array.isArray(aiGeneratedSubCategories)) {
          aiGeneratedSubCategories = aiGeneratedSubCategories.slice(0, 5);
          if (aiGeneratedSubCategories.length > 0) {
            // ADD DIAGNOSTIC LOG
            console.log('[AI-DIAGNOSTIC] HubSpot will be queried for brands in these sub-categories:', aiGeneratedSubCategories);
            add({ type: 'info', text: `🎯 AI identified sub-categories: ${aiGeneratedSubCategories.join(', ')}` });
          } else {
            console.log('[AI-DIAGNOSTIC] AI returned an empty array of sub-categories.');
          }
        } else {
          console.log('[AI-DIAGNOSTIC] AI response was not an array format.');
        }
      }
    } catch (error) {
      console.error('[fetchAllBrandData] AI sub-category generation failed:', error.message);
    }
  }
  
  // Fallback to keyword extraction if AI generation fails
  const synopsisKeywords = aiGeneratedSubCategories.length > 0 ? null : await extractKeywordsForHubSpot(search_term);
  if (synopsisKeywords) {
    add({ type: 'info', text: `🔑 Extracted Keywords: ${synopsisKeywords}` });
  }
  
  // Keyword to Category mapping for better HubSpot searches
  const KEYWORD_TO_CATEGORY_MAP = {
    'animation': 'Entertainment',
    'animated': 'Entertainment', 
    'family': 'Entertainment',
    'streaming': 'Entertainment',
    'music': 'Entertainment',
    'concert': 'Entertainment',
    'tour': 'Entertainment',
    'automotive': 'Automotive',
    'car': 'Automotive',
    'vehicle': 'Automotive',
    'fashion': 'Fashion & Apparel',
    'apparel': 'Fashion & Apparel',
    'clothing': 'Fashion & Apparel',
    'gaming': 'Gaming',
    'esports': 'Gaming',
    'video game': 'Gaming',
    'tech': 'Technology',
    'technology': 'Technology',
    'software': 'Technology',
    'food': 'Food & Beverage',
    'beverage': 'Food & Beverage',
    'restaurant': 'Food & Beverage',
    'beauty': 'Health & Beauty',
    'health': 'Health & Beauty',
    'fitness': 'Sports & Fitness',
    'sports': 'Sports & Fitness',
    'travel': 'Travel',
    'hospitality': 'Travel',
    'financial': 'Financial Services',
    'banking': 'Financial Services',
    'insurance': 'Financial Services'
  };
  
  // Generate business categories for communications search
  let businessCategories = [];
  if (openAIApiKey && (partnershipData?.vibe || partnershipData?.synopsis || search_term)) {
    try {
      const contextForCategories = partnershipData?.vibe || partnershipData?.synopsis || search_term;
      const categoryPrompt = knownProjectName 
        ? `Based on the project '${knownProjectName}', which is a ${contextForCategories}, provide the top 2 most likely search terms that would appear in the title or summary of a relevant business meeting. Prioritize specific sub-genres or related industries. For example, for an 'Action Thriller', good terms might be 'Stunt Coordination' or 'Automotive Placement'. **IMPORTANT: Respond with ONLY the comma-separated list of terms and no other text, formatting, or conversational filler.**`
        : `Based on this production context, provide the top 2 most likely search terms for finding relevant business meetings. Focus on specific industry terms. Context: ${contextForCategories.slice(0, 300)}. **IMPORTANT: Respond with ONLY the comma-separated list of terms and no other text, formatting, or conversational filler.**`;
        
      const categoryResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: categoryPrompt
            }
          ],
          temperature: 0.3,
          max_tokens: 50
        })
      });
      
      if (categoryResponse.ok) {
        const categoryData = await categoryResponse.json();
        let categoriesText = categoryData.choices?.[0]?.message?.content?.trim();
        if (categoriesText) {
          // Defensive parsing: clean up AI response
          // If the AI includes a colon, take only the part after it
          if (categoriesText.includes(':')) {
            categoriesText = categoriesText.split(':').pop();
          }
          
          // Remove any quotes, asterisks, periods, and other formatting
          categoriesText = categoriesText.replace(/["'*\.]/g, '').trim();
          
          // Split and clean the terms
          businessCategories = categoriesText
            .split(',')
            .map(cat => cat.trim())
            .filter(cat => cat.length > 0)
            .slice(0, 2);
          
          if (businessCategories.length > 0) {
            add({ type: 'info', text: `🎯 Generated business categories: ${businessCategories.join(', ')}` });
          }
        }
      }
    } catch (error) {
      console.error('[fetchAllBrandData] Failed to generate business categories:', error.message);
    }
  }
  
  // Build initial search terms
  const hubspotTerms = synopsisKeywords ? synopsisKeywords.split(' ').slice(0, 8) : [];
  if (knownProjectName && !hubspotTerms.includes(knownProjectName)) {
    hubspotTerms.unshift(knownProjectName);
  }
  
  // Split hubspotTerms into categories vs brand names
  const categoryTerms = new Set();
  const nameTerms = [];
  
  for (const term of hubspotTerms) {
    const key = term.toLowerCase();
    if (KEYWORD_TO_CATEGORY_MAP[key]) {
      categoryTerms.add(KEYWORD_TO_CATEGORY_MAP[key]);
    } else {
      nameTerms.push(term);
    }
  }
  const uniqueCategoryTerms = Array.from(categoryTerms);
  
  add({ type: 'info', text: `📂 Categories: ${uniqueCategoryTerms.join(', ') || 'none'}, 🏷️ Names: ${nameTerms.slice(0, 3).join(', ') || 'none'}` });
  
  // Build communications terms: title + AI-generated business categories
  const commsTerms = [];
  if (partnershipData?.title || knownProjectName) {
    commsTerms.push(partnershipData?.title || knownProjectName);
  }
  commsTerms.push(...businessCategories);
  
  // Fallback if no business categories generated
  if (commsTerms.length < 2 && synopsisKeywords) {
    const fallbackTerms = synopsisKeywords.split(' ').slice(0, 2);
    commsTerms.push(...fallbackTerms);
  }

  const searchBrandsWithRetry = async (params) => {
    try {
      return await hubspotAPI.searchBrands(params);
    } catch (e) {
      console.error('[searchBrandsWithRetry] HubSpot search failed:', e.message);
      return { results: [] }; // Return empty on error
    }
  };

  // Implement hybrid search strategy
  let hubspotSearchPromises = [];
  
  // AI-driven sub-category search (if we have sub-categories)
  if (aiGeneratedSubCategories && aiGeneratedSubCategories.length > 0) {
    console.log('[AI-DIAGNOSTIC] Building HubSpot search for AI sub-categories:', aiGeneratedSubCategories);
    hubspotSearchPromises.push(
      withTimeout(searchBrandsWithRetry({
        limit: 20,
        filterGroups: [{
          filters: [{
            propertyName: 'product_sub_category__multi_',
            operator: 'IN',
            values: aiGeneratedSubCategories
          }]
        }],
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }]  // Sort by recent activity, not total partnerships
      }), 5000, { results: [] })
    );
  } else {
    console.log('[AI-DIAGNOSTIC] No valid sub-categories were generated by the AI.');
  }
  
  // Category search - single efficient request for all categories
  if (uniqueCategoryTerms.length > 0) {
    hubspotSearchPromises.push(
      withTimeout(searchBrandsWithRetry({
        limit: 15,
        filterGroups: [{
          filters: [{ 
            propertyName: 'main_category', 
            operator: 'IN', 
            values: uniqueCategoryTerms 
          }]
        }]
      }), 5000, { results: [] })
    );
  }
  
  // Name-based keyword searches removed - AI sub-category search handles context better
  
  // Active clients search
  hubspotSearchPromises.push(
    withTimeout(
      searchBrandsWithRetry({
        limit: 10,
        filterGroups: [
          {
            filters: [
              { propertyName: 'client_status', operator: 'IN', values: ['Active', 'Contract'] },
              { propertyName: 'deals_count', operator: 'GTE', value: '3' },
            ],
          },
        ],
        sorts: [{ propertyName: 'partnership_count', direction: 'DESCENDING' }],
      }),
      5000,
      { results: [] }
    )
  );
  
  // Dormant / Re-ignition pool - inactive clients for variety
  hubspotSearchPromises.push(
    withTimeout(searchBrandsWithRetry({
      limit: 15,
      filterGroups: [{
        filters: [{
          propertyName: 'client_status',
          operator: 'EQ',
          value: 'Inactive'
        }]
      }],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }]
    }), 5000, { results: [] })
  );
  
  // Execute HubSpot searches
  const hubspotResults = await Promise.allSettled(hubspotSearchPromises);
  
  // Process AI sub-category results (if present)
  let subCategoryResults = { results: [] };
  let baseIndex = 0;
  if (aiGeneratedSubCategories && aiGeneratedSubCategories.length > 0) {
    subCategoryResults = hubspotResults[0]?.status === 'fulfilled' 
      ? hubspotResults[0].value 
      : { results: [] };
    baseIndex = 1;
    add({ type: 'result', text: `🎯 Found ${subCategoryResults.results?.length || 0} brands matching AI sub-categories` });
  }
  
  // Process category results
  const categoryResults = uniqueCategoryTerms.length > 0 && hubspotResults[baseIndex]?.status === 'fulfilled' 
    ? hubspotResults[baseIndex].value 
    : { results: [] };
  
  if (uniqueCategoryTerms.length > 0) {
    baseIndex++;
  }
  
  add({ type: 'result', text: `🏷️ Found ${categoryResults.results?.length || 0} brands in categories` });
  
  // No name search results since we removed that redundant logic
  const nameSearchResults = [];
  
  // Process active clients results (second to last)
  const activeIdx = hubspotResults.length - 2;
  const activeResults = hubspotResults[activeIdx]?.status === 'fulfilled' 
    ? hubspotResults[activeIdx].value 
    : { results: [] };
  
  // Process dormant clients results (last)
  const dormantIdx = hubspotResults.length - 1;
  const dormantResults = hubspotResults[dormantIdx]?.status === 'fulfilled' 
    ? hubspotResults[dormantIdx].value 
    : { results: [] };
  // Name searches removed - AI sub-category search provides better contextual results
  add({ type: 'result', text: `💼 Found ${activeResults.results?.length || 0} active clients` });
  add({ type: 'result', text: `💤 Found ${dormantResults.results?.length || 0} dormant clients for re-ignition` });

  // Communications searches with improved Fireflies terms
  const [commsResults, wildcardResults] = await Promise.all([
    Promise.allSettled([
      firefliesApiKey
        ? withTimeout(searchFireflies(commsTerms, { limit: 10 }), 5000, { transcripts: [] })
        : Promise.resolve({ transcripts: [] }),
      o365API.searchEmails
        ? withTimeout(o365API.searchEmails(commsTerms, { days: 90, limit: 12 }), 6000, {
            emails: [],
            o365Status: 'timeout',
          })
        : Promise.resolve({ emails: [], o365Status: 'no_credentials' }),
    ]),
    // Wildcard generation
    Promise.resolve(withTimeout(generateWildcardBrands(search_term), 8000, [])),
  ]);
  
  const meetingCount = commsResults[0].status === 'fulfilled' ? commsResults[0].value.transcripts.length : 0;
  const emailCount = commsResults[1].status === 'fulfilled' ? commsResults[1].value.emails.length : 0;

  add({ type: 'result', text: `📊 HubSpot Found: ${subCategoryResults.results?.length || 0} AI matches, ${categoryResults.results?.length || 0} category matches, ${nameSearchResults.length} name matches, ${activeResults.results?.length || 0} active, ${dormantResults.results?.length || 0} dormant.` });
  add({ type: 'result', text: `📧 Comms Found: ${meetingCount} meetings, ${emailCount} emails.` });

  return {
    aiContextBrands: subCategoryResults,  // AI-driven sub-category results (labeled for ranking)
    synopsisBrands: categoryResults,  // Category search results
    genreBrands: { results: nameSearchResults },  // Name search results
    activeBrands: activeResults,  // Active clients
    dormantBrands: dormantResults,  // Dormant clients for re-ignition
    communications: {
      meetings: commsResults[0].status === 'fulfilled' ? commsResults[0].value.transcripts : [],
      emails: commsResults[1].status === 'fulfilled' ? commsResults[1].value.emails : [],
    },
    wildcardBrands: wildcardResults,
  };
}

/**
 * Takes the raw data pools and applies business logic to combine, tag, and rank them.
 */
function rankAndCombineBrands(dataPools, { search_term, add }) {
  add({ type: 'process', text: '🤝 Combining and ranking results...' });
  const { aiContextBrands, synopsisBrands, genreBrands, activeBrands, dormantBrands, wildcardBrands, communications } = dataPools;

  const finalBrands = tagAndCombineBrands({
    subCategoryBrands: aiContextBrands,  // Pass AI brands as sub-category for proper tagging
    synopsisBrands,
    genreBrands,
    activeBrands,
    dormantBrands,
    wildcardCategories: wildcardBrands,
    synopsis: search_term,
    context: communications,
  });

  add({ type: 'info', text: `📋 Combined into a unique list of ${finalBrands.length} brands.` });

  return finalBrands;
}

/**
 * Takes the top-ranked brands and calls an AI to generate creative content.
 * It reliably merges the AI content back while preserving the original brand ID.
 */
async function generateCreativeContent(topBrands, { add, actualProjectName, search_term, partnershipData }) {
  if (!topBrands || topBrands.length === 0) return { enrichedBrands: [], finalReplyText: '' };
  add({ type: 'process', text: '✍️ Generating creative content...' });

  // Use the full Airtable prompt structure
  const productionContext = [
    partnershipData?.distributor && `Studio/Distributor: ${partnershipData.distributor}`,
    partnershipData?.releaseDate && `Release Date: ${partnershipData.releaseDate}`,
    partnershipData?.productionStartDate && `Production Start: ${partnershipData.productionStartDate}`,
    partnershipData?.location && `Location: ${partnershipData.location}`,
    partnershipData?.cast && `Cast: ${partnershipData.cast}`,
    partnershipData?.vibe && `Genre/Vibe: ${partnershipData.vibe}`,
    partnershipData?.budget && `Budget: ${partnershipData.budget}`,
    partnershipData?.synopsis && `Synopsis: ${partnershipData.synopsis}`
  ].filter(Boolean).join('\n');

  // Full Airtable-compliant prompt with all formatting rules
  const creativePrompt = `You are a Hollywood brand integration specialist. Create partnership recommendations for "${actualProjectName}".

${productionContext ? `PRODUCTION DETAILS:\n${productionContext}\n\n` : ''}
USER REQUEST: ${search_term}

CREATE INTEGRATION IDEAS FOR THESE ${topBrands.length} BRANDS:

${topBrands
    .map(
      (brand, idx) =>
        `${idx + 1}. Brand: ${brand.name}\nCategory: ${brand.category}\nTrack Record: ${brand.partnershipCount} partnerships, ${brand.dealsCount} deals\nClient Status: ${brand.clientStatus || 'Prospect'}\nClient Type: ${brand.clientType || 'New'}`
    )
    .join('\n\n')}

FORMATTING RULES:
- NO asterisks or special characters
- NO phrases like "Here are" or "I suggest" or "Based on"
- NO summary or conclusion at the end
- Start directly with the brand name
- Be specific and actionable
- DO NOT LIE - only use information provided

For EACH brand listed above, write EXACTLY in this format:

Brand: [Exact Brand Name]
Integration: [Specific product placement ideas that fit the production]
Why it works: [Why this brand aligns with the production and audience]
HB Insights: [Partnership potential based on their track record and our relationship]

Provide recommendations for ALL ${topBrands.length} brands.`;

  let finalFormattedText = '';
  try {
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a creative brand partnership specialist. Follow the formatting rules exactly. Never use asterisks. Start directly with content, no preambles.' },
          { role: 'user', content: creativePrompt },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      }),
    });
    
    if (aiResponse.ok) {
      const data = await aiResponse.json();
      finalFormattedText = data.choices?.[0]?.message?.content || '';
      
      if (finalFormattedText) {
        add({ type: 'checkpoint', text: `✍️ Creative pitches generated for top ${topBrands.length} brands.` });
      }
    }
  } catch (error) {
    console.error('[Creative AI] Fetch failed:', error.message);
  }

  // If no AI response, generate a fallback
  if (!finalFormattedText) {
    finalFormattedText = topBrands.map((brand, idx) => {
      const category = brand.category || 'General';
      const partnershipCount = brand.partnershipCount || '0';
      const dealsCount = brand.dealsCount || '0';
      
      return `Brand: ${brand.name}
Integration: Strategic ${brand.name} placement integrated naturally into key production moments.
Why it works: Strong alignment between ${brand.name} and production themes.
HB Insights: ${partnershipCount} previous partnerships and ${dealsCount} deals demonstrate proven entertainment value.`;
    }).join('\n\n');
  }

  // Split the AI response into chunks, one for each brand.
  // The split pattern looks for "Brand:" at the beginning of a line.
  const brandSections = finalFormattedText.split(/\n(?=Brand:)/).map(s => s.trim());

  const enrichedBrandsWithContent = topBrands.map(originalBrand => {
    // Find the text section that corresponds to this brand's name.
    const brandSectionText = brandSections.find(section =>
      section.toLowerCase().startsWith(`brand: ${originalBrand.name.toLowerCase()}`)
    );

    return {
      ...originalBrand,
      // Assign the specific, formatted text section to the brand's content field.
      // If not found, it falls back to a simple name string.
      content: brandSectionText ? brandSectionText.split('\n') : [originalBrand.name],
      // Preserve HubSpot user IDs
      secondary_owner: originalBrand.secondary_owner || originalBrand.secondaryOwnerId || null,
      specialty_lead: originalBrand.specialty_lead || originalBrand.specialtyLeadId || null,
      secondaryOwnerId: originalBrand.secondary_owner || originalBrand.secondaryOwnerId || null,
      specialtyLeadId: originalBrand.specialty_lead || originalBrand.specialtyLeadId || null
    };
  });

  return {
    enrichedBrands: enrichedBrandsWithContent,
    finalReplyText: finalFormattedText
  };
}

/**
 * Takes the final, enriched brand data and formats it for the frontend.
 * This is the final checkpoint to guarantee all IDs are valid strings.
 */
function prepareFrontendPayload({
  enrichedBrands,
  allRankedBrands,
  mcpThinking,
  projectName,
  partnershipData,
  finalReplyText,
}) {
  const ensureId = (brand, index) => {
    let id = brand.id;
    if (!id && id !== 0) {
      const cleanName = (brand.name || 'brand')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      id = `${cleanName}-${index}`;
    }
    // Ensure we preserve the HubSpot user IDs and isInSystem flag
    return { 
      ...brand, 
      id: String(id),
      // Preserve both naming conventions for compatibility
      secondary_owner: brand.secondary_owner || brand.secondaryOwnerId || null,
      specialty_lead: brand.specialty_lead || brand.specialtyLeadId || null,
      secondaryOwnerId: brand.secondary_owner || brand.secondaryOwnerId || null,
      specialtyLeadId: brand.specialty_lead || brand.specialtyLeadId || null,
      // Mark brands as "in system" if they have Active/Contract status or Retainer type
      isInSystem: brand.isInSystem || 
                  brand.clientStatus === 'Active' || 
                  brand.clientStatus === 'Contract' || 
                  brand.clientType === 'Retainer' || 
                  false
    };
  };

  const detailedBrands = enrichedBrands.map(ensureId);
  const brandSuggestions = allRankedBrands.map(ensureId);

  return {
    mcpThinking,
    finalReplyText,  // Include the final formatted text
    organizedData: {
      dataType: 'BRAND_RECOMMENDATIONS',
      detailedBrands,
      brandSuggestions,
      projectName,
      partnershipData,
      // Include the parsed partnership data fields at the top level too
      distributor: partnershipData?.distributor,
      releaseDate: partnershipData?.releaseDate,
      productionStartDate: partnershipData?.productionStartDate,
      productionType: partnershipData?.productionType,
      location: partnershipData?.location,
      cast: partnershipData?.cast,
      vibe: partnershipData?.vibe
    },
  };
}

/**
 * The main orchestrator for the entire brand search process.
 */
async function runBrandSearchOrchestrator(intent, { add, knownProjectName, userMessage, mcpThinking, conversationContext }) {
  let projectName;
  let extractedData = {};
  
  // STEP 1: ALWAYS extract the project name from the CURRENT user message FIRST.
  if (openAIApiKey) {
    try {
      const extractionPrompt = `Analyze the following production details. Extract the primary title, a brief synopsis, and a list of key cast members or performers. Use null for any missing fields.

**Text:**
\`\`\`
${userMessage}
\`\`\`

**JSON Output:**
\`\`\`json
{
  "title": "...",
  "synopsis": "...",
  "cast": ["...", "..."]
}
\`\`\``;
      
      const extractResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a data extraction assistant. Extract production information and return ONLY valid JSON. Be precise and extract exactly what is mentioned.' },
            { role: 'user', content: extractionPrompt }
          ],
          temperature: 0.1,
          max_tokens: 300
        })
      });
      
      if (extractResponse.ok) {
        const extractResult = await extractResponse.json();
        const extracted = extractJson(extractResult.choices?.[0]?.message?.content);
        if (extracted) {
          extractedData = extracted;
          console.log('[runBrandSearchOrchestrator] AI extraction found:', extracted.title);
        }
      }
    } catch (error) {
      console.error('[runBrandSearchOrchestrator] Error extracting data:', error);
    }
  }
  
  const projectNameFromMessage = extractedData.title;
  
  // STEP 2: DECIDE which project name to use.
  if (projectNameFromMessage) {
    // If the new message contains a project, ALWAYS use it.
    projectName = projectNameFromMessage;
    if (knownProjectName && projectName.toLowerCase() !== knownProjectName.toLowerCase()) {
      add({ type: 'info', text: `🎬 Prioritizing "${projectName}" from your new message.` });
      console.log('[runBrandSearchOrchestrator] Overriding old context:', knownProjectName, 'with new:', projectName);
    } else {
      add({ type: 'info', text: `🔍 Searching for "${projectName}"` });
    }
  } else if (knownProjectName) {
    // ONLY if the new message does NOT contain a project, fall back to the old context.
    projectName = knownProjectName;
    add({ type: 'info', text: `🔄 Continuing with previous project: "${projectName}".` });
    console.log('[runBrandSearchOrchestrator] No project in message, using known:', projectName);
  } else {
    // Stage 1: High-Confidence Regex (Fast Lane) - only as last resort
    const explicitMatch = userMessage.match(/(?:title|project)\s*[:\-]?\s*["']([^"']+)["']/i);
    if (explicitMatch) {
      projectName = explicitMatch[1].trim();
      console.log('[runBrandSearchOrchestrator] Fast lane: extracted project name from explicit pattern:', projectName);
      add({ type: 'info', text: `🔍 Found project: "${projectName}"` });
    }
  }
  
  // Validate we have a project name before proceeding
  if (!projectName) {
    add({ type: 'error', text: '❌ Could not identify a project to search for.' });
    console.error('[runBrandSearchOrchestrator] No project name found in message or context');
    return {
      mcpThinking,
      organizedData: {
        dataType: 'BRAND_RECOMMENDATIONS',
        detailedBrands: [],
        brandSuggestions: [],
        projectName: null,
        partnershipData: null,
        error: 'No project identified'
      },
    };
  }
  
  console.log('[runBrandSearchOrchestrator] Final project name to use:', projectName);
  
  // First, try to fetch partnership data from HubSpot if we have a project name
  let partnershipData = null;
  if (projectName && hubspotAPI?.getPartnershipForProject) {
    add({ type: 'info', text: `🔍 Searching HubSpot for partnership: "${projectName}"` });
    try {
      console.log('[runBrandSearchOrchestrator] Attempting to fetch partnership for:', projectName);
      partnershipData = await hubspotAPI.getPartnershipForProject(projectName);
      console.log('[runBrandSearchOrchestrator] Initial search result:', partnershipData ? 'Found' : 'Not found');
      
      if (partnershipData) {
        add({ type: 'result', text: `✅ Found partnership data in HubSpot for "${projectName}"` });
        console.log('[runBrandSearchOrchestrator] Partnership data found with fields:', Object.keys(partnershipData || {}));
      } else {
        console.log('[runBrandSearchOrchestrator] No partnership found for:', projectName, '- trying variations');
        // Try alternative search variations
        const alternativeNames = [];
        if (projectName) {
          // Try common variations
          alternativeNames.push(
            projectName.replace(/reboot/i, '').trim(), // Remove "reboot"
            projectName.replace(/\s+\d+$/, '').trim(), // Remove trailing numbers
            projectName.replace(/\s+/g, ' ').trim(), // Normalize spaces
          );
          
          // If it has a number at the end, try incrementing/decrementing it
          const numberMatch = projectName.match(/(.*?)(\d+)$/);
          if (numberMatch) {
            const base = numberMatch[1].trim();
            const num = parseInt(numberMatch[2]);
            if (num > 1) alternativeNames.push(`${base} ${num - 1}`);
            alternativeNames.push(`${base} ${num + 1}`);
          }
          
          // If it mentions "reboot", try with a number
          if (projectName.toLowerCase().includes('reboot')) {
            const baseWithoutReboot = projectName.replace(/reboot/i, '').trim();
            alternativeNames.push(`${baseWithoutReboot} 2`);
            alternativeNames.push(`${baseWithoutReboot} 3`);
          }
        }
        
        // Remove duplicates
        const uniqueAlternatives = [...new Set(alternativeNames)].filter(name => name && name !== projectName);
        console.log('[runBrandSearchOrchestrator] Trying alternative names:', uniqueAlternatives);
        
        for (const altName of uniqueAlternatives) {
          console.log('[runBrandSearchOrchestrator] Trying alternative:', altName);
          partnershipData = await hubspotAPI.getPartnershipForProject(altName);
          console.log('[runBrandSearchOrchestrator] Alternative result:', partnershipData);
          
          if (partnershipData) {
            add({ type: 'result', text: `✅ Found partnership data under: ${altName}` });
            // Only update if we didn't already have a project name from the user
            if (!knownProjectName) {
              projectName = altName;
            }
            break;
          }
        }
      }
    } catch (error) {
      console.error('[runBrandSearchOrchestrator] Error fetching partnership data:', error);
    }
  }
  
  console.log('[runBrandSearchOrchestrator] Final partnershipData:', partnershipData);
  
  // Merge all data sources (HubSpot takes priority over extracted)
  const finalPartnershipData = {
    title: projectName || extractedData.title || null,
    distributor: partnershipData?.distributor || partnershipData?.studio || extractedData.distributor || null,
    releaseDate: partnershipData?.releaseDate || partnershipData?.release_date || extractedData.releaseDate || null,
    productionStartDate: partnershipData?.startDate || partnershipData?.production_start_date || null,
    productionType: partnershipData?.productionType || partnershipData?.production_type || null,
    location: partnershipData?.location || null,
    cast: partnershipData?.cast || extractedData.cast || null,  // Now properly uses extracted cast
    vibe: partnershipData?.vibe || partnershipData?.genre_production || partnershipData?.genre || null,  // Pull genre for vibe
    budget: partnershipData?.budget || null,
    synopsis: partnershipData?.synopsis || extractedData.synopsis || null
  };
  
  console.log('[runBrandSearchOrchestrator] Merged partnership data:', finalPartnershipData);
  
  // Add debug step to show what production data we have
  const productionDataInfo = [];
  if (finalPartnershipData.distributor) productionDataInfo.push(`Studio: ${finalPartnershipData.distributor}`);
  if (finalPartnershipData.releaseDate) productionDataInfo.push(`Release: ${finalPartnershipData.releaseDate}`);
  if (finalPartnershipData.cast) {
    const castDisplay = Array.isArray(finalPartnershipData.cast) 
      ? finalPartnershipData.cast.join(', ') 
      : finalPartnershipData.cast;
    productionDataInfo.push(`Cast: ${castDisplay}`);
  }
  if (finalPartnershipData.location) productionDataInfo.push(`Location: ${finalPartnershipData.location}`);
  if (finalPartnershipData.vibe) productionDataInfo.push(`Vibe: ${finalPartnershipData.vibe}`);
  
  if (productionDataInfo.length > 0) {
    add({ type: 'info', text: `🎬 Production: ${productionDataInfo.join(', ')}` });
  }
  
  const dataPools = await fetchAllBrandData(intent, { add, knownProjectName, userMessage, partnershipData: finalPartnershipData });
  const allRankedBrands = rankAndCombineBrands(dataPools, {
    search_term: intent.args.search_term,
    add,
  });
  
  // Smart selection logic for exactly 2 diverse brands for creative pitches
  const brandsForPitching = [];
  const seenIds = new Set();

  if (allRankedBrands.length > 0) {
    // 1. The top-ranked brand overall - your most likely winner
    const topBrand = allRankedBrands[0];
    brandsForPitching.push(topBrand);
    seenIds.add(topBrand.id);

    // 2. The highest-ranked brand that is a PURE CONTEXT match from the AI search
    //    and isn't the same as the top brand. This ensures a relevant, diverse idea.
    const bestContextMatch = allRankedBrands.find(
      b => !seenIds.has(b.id) && 
      (b.tags?.includes('🎯 Genre Match') || 
       b.tags?.includes('🎭 Vibe Match') ||
       b.tags?.includes('🎯 Perfect Context Match'))
    );

    if (bestContextMatch) {
      brandsForPitching.push(bestContextMatch);
    } else if (allRankedBrands.length > 1) {
      // Fallback: if no pure context match, take the second-highest ranked
      brandsForPitching.push(allRankedBrands[1]);
    }
  }
  
  // Ensure we only pass maximum 2 brands for pitches
  const creativeResult = await generateCreativeContent(brandsForPitching.slice(0, 2), {
    add,
    actualProjectName: knownProjectName || projectName, // Use original name if provided, else what we found
    search_term: intent.args.search_term,
    partnershipData: finalPartnershipData,
  });

  return prepareFrontendPayload({
    enrichedBrands: creativeResult.enrichedBrands,
    allRankedBrands,
    mcpThinking: mcpThinking,
    projectName: knownProjectName || projectName, // Use original name if provided, else what we found
    partnershipData: finalPartnershipData, // Pass the actual partnership data
    finalReplyText: creativeResult.finalReplyText, // Pass the final formatted text
  });
}

/**
 * Main handler (REWRITTEN). This is the only exported handler to keep.
 */
export async function handleClaudeSearch(
  userMessage,
  projectId,
  conversationContext,
  lastProductionContext,
  knownProjectName,
  runId,
  onStep = () => {}
) {
  console.log('[handleClaudeSearch] Entry with knownProjectName:', knownProjectName);
  console.log('[handleClaudeSearch] userMessage:', userMessage);
  
  // Ensure HubSpot is ready (cold start)
  if (hubspotAPI?.initialize) {
    console.log('[handleClaudeSearch] Initializing HubSpot API...');
    await hubspotAPI.initialize().catch((err) => {
      console.error('[handleClaudeSearch] HubSpot initialization failed:', err);
    });
  }

  const mcpThinking = [];
  const add = (step) => {
    mcpThinking.push(step);
    try {
      onStep(step);
    } catch {}
  };

  const intent = await routeUserIntent(userMessage, conversationContext, lastProductionContext);
  if (!intent) return null;

  switch (intent.tool) {
    case 'find_brands': {
      return await runBrandSearchOrchestrator(intent, {
        add,
        knownProjectName,
        userMessage,
        mcpThinking, // Already present, confirming it's passed through
        conversationContext,
      });
    }

    case 'get_brand_activity': {
      const query = intent.args.brand_name || userMessage;
      add({ type: 'start', text: `📇 Pulling communications for: ${query}` });

      const terms = uniqShort([query], 7);
      const [ffData, emData] = await Promise.all([
        firefliesApiKey
          ? withTimeout(searchFireflies(terms, { limit: 20 }), 6000, { transcripts: [] })
          : { transcripts: [] },
        withTimeout(o365API.searchEmails(terms, { limit: 20 }), 6000, {
          emails: [],
          o365Status: 'timeout',
        }),
      ]);

      const meetings = ffData.transcripts || [];
      const emails = emData.emails || [];

      add({
        type: 'result',
        text: `📊 Communications: ${meetings.length} meetings, ${emails.length} emails`,
      });

      const communications = [
        ...meetings.map((m) => ({
          type: 'meeting',
          title: m.title,
          date: m.dateString,
          url: m.transcript_url,
          raw: m,
        })),
        ...emails.map((e) => ({
          type: 'email',
          title: e.subject,
          date: e.receivedDate,
          from: e.fromName || e.from,
          raw: e,
        })),
      ].sort((a, b) => new Date(b.date) - new Date(a.date));

      return {
        mcpThinking,
        organizedData: {
          dataType: 'BRAND_ACTIVITY',
          brand: query,
          communications,
        },
      };
    }

    case 'create_pitches_for_brands': {
      const brands = intent.args.brand_names || [];
      add({ type: 'start', text: `🧠 Generating pitch structure for: ${brands.join(', ')}` });

      return {
        mcpThinking,
        organizedData: {
          dataType: 'PITCH_REQUEST',
          brands,
          context: lastProductionContext || conversationContext || '',
        },
      };
    }

    case 'answer_general_question':
    default:
      return null;
  }
}
