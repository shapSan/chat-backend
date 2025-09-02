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
export function buildSearchTerms({ title, distributor, talent = [], keywords = [] }) {
  const fieldEntities = [title, distributor, ...talent.slice(0, 3)].filter(Boolean);
  const base = Array.isArray(keywords) ? keywords : String(keywords || '').split(/[,\|]/);
  const commsTerms = uniqShort([...fieldEntities, ...base], 7); // entities then keywords
  const hubspotTerms = uniqShort([...base, title].filter(Boolean), 8); // keywords then title
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
  existingRecordId
) {
  try {
    let conversationToSave = updatedConversation;
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
  activityBrands,
  synopsisBrands,
  genreBrands,
  activeBrands,
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
      secondary_owner: brand.properties?.secondary_owner || brand.secondaryOwnerId || null,
      specialty_lead: brand.properties?.specialty_lead || brand.specialtyLeadId || null,
      // Also keep the camelCase versions for compatibility
      secondaryOwnerId: brand.properties?.secondary_owner || brand.secondaryOwnerId || null,
      specialtyLeadId: brand.properties?.specialty_lead || brand.specialtyLeadId || null,
      tags: [primaryTag],
      relevanceScore: 90,
      reason,
      insight: contextData,
    });
  };

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
      br.relevanceScore = Math.min(98, br.relevanceScore + 5);
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
      br.relevanceScore = Math.min(98, br.relevanceScore + 4);
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
      br.relevanceScore = Math.min(98, br.relevanceScore + 8);
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
        relevanceScore: 70,
        reason: pitch,
        isWildcard: true,
      });
    });
  }

  const sorted = Array.from(brandMap.values()).sort((a, b) => b.relevanceScore - a.relevanceScore);

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
async function fetchAllBrandData(intent, { add, knownProjectName, userMessage }) {
  add({ type: 'start', text: '🔎 Beginning data acquisition...' });

  const search_term = intent.args.search_term || userMessage;
  const synopsisKeywords = await extractKeywordsForHubSpot(search_term);
  add({ type: 'info', text: `🔑 Extracted Keywords: ${synopsisKeywords || 'none'}` });
  const { commsTerms, hubspotTerms } = buildSearchTerms({
    title: knownProjectName,
    keywords: synopsisKeywords ? synopsisKeywords.split(' ') : [],
  });

  const searchBrandsWithRetry = async (params) => {
    try {
      return await hubspotAPI.searchBrands(params);
    } catch (e) {
      console.error('[searchBrandsWithRetry] HubSpot search failed:', e.message);
      return { results: [] }; // Return empty on error
    }
  };

  const [hubspotResults, commsResults, wildcardResults] = await Promise.all([
    // HubSpot searches
    Promise.allSettled([
      withTimeout(
        searchBrandsWithRetry({ query: hubspotTerms.join(' '), limit: 15 }),
        8000,
        { results: [] }
      ),
      withTimeout(
        searchBrandsWithRetry({
          limit: 15,
          sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
        }),
        5000,
        { results: [] }
      ),
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
      ),
    ]),
    // Communications searches
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

  const synopsisCount = hubspotResults[0].status === 'fulfilled' ? hubspotResults[0].value.results.length : 0;
  const genreCount = hubspotResults[1].status === 'fulfilled' ? hubspotResults[1].value.results.length : 0;
  const activeCount = hubspotResults[2].status === 'fulfilled' ? hubspotResults[2].value.results.length : 0;
  const meetingCount = commsResults[0].status === 'fulfilled' ? commsResults[0].value.transcripts.length : 0;
  const emailCount = commsResults[1].status === 'fulfilled' ? commsResults[1].value.emails.length : 0;

  add({ type: 'result', text: `📊 HubSpot Found: ${synopsisCount} synopsis matches, ${activeCount} active clients.` });
  add({ type: 'result', text: `📧 Comms Found: ${meetingCount} meetings, ${emailCount} emails.` });

  return {
    synopsisBrands: hubspotResults[0].status === 'fulfilled' ? hubspotResults[0].value : { results: [] },
    genreBrands: hubspotResults[1].status === 'fulfilled' ? hubspotResults[1].value : { results: [] },
    activeBrands: hubspotResults[2].status === 'fulfilled' ? hubspotResults[2].value : { results: [] },
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
  const { synopsisBrands, genreBrands, activeBrands, wildcardBrands, communications } = dataPools;

  const finalBrands = tagAndCombineBrands({
    synopsisBrands,
    genreBrands,
    activeBrands,
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
async function generateCreativeContent(topBrands, { add, actualProjectName, search_term }) {
  if (!topBrands || topBrands.length === 0) return [];
  add({ type: 'process', text: '✍️ Generating creative content...' });

  const creativePrompt = `Create brand partnership recommendations for "${actualProjectName}"\n\n${search_term}\n\nI need creative integration ideas for these ${topBrands.length} brands:\n\n${topBrands
    .map(
      (brand, idx) =>
        `${idx + 1}. Brand: ${brand.name}\nCategory: ${brand.category}\nTrack Record: ${brand.partnershipCount} partnerships, ${brand.dealsCount} deals`
    )
    .join('\n\n')}\n\nFor EACH brand listed above, write EXACTLY in this format:\n\nBrand: [Exact Brand Name]\nIntegration: [1-2 sentences about product placement]\nWhy it works: [1-2 sentences about brand fit]\nHB Insights: [1-2 sentences about partnership potential]\n\nIMPORTANT: You MUST provide content for ALL ${topBrands.length} brands.`;

  let creativeTextResponse = '';
  try {
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a creative brand partnership specialist. Always provide complete responses for ALL brands requested.' },
          { role: 'user', content: creativePrompt },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      }),
    });
    if (aiResponse.ok) {
      const data = await aiResponse.json();
      creativeTextResponse = data.choices?.[0]?.message?.content || '';
      if (creativeTextResponse) {
        add({ type: 'checkpoint', text: `✍️ Creative pitches generated for top ${topBrands.length} brands.` });
      }
    }
  } catch (error) {
    console.error('[Creative AI] Fetch failed:', error.message);
  }

  // Parse the AI response and merge with original data, preserving the ID
  const brandSections = creativeTextResponse.split(/^Brand:/m).filter((s) => s.trim());
  
  return topBrands.map((originalBrandData, idx) => {
    // Try to find the section for this brand
    let section = null;
    
    // First try exact name match
    section = brandSections.find((s) => {
      const firstLine = s.split('\n')[0].trim();
      return firstLine.toLowerCase().includes(originalBrandData.name.toLowerCase());
    });
    
    // If not found, try by index (assuming AI responded in order)
    if (!section && brandSections[idx]) {
      section = brandSections[idx];
    }
    
    // If still no section or empty response, generate smart defaults
    if (!section || !creativeTextResponse) {
      const category = originalBrandData.category || 'General';
      const partnershipCount = originalBrandData.partnershipCount || '0';
      const dealsCount = originalBrandData.dealsCount || '0';
      
      // Generate intelligent defaults based on brand data
      const integrationText = category.toLowerCase().includes('food') || category.toLowerCase().includes('beverage')
        ? `Strategic product placement woven naturally into the storyline, featuring ${originalBrandData.name} in key social and family scenes.`
        : category.toLowerCase().includes('tech') || category.toLowerCase().includes('electronics')
        ? `Seamless integration of ${originalBrandData.name}'s innovative technology as essential plot devices and character tools.`
        : category.toLowerCase().includes('fashion') || category.toLowerCase().includes('apparel')
        ? `Wardrobe partnership featuring ${originalBrandData.name} to define character personalities and visual storytelling.`
        : `Strategic product placement for ${originalBrandData.name} integrated naturally into key scenes.`;
      
      const whyItWorksText = parseInt(partnershipCount) > 50
        ? `Perfect alignment with production values and target audience. ${originalBrandData.name}'s extensive entertainment experience ensures seamless integration.`
        : parseInt(partnershipCount) > 10
        ? `Strong brand-production synergy with proven entertainment partnership track record.`
        : `Natural fit with the production's themes and demographic appeal.`;
      
      const insightsText = parseInt(partnershipCount) > 0 || parseInt(dealsCount) > 0
        ? `Strong partnership potential based on ${partnershipCount} past collaborations and ${dealsCount} active deals.`
        : `Emerging partnership opportunity with high growth potential in entertainment integrations.`;
      
      return {
        ...originalBrandData,
        content: [
          `Integration: ${integrationText}`,
          `Why it works: ${whyItWorksText}`,
          `HB Insights: ${insightsText}`,
        ],
        // Preserve HubSpot user IDs
        secondary_owner: originalBrandData.secondary_owner || originalBrandData.secondaryOwnerId || null,
        specialty_lead: originalBrandData.specialty_lead || originalBrandData.specialtyLeadId || null,
        secondaryOwnerId: originalBrandData.secondary_owner || originalBrandData.secondaryOwnerId || null,
        specialtyLeadId: originalBrandData.specialty_lead || originalBrandData.specialtyLeadId || null
      };
    }

    // Parse the section content
    const contentLines = [];
    const integrationMatch = section.match(
      /Integration:\s*([\s\S]*?)(?=Why it works:|HB Insights:|$)/i
    );
    const whyMatch = section.match(/Why it works:\s*([\s\S]*?)(?=Integration:|HB Insights:|$)/i);
    const insightsMatch = section.match(/HB Insights:\s*([\s\S]*?)(?=Integration:|Why it works:|$)/i);

    if (integrationMatch) contentLines.push(`Integration: ${integrationMatch[1].trim()}`);
    if (whyMatch) contentLines.push(`Why it works: ${whyMatch[1].trim()}`);
    if (insightsMatch) contentLines.push(`HB Insights: ${insightsMatch[1].trim()}`);

    // If parsing failed, use smart defaults
    if (contentLines.length === 0) {
      const category = originalBrandData.category || 'General';
      const partnershipCount = originalBrandData.partnershipCount || '0';
      
      contentLines.push(
        `Integration: Strategic ${originalBrandData.name} placement integrated into key production moments.`,
        `Why it works: Strong alignment between ${originalBrandData.name} and production themes.`,
        `HB Insights: ${partnershipCount} previous partnerships demonstrate proven entertainment value.`
      );
    }

    return {
      ...originalBrandData,
      content: contentLines,
      // Preserve HubSpot user IDs
      secondary_owner: originalBrandData.secondary_owner || originalBrandData.secondaryOwnerId || null,
      specialty_lead: originalBrandData.specialty_lead || originalBrandData.specialtyLeadId || null,
      secondaryOwnerId: originalBrandData.secondary_owner || originalBrandData.secondaryOwnerId || null,
      specialtyLeadId: originalBrandData.specialty_lead || originalBrandData.specialtyLeadId || null
    };
  });
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
    // Ensure we preserve the HubSpot user IDs
    return { 
      ...brand, 
      id: String(id),
      // Preserve both naming conventions for compatibility
      secondary_owner: brand.secondary_owner || brand.secondaryOwnerId || null,
      specialty_lead: brand.specialty_lead || brand.specialtyLeadId || null,
      secondaryOwnerId: brand.secondary_owner || brand.secondaryOwnerId || null,
      specialtyLeadId: brand.specialty_lead || brand.specialtyLeadId || null
    };
  };

  const detailedBrands = enrichedBrands.map(ensureId);
  const brandSuggestions = allRankedBrands.map(ensureId);

  return {
    mcpThinking,
    organizedData: {
      dataType: 'BRAND_RECOMMENDATIONS',
      detailedBrands,
      brandSuggestions,
      projectName,
      partnershipData,
    },
  };
}

/**
 * The main orchestrator for the entire brand search process.
 */
async function runBrandSearchOrchestrator(intent, { add, knownProjectName, userMessage, mcpThinking }) {
  const dataPools = await fetchAllBrandData(intent, { add, knownProjectName, userMessage });
  const allRankedBrands = rankAndCombineBrands(dataPools, {
    search_term: intent.args.search_term,
    add,
  });
  const top2Brands = allRankedBrands.slice(0, 2);
  const enrichedBrands = await generateCreativeContent(top2Brands, {
    add,
    actualProjectName: knownProjectName,
    search_term: intent.args.search_term,
  });

  return prepareFrontendPayload({
    enrichedBrands,
    allRankedBrands,
    mcpThinking: mcpThinking, // FIXED: Pass actual mcpThinking instead of empty array
    projectName: knownProjectName,
    partnershipData: null, // This would be fetched in a real implementation
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
  // Ensure HubSpot is ready (cold start)
  if (hubspotAPI?.testConnection) {
    const ok = await hubspotAPI.testConnection().catch(() => false);
    if (!ok && hubspotAPI.initialize) {
      await hubspotAPI.initialize().catch(() => {});
    }
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
