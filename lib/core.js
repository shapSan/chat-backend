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
  generateWildcardBrands
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
          "Use when user wants to see communications (emails/meetings) about a specific brand, person, or partnership. ALWAYS use for requests about emails OR meetings OR both.",
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
        description:
          'Use when user wants detailed integration ideas for specific named brands.',
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
        const vagueTerms = ['this project', 'this production', 'more brands', 'additional brands', 'other brands'];
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
export async function narrowWithIntelligentTagsOpenAI(hubspotBrands, firefliesTranscripts, emails, userMessage) {
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
          hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI?.portalId || process.env.HUBSPOT_PORTAL_ID || '0'}/company/${brand.id}`,
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

export async function narrowWithIntelligentTags(hubspotBrands, firefliesTranscripts, emails, userMessage) {
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
        messages: [{ role: 'user', content: `${systemPrompt}\n\n${userPrompt}\n\nIMPORTANT: Return ONLY brands from the input list.` }],
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
          hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI?.portalId || process.env.HUBSPOT_PORTAL_ID || '0'}/company/${originalBrand.id}`,
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
          const segments = [{ type: 'text', content: `Recent email from ${email.fromName || email.from}: "${email.subject}" (${date})` }];
          return { segments, rawText: segments[0].content };
        }
      }
    }
    return null;
  };

  const generatePitch = (brand, synopsisText) => {
    const category = (brand.category || '').toLowerCase();
    const genre = extractGenreFromSynopsis(synopsisText);
    if (category.includes('automotive') && genre === 'action') return 'Hero car for chase sequences - proven track record with action films';
    if (category.includes('fashion') && (genre === 'drama' || genre === 'romance'))
      return 'Wardrobe partner for character development - luxury meets storytelling';
    if (category.includes('tech') && genre === 'scifi') return 'Future-tech integration - product as narrative device';
    if (category.includes('beverage') && genre === 'comedy') return 'Social scenes product placement - natural comedy moments';
    if (parseInt(brand.partnershipCount) > 10) return `${brand.partnershipCount} successful integrations - knows entertainment value`;
    if (brand.clientType === 'Retainer') return 'Retainer client with flexible integration budget';
    if (parseInt(brand.dealsCount) > 5) return `Active in ${brand.dealsCount} current productions - high engagement`;
    return `${brand.category} leader - natural fit for ${genre || 'this'} production`;
    };

  const addBrandBase = (id, brand, primaryTag, reason, contextData) => {
    // Ensure ID is always a string
    const brandId = id ? String(id) : `brand-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
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
      hubspotUrl: brand.hubspotUrl || `https://app.hubspot.com/contacts/${hubspotAPI?.portalId || process.env.HUBSPOT_PORTAL_ID || '0'}/company/${brandId}`,
      oneSheetLink: brand.properties?.one_sheet_link || brand.oneSheetLink || null,
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
    const brandId = b.id ? String(b.id) : `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextData = findBrandContext(b.properties?.brand_name || b.name || '');
    if (!brandMap.has(brandId)) {
      addBrandBase(brandId, b, '📧 Recent Activity', `Recent engagement - last activity ${new Date(b.properties?.hs_lastmodifieddate || b.lastActivity || Date.now()).toLocaleDateString()}`, contextData);
    }
  });

  synopsisBrands?.results?.forEach((b) => {
    const brandId = b.id ? String(b.id) : `synopsis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
    const brandId = b.id ? String(b.id) : `genre-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
    const brandId = b.id ? String(b.id) : `active-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
      else if (nameLower.includes('sustainable')) pitch = 'ESG story angle - sustainability messaging opportunity';

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
    const hashCode = synopsis.split('').reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0);
    const jitter = (Math.abs(hashCode) % 7) - 3; // -3..+3
    targetSize = Math.max(12, Math.min(20, 15 + jitter));
  }

  return sorted.slice(0, Math.min(targetSize, sorted.length));
}

/* =========================
 * MAIN ORCHESTRATOR
 * ======================= */
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
  if (!intent || intent.tool === 'answer_general_question') return null;

  try {
    switch (intent.tool) {
      case 'find_brands': {
        // STEP 1: EXTRACT THE CORRECT PROJECT NAME - FULL NAME, NOT PARTIAL
        let actualProjectName = knownProjectName;
        let partnershipMetadata = null;
        
        if (!actualProjectName) {
          // Enhanced patterns to capture COMPLETE project names
          const projectPatterns = [
            // Capture everything in quotes
            /["']([^"']+)["']/,
            // Pattern for "Title: Full Project Name" - STOP AT SYNOPSIS
            /(?:Title|Project|Film|Movie|Show):\s*([^\n,]+?)(?:\s*Synopsis:|\s*$)/i,
            // Pattern for "for/about Full Project Name"
            /(?:for|about|called|titled)\s+([A-Z][^,\n.]+?)(?:\s+(?:movie|film|show|series|production|reboot|remake|sequel))/i,
            // Look for a capitalized phrase at the beginning followed by a line break
            /^([A-Z][^\n]+?)\n/,
            // Pattern for "Full Project Name reboot/movie/etc" - STOP AT SYNOPSIS or newline
            /^([A-Z][^,\n.]+?)(?:\s+(?:reboot|remake|sequel|series|movie|film|show|production))?(?:\s*Synopsis:|\n|\s*$)/i,
            // Look for capitalized multi-word phrases - STOP AT SYNOPSIS or descriptive text
            /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*?)(?:\s*Synopsis:|\s*A\s+|\s*The\s+|\n|\s*$)/
          ];
          
          for (const pattern of projectPatterns) {
            const match = userMessage.match(pattern);
            if (match && match[1]) {
              const candidate = match[1].trim();
              // Clean up common issues
              const cleaned = candidate.replace(/\s*Synopsis\s*$/i, '').trim();
              
              // Skip if it looks like a sentence (contains "will", "would", "can", etc.)
              const sentenceWords = /\b(will|would|can|could|should|but|with|and can|tomorrow)\b/i;
              if (sentenceWords.test(cleaned)) {
                continue;
              }
              
              // Accept if it's a reasonable project name
              if (cleaned && (cleaned.split(' ').length <= 5 || cleaned.length <= 50)) {
                actualProjectName = cleaned;
                break;
              }
            }
          }
          
          // Fallback defaults
          if (!actualProjectName || actualProjectName.split(' ').length === 1) {
            // Extract genre first for better fallback
            const genre = extractGenreFromSynopsis(userMessage);
            if (genre) {
              actualProjectName = `${genre.charAt(0).toUpperCase() + genre.slice(1)} Production Project`;
            } else {
              actualProjectName = 'Brand Partnership Project';
            }
          }
        }
        
        add({ type: 'process', text: `📽️ Project identified: "${actualProjectName}"` });
        
        // Try to get partnership metadata if we have a project name
        if (actualProjectName && hubspotAPI.getPartnershipForProject) {
          try {
            partnershipMetadata = await withTimeout(
              hubspotAPI.getPartnershipForProject(actualProjectName),
              3000,
              null
            );
            if (partnershipMetadata?.distributor) {
              add({ type: 'info', text: `🎬 Found partnership data: ${partnershipMetadata.distributor}` });
            }
          } catch (e) {
            console.log('[Partnership lookup] Failed:', e);
          }
        }

        // STEP 2: FIND BRAND CANDIDATES (existing search logic)
        const hasStructuredFields = /Synopsis:|Distributor:|Talent:|Location:|Release|Date:|Shoot/i.test(userMessage);
        
        let search_term = intent.args.search_term || userMessage;
        search_term = search_term.replace(/\b(Co-?Pro(?: Only)?|Co-?promo|Send|Taking Fees(?: only)?)\b/gi, '').trim();

        add({ type: 'start', text: hasStructuredFields ? '🎬 Structured production detected.' : '🔎 Freeform search.' });

        const genre = extractGenreFromSynopsis(search_term);
        const synopsisKeywords = await extractKeywordsForHubSpot(search_term);
        if (genre) add({ type: 'process', text: `📊 Detected genre: ${genre}` });
        if (synopsisKeywords) add({ type: 'process', text: `🔑 Keywords: ${synopsisKeywords}` });

        const searches = [
          { type: 'pool', stage: 'search', pool: 'Synopsis', text: '🎯 List 1: Synopsis-matched...' },
          { type: 'pool', stage: 'search', pool: 'Vibe', text: '🎭 List 2: Vibe matches...' },
          { type: 'pool', stage: 'search', pool: 'Hot', text: '💰 List 3: Active big-budget...' },
          { type: 'pool', stage: 'search', pool: 'Cold', text: '🚀 List 4: Creative exploration...' },
        ];
        searches.forEach(add);

        const titleForTerms = actualProjectName;
        let distributorForTerms = '';
        if (/netflix/i.test(search_term)) distributorForTerms = 'Netflix';
        else if (/universal/i.test(search_term)) distributorForTerms = 'Universal';
        else if (/disney/i.test(search_term)) distributorForTerms = 'Disney';
        else if (/warner/i.test(search_term)) distributorForTerms = 'Warner';

        const { commsTerms, hubspotTerms } = buildSearchTerms({
          title: titleForTerms,
          distributor: distributorForTerms,
          keywords: synopsisKeywords ? synopsisKeywords.split(' ') : [],
        });

        const searchBrandsWithRetry = async (searchParams, retries = 1) => {
          try {
            const result = await hubspotAPI.searchBrands(searchParams);
            if (result.results?.length === 0 && retries > 0 && searchParams.query) {
              await new Promise((r) => setTimeout(r, 1000));
              return await hubspotAPI.searchBrands(searchParams);
            }
            return result;
          } catch (e) {
            console.error('[searchBrandsWithRetry] error:', e?.message);
            return { results: [] };
          }
        };

        const [synopsisBrands, genreBrands, activeBrands, wildcardBrands] = await Promise.all([
          withTimeout(
            searchBrandsWithRetry({ query: hubspotTerms.join(' '), limit: 15 }),
            8000,
            { results: [] }
          ),
          withTimeout(
            searchBrandsWithRetry({
              limit: 15,
              filterGroups: genre
                ? [{ filters: [{ propertyName: 'client_status', operator: 'IN', values: ['Active', 'In Negotiation', 'Contract', 'Pending'] }] }]
                : undefined,
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
          withTimeout(generateWildcardBrands(search_term), 8000, []),
        ]);

        [
          { pool: 'Synopsis', data: synopsisBrands },
          { pool: 'Vibe', data: genreBrands },
          { pool: 'Hot', data: activeBrands },
          { pool: 'Cold', data: { results: wildcardBrands } },
        ].forEach(({ pool, data }) =>
          add({ type: 'pool', stage: 'result', pool, pickedCount: data?.results?.length || data?.length || 0 })
        );

        // Supporting context: meetings + emails
        let supportingContext = { meetings: [], emails: [], emailStatus: 'unknown', emailMailbox: 'unknown' };
        const canSearchEmail = !!(msftTenantId && msftClientId && msftClientSecret);
        if (firefliesApiKey || canSearchEmail) {
          add({ type: 'search', text: '📧 Checking related communications...' });

          const [ffRes, emailRes] = await Promise.allSettled([
            firefliesApiKey ? withTimeout(searchFireflies(commsTerms, { limit: 10 }), 5000, { transcripts: [] }) : Promise.resolve({ transcripts: [] }),
            canSearchEmail ? withTimeout(o365API.searchEmails(commsTerms, { days: 90, limit: 12 }), 6000, {
              emails: [],
              o365Status: 'timeout',
              userEmail: null,
            }) : Promise.resolve({ emails: [], o365Status: 'no_credentials' }),
          ]);

          const ffData = ffRes.status === 'fulfilled' ? ffRes.value : { transcripts: [] };
          const emData = emailRes.status === 'fulfilled' ? emailRes.value : { emails: [], o365Status: 'error' };

          supportingContext = {
            meetings: ffData.transcripts || [],
            emails: emData.emails || [],
            emailStatus: emData.o365Status || 'unknown',
            emailMailbox: emData.userEmail || 'unknown',
            meetingsMode: ffData.meetingsMode || 'standard',
          };

          add({
            type: 'result',
            text: `📧 Found ${supportingContext.meetings.length} meetings, ${supportingContext.emails.length} emails`,
          });
          if (supportingContext.emailStatus === 'forbidden_raop') {
            add({ type: 'info', text: `ℹ️ Email search blocked by tenant policy for ${supportingContext.emailMailbox}` });
          }
        }

        add({ type: 'process', text: '🤝 Combining and tagging results...' });

        const finalBrands = tagAndCombineBrands({
          activityBrands: synopsisBrands,
          synopsisBrands,
          genreBrands,
          activeBrands,
          wildcardCategories: wildcardBrands,
          synopsis: search_term,
          context: {
            meetings: supportingContext.meetings,
            emails: supportingContext.emails,
          },
        });
        
        // Debug log to see what IDs we have
        console.log('[Backend] finalBrands IDs:', finalBrands.slice(0, 5).map(b => ({
          id: b.id,
          name: b.name,
          source: b.source
        })));

        // STEP 3: PREPARE DATA FOR BOTH PICKER AND CARDS
        // CRITICAL: Generate reliable string IDs for ALL brands here, once and for all
        // This is the SINGLE SOURCE OF TRUTH for brand IDs - frontend NEVER generates IDs
        const brandsWithGuaranteedIds = finalBrands.map((brand, idx) => {
          let brandId;
          
          // Rule 1: If brand has an ID from HubSpot (numeric or string), convert to string
          if (brand.id && brand.id !== null && brand.id !== undefined) {
            // Ensure it's a string - HubSpot IDs are numeric but we need strings
            brandId = String(brand.id);
          } 
          // Rule 2: Generate a UNIQUE, PREDICTABLE ID from name and index
          else {
            const brandName = brand.name || brand.brand || `brand`;
            const cleanName = brandName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-') // Replace ALL non-alphanumeric with single dash
              .replace(/^-+|-+$/g, '') // Trim leading/trailing dashes
              .substring(0, 30); // Limit length for cleaner IDs
            
            // Include index to GUARANTEE uniqueness even if names are identical
            brandId = `${cleanName || 'brand'}-${idx}`;
          }
          
          console.log(`[Backend ID Generation] Brand: "${brand.name || brand.brand}" -> ID: "${brandId}"`);
          
          // Return the brand with guaranteed string ID
          return {
            ...brand,
            id: brandId, // Guaranteed non-null unique string
            // Also ensure name is set
            name: brand.name || brand.brand || 'Unknown Brand'
          };
        });
        
        // Full list for picker (uses brands with guaranteed IDs)
        const brandSuggestionsForPicker = brandsWithGuaranteedIds.map(brand => ({
          id: brand.id, // Already guaranteed to be a string
          name: brand.name,
          brand: brand.name, // Also include as 'brand' for compatibility
          category: brand.category,
          tags: brand.tags || [],
          hubspotUrl: brand.hubspotUrl || null,
          oneSheetLink: brand.oneSheetLink || null,
          secondaryOwnerId: brand.secondaryOwnerId || null,
          specialtyLeadId: brand.specialtyLeadId || null,
          isInSystem: !!brand.hubspotUrl // Add isInSystem flag here too
        }));
        
        // Top 2 brands for detailed cards (use the ones with guaranteed IDs)
        const top2Brands = brandsWithGuaranteedIds.slice(0, 2);
        
        // STEP 4: EXECUTE THE REAL CREATIVE AI CALL - ACTUAL AIRTABLE PROMPT
        add({ type: 'process', text: '✍️ Calling AI for creative content generation...' });
        
        // Build the ACTUAL Airtable-style creative prompt
        const creativePrompt = `Create brand partnership recommendations for "${actualProjectName}"

${search_term}

I need creative integration ideas for these 2 brands:

${top2Brands.map((brand, idx) => `
Brand: ${brand.name}
Category: ${brand.category}
Current Status: ${brand.clientStatus || 'Potential Partner'}
Track Record: ${brand.partnershipCount || 0} previous partnerships, ${brand.dealsCount || 0} active deals
${brand.tags ? `Tags: ${brand.tags.join(', ')}` : ''}
${brand.reason ? `Match Reason: ${brand.reason}` : ''}
`).join('\n')}

For each brand, write exactly in this format:

Brand: [Brand Name]
Integration: [Write 1-2 sentences describing specific, creative ways to integrate this brand into the production. Focus on narrative integration, product placement opportunities, and marketing synergies.]
Why it works: [Write 1-2 sentences explaining why this brand is perfect for this specific production, considering genre, themes, and target audience.]
HB Insights: [Write 1-2 sentences with data-driven insights about the brand's partnership history and current engagement level.]

Make the content creative, specific, and compelling. Focus on storytelling opportunities and marketing potential.`;

        // Make the ACTUAL API call to get creative content
        let creativeTextResponse = '';
        
        try {
          if (openAIApiKey) {
            const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openAIApiKey}`
              },
              body: JSON.stringify({
                model: MODELS.openai.chat || 'gpt-4',
                messages: [
                  { 
                    role: 'system', 
                    content: 'You are a creative brand partnership specialist who writes compelling, specific integration ideas for film and TV productions. Focus on narrative opportunities and marketing synergies.' 
                  },
                  { role: 'user', content: creativePrompt }
                ],
                temperature: 0.8,
                max_tokens: 1200
              })
            });
            
            if (aiResponse.ok) {
              const data = await aiResponse.json();
              creativeTextResponse = data.choices?.[0]?.message?.content || '';
              add({ type: 'process', text: '✅ Creative content received from OpenAI' });
            }
          } else if (anthropicApiKey) {
            const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicApiKey,
                'anthropic-version': '2023-06-01'
              },
              body: JSON.stringify({
                model: MODELS.anthropic.claude || 'claude-3-opus-20240229',
                messages: [{ role: 'user', content: creativePrompt }],
                max_tokens: 1200,
                temperature: 0.8
              })
            });
            
            if (aiResponse.ok) {
              const data = await aiResponse.json();
              creativeTextResponse = data.content?.[0]?.text || '';
              add({ type: 'process', text: '✅ Creative content received from Claude' });
            }
          }
        } catch (error) {
          console.error('[Creative AI Generation] Failed:', error);
          add({ type: 'error', text: '⚠️ AI generation failed, using enhanced defaults' });
        }
        
        // STEP 5: PARSE THE CREATIVE RESPONSE AND POPULATE WITH REAL CONTENT
        let parsedBrands = [];
        
        if (creativeTextResponse && creativeTextResponse.length > 50) {
          // Parse the actual creative response
          const brandSections = creativeTextResponse.split(/^Brand:/m).filter(s => s.trim());
          
          parsedBrands = brandSections.slice(0, 2).map((section, idx) => {
            const lines = section.split('\n').map(l => l.trim()).filter(l => l);
            
            // Extract brand name from first line
            const brandName = lines[0]?.replace(/^Brand:\s*/i, '').trim() || 
                            top2Brands[idx]?.name || 
                            `Brand ${idx + 1}`;
            
            // Extract the creative content lines
            const content = [];
            let currentLine = '';
            
            for (const line of lines) {
              if (line.startsWith('Integration:')) {
                if (currentLine) content.push(currentLine);
                currentLine = line;
              } else if (line.startsWith('Why it works:')) {
                if (currentLine) content.push(currentLine);
                currentLine = line;
              } else if (line.startsWith('HB Insights:')) {
                if (currentLine) content.push(currentLine);
                currentLine = line;
              } else if (currentLine && !line.startsWith('Brand:')) {
                // Continuation of previous line
                currentLine += ' ' + line;
              }
            }
            if (currentLine) content.push(currentLine);
            
            // Ensure we have all three required sections
            const hasIntegration = content.some(c => c.includes('Integration:'));
            const hasWhyItWorks = content.some(c => c.includes('Why it works:'));
            const hasInsights = content.some(c => c.includes('HB Insights:'));
            
            if (!hasIntegration || !hasWhyItWorks || !hasInsights) {
              // AI response was incomplete, add missing sections
              const brand = top2Brands[idx];
              if (!hasIntegration) {
                content.unshift(`Integration: Strategic ${brand.category} placement throughout ${actualProjectName}, with hero product moments in key scenes and co-branded marketing campaigns.`);
              }
              if (!hasWhyItWorks) {
                content.push(`Why it works: Perfect alignment with ${genre || 'production'} genre, reaching the exact demographic ${brand.name} targets while enhancing the narrative authenticity.`);
              }
              if (!hasInsights) {
                content.push(`HB Insights: ${brand.partnershipCount} successful partnerships demonstrate proven entertainment marketing expertise, with ${brand.dealsCount} active deals showing strong current momentum.`);
              }
            }
            
            // Get the original brand data from the top2Brands array using the index
            const originalBrandData = top2Brands[idx];
            
            // Use the ID that was already guaranteed in brandsWithGuaranteedIds
            return {
              id: originalBrandData.id, // Already guaranteed to be a string from brandsWithGuaranteedIds
              name: brandName,
              brand: brandName, // Also include as 'brand' for compatibility
              content: content,
              hubspotUrl: originalBrandData?.hubspotUrl || null,
              oneSheetLink: originalBrandData?.oneSheetLink || null,
              secondaryOwnerId: originalBrandData?.secondaryOwnerId || null,
              specialtyLeadId: originalBrandData?.specialtyLeadId || null,
              isInSystem: !!originalBrandData?.hubspotUrl // Add isInSystem flag
            };
          });
          
          // Ensure we have 2 brands
          while (parsedBrands.length < 2 && parsedBrands.length < top2Brands.length) {
            const idx = parsedBrands.length;
            const brand = top2Brands[idx];
            
            parsedBrands.push({
              id: brand.id, // Already guaranteed to be a string from brandsWithGuaranteedIds
              name: brand.name,
              brand: brand.name, // Also include as 'brand' for compatibility
              content: [
                `Integration: ${brand.category} brand integration woven naturally into ${actualProjectName}'s storyline, featuring prominent placement in pivotal scenes and cross-promotional opportunities.`,
                `Why it works: Ideal match for the ${genre || 'production'}'s tone and audience, with ${brand.name}'s brand values perfectly complementing the narrative themes.`,
                `HB Insights: Strong partnership potential with ${brand.partnershipCount} previous collaborations and ${brand.dealsCount} current deals, demonstrating active entertainment marketing engagement.`
              ],
              hubspotUrl: brand?.hubspotUrl || null,
              oneSheetLink: brand?.oneSheetLink || null,
              secondaryOwnerId: brand?.secondaryOwnerId || null,
              specialtyLeadId: brand?.specialtyLeadId || null,
              isInSystem: !!brand?.hubspotUrl // Add isInSystem flag
            });
          }
        } else {
          // No AI response - create high-quality defaults using actual brand data
          parsedBrands = top2Brands.slice(0, 2).map((brand, idx) => {
            return {
              id: brand.id, // Already guaranteed to be a string from brandsWithGuaranteedIds
              name: brand.name,
              brand: brand.name, // Also include as 'brand' for compatibility
              content: [
                `Integration: ${brand.category} partnership seamlessly integrated into ${actualProjectName} through strategic product placement in key scenes, character wardrobe/props, and co-branded marketing campaigns targeting shared demographics.`,
                `Why it works: ${brand.name} aligns perfectly with the ${genre || 'production'}'s themes and target audience, offering authentic brand integration that enhances rather than disrupts the narrative flow.`,
                `HB Insights: With ${brand.partnershipCount} successful entertainment partnerships and ${brand.dealsCount} active deals, ${brand.name} has proven expertise in film/TV collaborations and is currently ${brand.clientStatus || 'exploring new opportunities'}.`
              ],
              hubspotUrl: brand?.hubspotUrl || null,
              oneSheetLink: brand?.oneSheetLink || null,
              secondaryOwnerId: brand?.secondaryOwnerId || null,
              specialtyLeadId: brand?.specialtyLeadId || null,
              isInSystem: !!brand?.hubspotUrl // Add isInSystem flag
            };
          });
        }
        
        add({ type: 'complete', text: `✅ Creative content generated for ${parsedBrands.length} brands` });
        
        // FINAL ID SANITIZATION: This is the single source of truth for IDs.
        const ensureId = (brand, index) => {
            let finalId;
            if (brand && (brand.id || brand.id === 0)) { // Allow for numeric ID 0
                finalId = String(brand.id);
            } else {
                const name = (brand?.name || brand?.brand || 'brand').toLowerCase();
                const cleanName = name.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                finalId = `${cleanName}-${index}`;
            }
            return { ...brand, id: finalId };
        };

        // Apply this guarantee to both arrays being sent to the frontend.
        if (parsedBrands) {
            parsedBrands = parsedBrands.map(ensureId);
        }
        if (brandSuggestionsForPicker) {
            brandSuggestionsForPicker = brandSuggestionsForPicker.map(ensureId);
        }

        add({ type: 'complete', text: `✅ IDs sanitized. Returning brands.` });
        
        // Final validation log - ensure all IDs are set
        console.log('[Backend] FINAL SANITIZED brand IDs being sent to frontend:');
        console.log('  detailedBrands:', parsedBrands.map(b => ({ id: b.id, name: b.name })));
        console.log('  brandSuggestions:', brandSuggestionsForPicker.slice(0, 5).map(b => ({ id: b.id, name: b.name })));

        // Now, the return statement can proceed with ID-guaranteed data.
        return {
          mcpThinking,
          organizedData: {
            // Main trigger for frontend
            dataType: 'BRAND_RECOMMENDATIONS',
            
            // FULLY POPULATED brands with AI-generated creative content
            detailedBrands: parsedBrands,
            
            // Full list for picker UI
            brandSuggestions: brandSuggestionsForPicker,
            
            // Correctly extracted project name
            projectName: actualProjectName,
            
            // Partnership metadata if found
            partnershipData: partnershipMetadata,
            
            // Additional context (no longer needed for AI generation since it's done)
            metadata: {
              totalBrands: finalBrands.length,
              selectedBrands: parsedBrands.length,
              genre: genre,
              distributor: partnershipMetadata?.distributor || distributorForTerms
            }
          },
        };
      }

      case 'get_brand_activity': {
        const query = intent.args.brand_name || userMessage;
        add({ type: 'start', text: `📇 Pulling communications for: ${query}` });

        const terms = uniqShort([query], 7);
        const [ffData, emData] = await Promise.all([
          firefliesApiKey ? withTimeout(searchFireflies(terms, { limit: 20 }), 6000, { transcripts: [] }) : { transcripts: [] },
          withTimeout(o365API.searchEmails(terms, { limit: 20 }), 6000, { emails: [], o365Status: 'timeout' }),
        ]);

        const meetings = ffData.transcripts || [];
        const emails = emData.emails || [];

        add({
          type: 'result',
          text: `📊 Communications: ${meetings.length} meetings, ${emails.length} emails`,
        });

        const communications = [
          ...meetings.map((m) => ({ type: 'meeting', title: m.title, date: m.dateString, url: m.transcript_url, raw: m })),
          ...emails.map((e) => ({ type: 'email', title: e.subject, date: e.receivedDate, from: e.fromName || e.from, raw: e })),
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

        // This orchestrator returns structure; the main handler can call LLM to write prose.
        return {
          mcpThinking,
          organizedData: {
            dataType: 'PITCH_REQUEST',
            brands,
            context: lastProductionContext || conversationContext || '',
          },
        };
      }

      default:
        return null;
    }
  } catch (error) {
    console.error('[handleClaudeSearch] error:', error?.message);
    return null;
  }
}
