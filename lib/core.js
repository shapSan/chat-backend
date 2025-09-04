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

// Configuration flag for communications-first discovery
const USE_COMMS_FIRST_DISCOVERY = process.env.USE_COMMS_FIRST_DISCOVERY !== 'false'; // Default to true

import {
  o365API,
  searchFireflies,
  extractKeywordsForHubSpot,
  extractKeywordsForContextSearch,
  generateWildcardBrands,
} from './services.js';

/* Genre to Category Mapping for Brand Matching */
const genreCategoryMap = {
  "Action": ["Automotive", "Sports & Recreation", "Gaming", "Energy Drink"],
  "Comedy": ["Food & Beverage", "Entertainment", "Alcoholic Beverage"],
  "Romance": ["Fashion & Apparel", "Jewelry", "Cosmetics & Personal Care"],
  "Sci-Fi": ["Technology", "Gaming", "Automotive & Transportation"],
  "Drama": ["Financial Services", "Health & Wellness", "Fashion & Apparel"],
  "Crime": ["Automotive", "Financial Services", "Technology"],
  "Reality": ["Food & Beverage", "Fashion & Apparel", "Home Improvement"],
  "Thriller": ["Automotive", "Security", "Electronics & Appliances"],
  "Animation": ["Gaming", "Entertainment", "Food & Beverage"],
  "Family": ["Toys & Games", "Food & Beverage", "Entertainment"],
};

/* Generate smart context-aware reasons for brand recommendations */
function generateReason(brand, partnershipData) {
  const category = (brand.main_category || brand.category || '').toLowerCase();
  const subCategory = (brand.product_sub_category__multi_ || brand.sub_category || '').toLowerCase();
  const partnershipGenres = (partnershipData.genre_production || partnershipData.vibe || '').toLowerCase();
  const synopsis = (partnershipData.synopsis || '').toLowerCase();
  const cast = Array.isArray(partnershipData.cast) ? partnershipData.cast.map(c => c.toLowerCase()) : [];
  const location = (partnershipData.location || partnershipData.plot_location || '').toLowerCase();

  // Rule 1: Specific category + genre matches (most powerful)
  if (category.includes('automotive') && partnershipGenres.includes('action')) 
    return 'Natural fit for hero car placement in action sequences.';
  if (category.includes('fashion') && partnershipGenres.includes('romance')) 
    return 'Perfect for character wardrobe and romantic style evolution.';
  if (category.includes('fashion') && synopsis.includes('redemption')) 
    return 'Perfect for a character\'s style evolution and redemption arc.';
  if (subCategory.includes('energy drink') && partnershipGenres.includes('action')) 
    return 'Authentic product for high-octane, energetic scenes.';
  if (category.includes('technology') && partnershipGenres.includes('thriller')) 
    return 'Ideal for showcasing tech as a key plot device in suspenseful moments.';
  if (category.includes('technology') && partnershipGenres.includes('sci-fi')) 
    return 'Perfect for future-tech integration as narrative device.';
  if (category.includes('food & beverage') && partnershipGenres.includes('comedy')) 
    return 'Great for organic placement in social scenes and comedic moments.';
  if (category.includes('jewelry') && partnershipGenres.includes('romance'))
    return 'Symbolic placement opportunities for romantic milestones.';
  if (category.includes('gaming') && (partnershipGenres.includes('sci-fi') || partnershipGenres.includes('action')))
    return 'Gaming integration aligns with tech-savvy target audience.';
  if (category.includes('sports') && partnershipGenres.includes('action'))
    return 'Athletic brand perfect for training montages and action sequences.';
  
  // Rule 2: Location-based matches
  if (location.includes('paris') && category.includes('fashion'))
    return 'Fashion capital setting enhances luxury brand authenticity.';
  if (location.includes('vegas') && category.includes('entertainment'))
    return 'Vegas setting creates natural entertainment brand synergies.';
  if (location.includes('miami') && category.includes('beverage'))
    return 'Miami vibes align with refreshment brand lifestyle.';

  // Rule 3: Artist/Cast alignment
  if (cast.includes('quavo') && category.includes('fashion') && subCategory.includes('streetwear')) 
    return 'Aligns perfectly with Quavo\'s signature streetwear style.';
  if (cast.some(c => c.includes('diesel')) && category.includes('automotive'))
    return 'Natural fit with Vin Diesel\'s action franchise legacy.';
  if (cast.some(c => c.includes('rock') || c.includes('johnson')) && category.includes('fitness'))
    return 'Perfect alignment with The Rock\'s fitness brand persona.';
  
  // Rule 4: Synopsis-specific matches
  if (synopsis.includes('heist') && category.includes('security'))
    return 'Security brand creates ironic tension with heist narrative.';
  if (synopsis.includes('wedding') && category.includes('jewelry'))
    return 'Wedding storyline creates natural jewelry integration moments.';
  if (synopsis.includes('road trip') && category.includes('automotive'))
    return 'Road trip narrative enables extensive vehicle showcase.';
  if (synopsis.includes('cooking') && category.includes('food'))
    return 'Culinary theme allows authentic product integration.';
  
  // Rule 5: Use partnership history as supporting evidence
  const partnershipCount = parseInt(brand.partnership_count || brand.partnershipCount || 0);
  const dealsCount = parseInt(brand.deals_count || brand.dealsCount || 0);
  
  if (partnershipCount > 20 && category.includes(partnershipGenres.split(' ')[0])) 
    return `${partnershipCount} past integrations in similar ${partnershipGenres} content.`;
  if (partnershipCount > 10) 
    return `Proven entertainment partner with ${partnershipCount} successful integrations.`;
  if (dealsCount > 5) 
    return `Active partner currently engaged in ${dealsCount} productions.`;
  
  // Rule 6: Bucket-based reasoning (as a fallback)
  if (brand.sourceBucket === '🎯 Category Match') 
    return 'Fresh prospect identified by AI as perfect creative fit for project genre.';
  if (brand.sourceBucket === '🔥 Active Client') 
    return 'Existing partner with proven track record, ready for quick activation.';
  if (brand.sourceBucket === '📈 Win-Back') 
    return 'Previously successful partner who understands entertainment value.';
  if (brand.sourceBucket === '🚀 Wild Card')
    return brand.reason || 'Creative wildcard suggestion for unexpected synergy.';

  // Default fallback with some context
  if (category && partnershipGenres)
    return `${category.charAt(0).toUpperCase() + category.slice(1)} brand aligned with ${partnershipGenres} themes.`;
    
  return 'Strong potential match based on project creative needs.';
}

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
 * SMART PARALLEL SEARCH
 * ======================= */

/**
 * Execute parallel HubSpot searches with controlled concurrency
 * @param {string[]} brandNames - Array of brand names to search
 * @param {number} maxConcurrent - Maximum concurrent searches (default 3)
 * @returns {Array} Array of objects with searchTerm and matches
 */
export async function smartParallelSearch(brandNames, maxConcurrent = 3) {
  console.log('[smartParallelSearch] Starting with', brandNames.length, 'terms, max concurrent:', maxConcurrent);
  
  // Filter and prioritize terms
  const filteredTerms = brandNames
    .filter(term => term && term.length >= 3) // Ignore very short terms
    .slice(0, 7); // Limit to top 5-7 terms
  
  if (filteredTerms.length === 0) {
    console.log('[smartParallelSearch] No valid search terms after filtering');
    return [];
  }
  
  console.log('[smartParallelSearch] Filtered terms:', filteredTerms);
  
  // Create a simple concurrency pool
  const results = [];
  const executing = [];
  
  for (let i = 0; i < filteredTerms.length; i++) {
    const term = filteredTerms[i];
    
    // Add 100ms stagger between initiating requests
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Create the search promise
    const searchPromise = hubspotAPI.searchBrands({
      query: term,
      limit: 10,
      properties: ['brand_name', 'main_category', 'product_sub_category__multi_', 
                   'client_status', 'client_type', 'partnership_count', 'deals_count', 
                   'hs_lastmodifieddate', 'secondary_owner', 'specialty_lead', 'one_sheet_link']
    }).then(result => {
      console.log('[smartParallelSearch] Search completed for:', term, 'found:', result.results?.length || 0);
      return {
        searchTerm: term,
        matches: result.results || []
      };
    }).catch(error => {
      console.error('[smartParallelSearch] Search failed for:', term, error.message);
      return {
        searchTerm: term,
        matches: [],
        error: error.message
      };
    });
    
    // Add to results array
    results.push(searchPromise);
    
    // Control concurrency
    if (filteredTerms.length > maxConcurrent) {
      executing.push(searchPromise);
      
      if (executing.length >= maxConcurrent) {
        // Wait for one to complete before continuing
        await Promise.race(executing);
        // Remove completed promise from executing array
        executing.splice(0, 1);
      }
    }
  }
  
  // Wait for all searches to complete
  const searchResults = await Promise.all(results);
  
  console.log('[smartParallelSearch] All searches completed, total results:', 
    searchResults.reduce((sum, r) => sum + r.matches.length, 0));
  
  return searchResults;
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
 * Dynamically generate relevant HubSpot categories using AI based on project synopsis
 */
async function generateDynamicCategories(partnershipData, { add }) {
  if (!openAIApiKey || !partnershipData.synopsis) {
    // Fallback to genre-based categories if available
    const genres = (partnershipData.genre_production || partnershipData.vibe || '').split(';');
    const fallbackCategories = [...new Set(genres.flatMap(genre => genreCategoryMap[genre] || []))];
    return fallbackCategories.slice(0, 5);
  }
  
  try {
    const prompt = `Based on this entertainment project, suggest 5-10 relevant HubSpot main_category values that would be perfect for brand partnerships.

Project: ${partnershipData.title || 'Unknown'}
Synopsis: ${partnershipData.synopsis}
Genre/Vibe: ${partnershipData.vibe || partnershipData.genre_production || 'Not specified'}
Location: ${partnershipData.location || 'Not specified'}

Return ONLY a JSON array of category strings that match HubSpot's main_category field values.
Examples of valid categories: "Automotive", "Food & Beverage", "Fashion & Apparel", "Technology", "Sports & Recreation", "Gaming", "Financial Services", "Health & Wellness", "Entertainment", "Jewelry", "Cosmetics & Personal Care"

Return format: ["Category1", "Category2", ...]`;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: MODELS.openai.chatMini,
        messages: [
          { role: 'system', content: 'You are a brand category expert. Return only a valid JSON array of category strings.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.4,
        max_tokens: 200
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to generate categories');
    }
    
    const data = await response.json();
    const result = extractJson(data.choices?.[0]?.message?.content);
    
    if (Array.isArray(result)) {
      add({ type: 'info', text: `🎯 AI generated ${result.length} dynamic categories: ${result.slice(0, 3).join(', ')}...` });
      return result.slice(0, 10);
    }
    
    throw new Error('Invalid AI response format');
  } catch (error) {
    console.error('[generateDynamicCategories] Error:', error.message);
    // Fallback to genre-based categories
    const genres = (partnershipData.genre_production || partnershipData.vibe || '').split(';');
    const fallbackCategories = [...new Set(genres.flatMap(genre => genreCategoryMap[genre] || []))];
    return fallbackCategories.slice(0, 5);
  }
}

/**
 * Generate intelligent search terms using a single, sophisticated AI call
 * Now accepts known project name and lead actor directly to avoid redundant extraction
 */
async function generateIntelligentSearchTerms(partnershipData, { add }) {
  // Extract known values from partnership data
  const projectName = partnershipData.projectName || partnershipData.title;
  const leadActor = partnershipData.leadActor || 
    (Array.isArray(partnershipData.cast) ? partnershipData.cast[0] : null);
  const synopsis = partnershipData.synopsis;
  
  // Build base terms with known values
  const baseTerms = [];
  if (projectName) baseTerms.push(projectName);
  if (leadActor) baseTerms.push(leadActor);
  
  // If no AI key or synopsis, return just the base terms
  if (!openAIApiKey || !synopsis) {
    return baseTerms.slice(0, 3);
  }
  
  try {
    // Refined prompt that focuses on augmenting known terms with creative additions
    const prompt = `You are a senior brand strategist. Your task is to augment a list of known search terms with 2-3 additional, highly-specific keywords based on a project's synopsis.
Your primary goal is to find tangible nouns, events, or concepts in the synopsis that would be unique identifiers in a meeting transcript.

**<KNOWN_SEARCH_TERMS>**
* Project Title: ${projectName || 'Not provided'}
* Lead Actor: ${leadActor || 'Not provided'}

**<PROJECT_SYNOPSIS>**
"""
${synopsis}
"""

**<RULES_FOR_NEW_TERMS>**
1. **Generate 2-3 *new* search terms** by extracting the most specific and tangible proper nouns, unique objects, or events from the synopsis.
2. **Focus on Specificity:**
   * Good Example: "Rolling Loud" (a specific, unique event mentioned)
   * Bad Example: "street operations" (too abstract)
3. **Avoid Redundancy:** DO NOT repeat the known Project Title or Lead Actor.
4. **Avoid Generic Genres:** DO NOT return generic terms like "Action", "Thriller", or "Fashion".

**<OUTPUT_INSTRUCTIONS>**
* Return ONLY a valid JSON object.
* The JSON object must be in the format: {"creative_terms": ["Term 1", "Term 2", ...]}
* The creative_terms array should contain only the 2-3 new terms you have generated.`;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: MODELS.openai.chatMini,
        messages: [
          { role: 'system', content: 'You are a brand strategy expert. Return only valid JSON with creative_terms array. Focus on extracting unique, specific identifiers from the synopsis that would appear in meeting transcripts.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 150
      })
    });
    
    if (!response.ok) {
      throw new Error('AI search term generation failed');
    }
    
    const data = await response.json();
    const result = extractJson(data.choices?.[0]?.message?.content);
    
    if (result && result.creative_terms && Array.isArray(result.creative_terms)) {
      // Combine known terms with AI-generated creative terms
      const allTerms = [...baseTerms, ...result.creative_terms.slice(0, 3)];
      add({ type: 'info', text: `🎯 Search terms: ${baseTerms.join(', ')} + AI creative: ${result.creative_terms.join(', ')}` });
      return allTerms;
    }
    
    throw new Error('Invalid AI response format');
  } catch (error) {
    console.error('[generateIntelligentSearchTerms] Error:', error.message);
    // Fallback to just base terms
    return baseTerms;
  }
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

    // CRITICAL: Check if brand already exists - if it does, DO NOT override its primary tag
    if (brandMap.has(brandId)) {
      const existingBrand = brandMap.get(brandId);
      // Add secondary context but preserve the primary tag
      if (!existingBrand.tags.includes(primaryTag)) {
        existingBrand.secondaryTags = existingBrand.secondaryTags || [];
        existingBrand.secondaryTags.push(primaryTag);
      }
      // Update insight if new context is available
      if (contextData && !existingBrand.insight) {
        existingBrand.insight = contextData;
      }
      return; // Exit early - don't override the primary tag
    }

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

    // This is a NEW brand - set its primary tag
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
      primaryTag: primaryTag,  // Store the primary tag separately
      tags: [primaryTag],       // Tags array starts with primary tag
      secondaryTags: [],        // Array for additional context tags
      relevanceScore: 50,       // Default base score - will be recalculated with multipliers
      reason,
      insight: contextData,
      sourceBucket: primaryTag  // Also store as sourceBucket for compatibility
    });
  };

  // Process brands in PRIORITY ORDER - first bucket wins the primary tag
  // Priority 1: AI-driven sub-category brands (highest priority)
  subCategoryBrands?.results?.forEach((b) => {
    const brandId = b.id
      ? String(b.id)
      : `subcategory-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextData = findBrandContext(b.properties?.brand_name || b.name || '');
    addBrandBase(
      brandId,
      b,
      '🎯 Perfect Context Match',
      'AI-identified as perfect fit for production context',
      contextData
    );
  });

  // Priority 2: Activity brands
  activityBrands?.results?.forEach((b) => {
    const brandId = b.id
      ? String(b.id)
      : `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextData = findBrandContext(b.properties?.brand_name || b.name || '');
    addBrandBase(
      brandId,
      b,
      '📧 Recent Activity',
      `Recent engagement - last activity ${new Date(
        b.properties?.hs_lastmodifieddate || b.lastActivity || Date.now()
      ).toLocaleDateString()}`,
      contextData
    );
  });

  // Priority 3: Synopsis-matched brands
  synopsisBrands?.results?.forEach((b) => {
    const brandId = b.id
      ? String(b.id)
      : `synopsis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextData = findBrandContext(b.properties?.brand_name || b.name || '');
    addBrandBase(brandId, b, '🎯 Genre Match', 'Matches production genre and themes', contextData);
  });

  // Priority 4: Genre/vibe matched brands
  genreBrands?.results?.forEach((b) => {
    const brandId = b.id
      ? String(b.id)
      : `genre-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextData = findBrandContext(b.properties?.brand_name || b.name || '');
    const brandProps = b.properties || b;
    addBrandBase(brandId, b, '🎭 Vibe Match', generatePitch(brandProps, synopsis), contextData);
  });

  // Priority 5: Active brands
  activeBrands?.results?.forEach((b) => {
    const brandId = b.id
      ? String(b.id)
      : `active-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextData = findBrandContext(b.properties?.brand_name || b.name || '');
    const dealsCount = b.properties?.deals_count || b.dealsCount || '0';
    const partnershipCount = b.properties?.partnership_count || b.partnershipCount || '0';
    addBrandBase(
      brandId,
      b,
      '🔥 Active Client',  // Simplified to single primary tag
      `Budget proven: ${dealsCount} deals, ${partnershipCount} partnerships`,
      contextData
    );
  });

  // Priority 6: Dormant brands - re-ignition opportunities
  dormantBrands?.results?.forEach((b) => {
    const brandId = b.id
      ? String(b.id)
      : `dormant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const contextData = findBrandContext(b.properties?.brand_name || b.name || '');
    const lastActivity = b.properties?.hs_lastmodifieddate || b.lastActivity;
    addBrandBase(
      brandId,
      b,
      '📈 Re-Ignition Opportunity',
      `Previously successful partner - last activity ${new Date(lastActivity || Date.now()).toLocaleDateString()}`,
      contextData
    );
  });

  if (wildcardCategories?.length) {
    wildcardCategories.slice(0, 5).forEach((brandString, idx) => {
      // Smartly split the brand name from its description
      const parts = brandString.split(/ - | – |: /).map(s => s.trim());
      const brandName = parts[0];
      const brandDescription = parts.length > 1 ? parts.slice(1).join(' - ') : 'Excellent fit for the project themes.';

      // Use the description to create a specific, relevant reason
      const reason = `AI creative suggestion: ${brandDescription}`;

      brandMap.set(`wildcard_${idx}`, {
        source: 'suggestion',
        id: `wildcard_${idx}`,
        name: brandName,
        brand: brandName,
        category: 'Suggested for Cold Outreach',
        tags: ['🚀 Cold Outreach Opportunity', '💡 Creative Suggestion', '🎭 Vibe Match'],
        relevanceScore: 0, // Score will be calculated in the final mapping step
        reason: reason, // Use the new, smart reason
        isWildcard: true,
      });
    });
  }

  // Process all brands and finalize tags
  const sorted = Array.from(brandMap.values()).map(brand => {
    // Combine primary tag with any secondary tags for display
    const allTags = [brand.primaryTag || brand.tags[0]];
    
    // Add secondary tags if they exist and aren't duplicates
    if (brand.secondaryTags && brand.secondaryTags.length > 0) {
      brand.secondaryTags.forEach(tag => {
        if (!allTags.includes(tag)) {
          allTags.push(tag);
        }
      });
    }
    
    // Add descriptive tags based on data (not source tags)
    const partnershipCount = parseInt(brand.partnershipCount || '0');
    const dealsCount = parseInt(brand.dealsCount || '0');
    
    if (partnershipCount >= 10) {
      allTags.push(`🤝 ${partnershipCount} Partnerships`);
    }
    if (dealsCount >= 5) {
      allTags.push(`💡 ${dealsCount} Active Deals`);
    }
    
    // Update the tags array with the combined list
    brand.tags = allTags;
    
    // Ensure sourceBucket matches primaryTag for compatibility
    brand.sourceBucket = brand.primaryTag || brand.tags[0];
    
    // CORRECTED DISCOVERY BONUS SCORING SYSTEM (matching new priority order)
    let score = 0;
    
    // Check primary tag for scoring (use primaryTag, not tags array)
    const primaryTag = brand.primaryTag || brand.sourceBucket || brand.tags[0];
    const isContextMatch = primaryTag && (primaryTag.includes('🎯 Perfect Context Match') || 
                          primaryTag.includes('🎯 Genre Match') || 
                          primaryTag.includes('🎯 Category Match'));
    const isWinBack = primaryTag && (primaryTag.includes('📈 Re-Ignition Opportunity') || 
                     primaryTag.includes('📈 Win-Back'));
    const isActiveClient = primaryTag && primaryTag.includes('🔥 Active Client');
    const isDiscovery = primaryTag && primaryTag.includes('🆕 Discovery');
    const isWildcard = (primaryTag && primaryTag.includes('🚀')) || brand.isWildcard;

    // Apply scores based on CORRECTED priority order:
    // 1. Category/Context Match (highest priority)
    if (isContextMatch) {
      score += 150; // Highest base score for perfect contextual fit
    }
    // 2. Win-Back (second priority)
    if (isWinBack) {
      score += 120; // Strong score for re-engagement opportunities
    }
    // 3. Active Client (third priority)
    if (isActiveClient) {
      score += 90; // Good score for existing partners
    }
    // 4. Discovery (fourth priority)
    if (isDiscovery) {
      score += 80; // Moderate score for new prospects
    }
    // 5. Wildcard (lowest priority)
    if (isWildcard) {
      score += 70; // Lower score for wildcards
    }

    // THE DISCOVERY BONUS: Add a huge bonus if it's a perfect fit but NOT an active client
    if (isContextMatch && !isActiveClient) {
      score += 50;
    }

    // Add a kicker based on historical partnership count (max 20 points)
    brand.relevanceScore = score + Math.min(20, parseInt(brand.partnershipCount) || 0);
    
    return brand;
  }).sort((a, b) => b.relevanceScore - a.relevanceScore);

  // NEW, MORE GENEROUS TIERED CURATION LOGIC
  const finalSuggestions = [];
  const addedIds = new Set();
  const targetSize = 30; // Increased from 15 to 30 for more comprehensive default view

  // Apply jitter if enabled
  let adjustedTargetSize = targetSize;
  if (RECS_JITTER_TARGET && synopsis) {
    const hashCode = synopsis
      .split('')
      .reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0);
    const jitter = (Math.abs(hashCode) % 7) - 3; // -3..+3
    adjustedTargetSize = Math.max(27, Math.min(33, 30 + jitter));  // Range: 27-33 brands
  }

  // Define buckets with their new, larger guaranteed counts
  const buckets = [
    { tag: '🎯 Perfect Context Match', count: 5 },    // Increased from 2
    { tag: '🎯 Genre Match', count: 5 },              // Increased from 2
    { tag: '🎯 Category Match', count: 5 },           // Increased from 2
    { tag: '📈 Re-Ignition Opportunity', count: 4 },  // Increased from 2
    { tag: '📈 Win-Back', count: 4 },                 // Increased from 2
    { tag: '🔥 Active Client', count: 4 },           // Increased from 2
    { tag: '🆕 Discovery', count: 4 },               // Increased from 2
    { tag: '🚀 Cold Outreach Opportunity', count: 5 }, // Increased from 3
    { tag: '🚀 Wild Card', count: 5 }                // Increased from 3
  ];

  // Tier 1: Add the "best of" from each bucket to guarantee representation
  buckets.forEach(bucket => {
    const topBrandsFromBucket = sorted
      .filter(brand => brand.tags && brand.tags.includes(bucket.tag) && !addedIds.has(brand.id))
      .slice(0, bucket.count);

    topBrandsFromBucket.forEach(brand => {
      if (!addedIds.has(brand.id) && finalSuggestions.length < adjustedTargetSize) {
        finalSuggestions.push(brand);
        addedIds.add(brand.id);
      }
    });
  });

  // Tier 2: Fill remaining spots with the best of the rest
  const remainingSpots = adjustedTargetSize - finalSuggestions.length;
  if (remainingSpots > 0) {
    const bestOfTheRest = sorted
      .filter(brand => !addedIds.has(brand.id))
      .slice(0, remainingSpots);
    finalSuggestions.push(...bestOfTheRest);
  }

  // This is the final, curated list to be returned
  return finalSuggestions.slice(0, adjustedTargetSize);
}

/* ========================================================================
 * COMMUNICATIONS-FIRST BRAND DISCOVERY ENGINE
 * ====================================================================== */

/**
 * New orchestrator that searches communications first, then extracts brands
 */
async function runCommunicationsFirstSearch(intent, { add, knownProjectName, userMessage, mcpThinking, conversationContext }) {
  
  // First extract project information from the user message
  let projectName = knownProjectName;
  let extractedData = {};
  let partnershipData = null;
  
  // Extract project details from the message
  if (openAIApiKey) {
    try {
      const extractionPrompt = `Analyze the following production details. Extract the primary title, a brief synopsis, and key themes or genres. Use null for any missing fields.

**Text:**
\`\`\`
${userMessage}
\`\`\`

**JSON Output:**
\`\`\`json
{
  "title": "...",
  "synopsis": "...",
  "themes": ["...", "..."]
}
\`\`\``;
      
      const extractResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
        body: JSON.stringify({
          model: MODELS.openai.chatMini,
          messages: [
            { role: 'system', content: 'You are a data extraction assistant. Extract production information and return ONLY valid JSON.' },
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
          if (extracted.title) {
            projectName = extracted.title;
            add({ type: 'info', text: `🎬 Analyzing project: "${projectName}"` });
          }
        }
      }
    } catch (error) {
      console.error('[runCommunicationsFirstSearch] Error extracting data:', error);
    }
  }
  
  // Try to get partnership data from HubSpot if we have a project name
  if (projectName && hubspotAPI?.getPartnershipForProject) {
    try {
      partnershipData = await hubspotAPI.getPartnershipForProject(projectName);
      if (partnershipData) {
        add({ type: 'result', text: `✅ Found partnership data in HubSpot` });
      }
    } catch (error) {
      console.error('[runCommunicationsFirstSearch] Error fetching partnership data:', error);
    }
  }
  
  // Merge extracted data with partnership data
  const finalPartnershipData = {
    title: projectName || extractedData.title || userMessage.slice(0, 50),
    synopsis: partnershipData?.synopsis || extractedData.synopsis || userMessage,
    themes: extractedData.themes || [],
    genre_production: partnershipData?.genre_production || partnershipData?.vibe,
    cast: partnershipData?.cast || [],
    location: partnershipData?.location,
    distributor: partnershipData?.distributor,
    vibe: partnershipData?.vibe || partnershipData?.genre_production
  };

  // Step 1: Search communications for signal boosting (not discovery)
  const commsResults = await searchCommunicationsForClues(finalPartnershipData, { add });

  // Step 2: Get brands from reliable curated buckets
  add({ type: 'info', text: '🎯 Fetching brands from curated buckets...' });
  const traditionalResults = await fetchCuratedBrandBuckets(finalPartnershipData, { add });
    
  
  // Step 3: Apply "Signal Booster" - check if any curated brands appear in communications
  // This boosts scores for brands that are actively being discussed
  const commsText = [
    ...commsResults.meetings.map(m => `${m.title || ''} ${m.summary?.overview || ''} ${m.summary?.keywords?.join(' ') || ''}`),
    ...commsResults.emails.map(e => `${e.subject || ''} ${e.preview || ''}`)
  ].join(' ').toLowerCase();
  
  const boostedBrands = traditionalResults.brands.map(brand => {
    const brandName = (brand.name || brand.brand || '').toLowerCase();
    
    // Check if brand name appears in communications text
    if (brandName && brandName.length > 2 && commsText.includes(brandName)) {
      // Brand was mentioned in recent communications - boost it!
      brand.relevanceScore = (brand.relevanceScore || 100) + 75;  // Significant boost
      brand.tags = [...(brand.tags || []), '💬 Recent Comms Mention'];
      
      // Try to find specific context
      for (const meeting of commsResults.meetings) {
        const meetingText = `${meeting.title || ''} ${meeting.summary?.overview || ''}`.toLowerCase();
        if (meetingText.includes(brandName)) {
          brand.reason = `Recently discussed in "${meeting.title}" - ${brand.reason || 'Strong candidate for this project'}`;
          break;
        }
      }
      for (const email of commsResults.emails) {
        const emailText = `${email.subject || ''} ${email.preview || ''}`.toLowerCase();
        if (emailText.includes(brandName)) {
          brand.reason = brand.reason || `Mentioned in recent email: "${email.subject}" - ${brand.reason || 'Active conversation'}`;
          break;
        }
      }
      
      add({ type: 'info', text: `💬 Signal boost for ${brand.name} - found in recent communications` });
    }
    
    return brand;
  });
  
  // Re-sort after applying signal boosts
  let allRankedBrands = boostedBrands.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  
  // Diversification step: guarantee representation from each bucket
  const diversifiedBrands = [];
  const addedIds = new Set();
  const targetSize = 30;  // Increased from 15 to 30 for more comprehensive default view
  
  // Define buckets and their filters (Comms is now a signal boost, not a discovery bucket)
  const buckets = [
    { name: 'Category Match', filter: b => b.tags?.some(tag => tag.includes('🎯 Category Match')) },
    { name: 'Win-Back', filter: b => b.tags?.some(tag => tag.includes('📈 Win-Back')) },
    { name: 'Active Client', filter: b => b.tags?.includes('🔥 Active Client') },
    { name: 'Discovery', filter: b => b.tags?.includes('🆕 Discovery') },
    { name: 'Wild Card', filter: b => b.tags?.includes('🚀 Wild Card') || b.isWildcard }
  ];
  
  // TIER 1: Add top brands from each bucket with MORE GENEROUS COUNTS
  // Increased guaranteed slots for better representation
  const bucketQuotas = {
    'Category Match': 6,      // Increased from 2
    'Win-Back': 5,           // Increased from 2
    'Active Client': 5,      // Increased from 2
    'Discovery': 5,          // Increased from 2
    'Wild Card': 6           // Increased from 2
  };
  
  for (const bucket of buckets) {
    const quota = bucketQuotas[bucket.name] || 4;
    const bucketBrands = allRankedBrands.filter(b => bucket.filter(b) && !addedIds.has(b.id));
    const topFromBucket = bucketBrands.slice(0, quota);
    
    for (const brand of topFromBucket) {
      diversifiedBrands.push(brand);
      addedIds.add(brand.id);
    }
  }
  
  // TIER 2: Fill remaining slots with the best of the rest (up to targetSize)
  // These are the next highest-scoring brands from the fullList
  for (const brand of allRankedBrands) {
    if (!addedIds.has(brand.id)) {
      diversifiedBrands.push(brand);
      addedIds.add(brand.id);
      if (diversifiedBrands.length >= targetSize) break;
    }
  }
  
  // Update to diversified list - now limited to targetSize (25)
  allRankedBrands = diversifiedBrands.slice(0, targetSize);
  
  // Select top 2 brands using new selection logic
  const brandsForPitching = [];
  const usedIds = new Set();
  
  // Filter brands by bucket type
  const winBackBrands = allRankedBrands.filter(b => 
    b.tags?.some(tag => tag.includes('📈 Win-Back'))
  );
  const categoryMatchBrands = allRankedBrands.filter(b => 
    b.tags?.some(tag => tag.includes('🎯 Category Match'))
  );
  const wildCardBrands = allRankedBrands.filter(b => 
    b.tags?.includes('🚀 Wild Card')
  );
  const activeClientBrands = allRankedBrands.filter(b => 
    b.tags?.includes('🔥 Active Client')
  );
  
  // Brand 1: Win-Back or Category Match
  if (winBackBrands.length > 0) {
    brandsForPitching.push(winBackBrands[0]);
    usedIds.add(winBackBrands[0].id);
  } else if (categoryMatchBrands.length > 0) {
    const brand1 = categoryMatchBrands.find(b => !usedIds.has(b.id));
    if (brand1) {
      brandsForPitching.push(brand1);
      usedIds.add(brand1.id);
    }
  }
  
  // Brand 2: Wild Card or Active Client
  if (wildCardBrands.length > 0) {
    const brand2 = wildCardBrands.find(b => !usedIds.has(b.id));
    if (brand2) {
      brandsForPitching.push(brand2);
      usedIds.add(brand2.id);
    }
  } else if (activeClientBrands.length > 0) {
    const brand2 = activeClientBrands.find(b => !usedIds.has(b.id));
    if (brand2) {
      brandsForPitching.push(brand2);
      usedIds.add(brand2.id);
    }
  }
  
  // Fallback to top brands if needed
  if (brandsForPitching.length < 2) {
    for (const brand of allRankedBrands) {
      if (!usedIds.has(brand.id)) {
        brandsForPitching.push(brand);
        if (brandsForPitching.length >= 2) break;
      }
    }
  }
  
  // Generate creative content
  const creativeResult = await generateCreativeContent(brandsForPitching, {
    add,
    actualProjectName: projectName,
    search_term: userMessage,
    partnershipData: finalPartnershipData,
    communications: commsResults
  });
  
  // Return formatted payload
  return prepareFrontendPayload({
    enrichedBrands: creativeResult.enrichedBrands,
    allRankedBrands: allRankedBrands,
    mcpThinking: mcpThinking,
    projectName: projectName,
    partnershipData: finalPartnershipData,
    communications: commsResults,  // ADD THIS - pass the communications data
    finalReplyText: creativeResult.finalReplyText
  });
}

/**
 * Search communications with intelligent, targeted terms
 */
async function searchCommunicationsForClues(partnershipData, { add }) {
  // Pass known values directly to avoid redundant extraction
  const projectName = partnershipData.title;
  const leadActor = Array.isArray(partnershipData.cast) ? partnershipData.cast[0] : null;
  
  // Use the new intelligent search term generator with known values
  const primarySearchTerms = await generateIntelligentSearchTerms({
    projectName,
    leadActor,
    synopsis: partnershipData.synopsis
  }, { add })
  
  const allMeetings = new Map();
  const allEmails = new Map();
  
  // Execute ONE consolidated search with the intelligent terms
  if (primarySearchTerms.length > 0) {
    add({ type: 'info', text: `🔍 Executing single consolidated search for: ${primarySearchTerms.join(', ')}` });
    const [ffResult, o365Result] = await Promise.allSettled([
      firefliesApiKey ? searchFireflies(primarySearchTerms, { limit: 10 }) : Promise.resolve({ transcripts: [] }),
      o365API.searchEmails ? withTimeout(o365API.searchEmails(primarySearchTerms, { limit: 10 }), 15000, { emails: [] }) : Promise.resolve({ emails: [] })
    ]);
    
    if (ffResult.status === 'fulfilled' && ffResult.value.transcripts) {
      ffResult.value.transcripts.forEach(t => allMeetings.set(t.id, t));
    }
    if (o365Result.status === 'fulfilled' && o365Result.value.emails) {
      o365Result.value.emails.forEach(e => allEmails.set(e.id, e));
    }
  }
  
  // If no results, get recent transcripts as fallback
  if (allMeetings.size === 0 && firefliesApiKey) {
    add({ type: 'info', text: '🔍 Getting recent meeting transcripts as fallback' });
    try {
      const recentResult = await searchFireflies([], { limit: 10 }); // Empty search = recent
      if (recentResult.transcripts) {
        recentResult.transcripts.forEach(t => allMeetings.set(t.id, t));
      }
    } catch (error) {
      console.log('[searchCommunicationsForClues] Fallback search failed:', error.message);
    }
  }
  
  const meetings = Array.from(allMeetings.values());
  const emails = Array.from(allEmails.values());
  
  add({ type: 'result', text: `📊 Found ${meetings.length} meetings & ${emails.length} emails from intelligent search for signal boosting` });
  return { meetings, emails };
}

/**
 * AI-powered extraction of brand names from communications
 */
async function extractBrandsFromComms(commsResults, { add }) {
  const textCorpus = [
    ...commsResults.meetings.map(m => `Meeting: "${m.title}". ${m.summary?.overview || ''} ${m.summary?.keywords?.join(', ') || ''}`),
    ...commsResults.emails.map(e => `Email: "${e.subject}". ${e.preview || ''}`)
  ].filter(Boolean).join('\n\n---\n\n');

  if (!textCorpus.trim() || !openAIApiKey) return [];

  add({ type: 'process', text: '🧠 AI is analyzing communications for brand mentions...' });

  const extractionPrompt = `Analyze the following text from meeting transcripts and email threads. Identify and extract all specific consumer brand names mentioned.

CRITICAL RULES:
1. Extract only real, specific brand names (e.g., "Nike", "Coca-Cola", "PlayStation", "Toyota", "Apple")
2. Do NOT extract: generic terms, company types, people's names, meeting platforms (Zoom, Teams), or agency names
3. Focus on consumer brands that could be used for product placement in entertainment
4. Return a JSON object with a "brands" array containing unique brand names

Text Corpus:
---
${textCorpus.slice(0, 8000)}
---

Return JSON: {"brands": ["Brand1", "Brand2", ...]}`;

  try {
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: MODELS.openai.chatMini,
        messages: [
          { role: 'system', content: 'You are a brand extraction specialist. Return only valid JSON.' },
          { role: 'user', content: extractionPrompt }
        ],
        temperature: 0.2,
        max_tokens: 500
      })
    });

    if (!aiResponse.ok) return [];

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content;
    const extractedData = extractJson(aiContent);
    const brandNames = Array.isArray(extractedData?.brands) ? extractedData.brands : [];

    // Deduplicate and clean
    const uniqueBrands = [...new Set(brandNames.map(b => b.trim()).filter(Boolean))];
    
    if (uniqueBrands.length > 0) {
      add({ type: 'result', text: `🎯 AI extracted ${uniqueBrands.length} brands: ${uniqueBrands.slice(0, 5).join(', ')}${uniqueBrands.length > 5 ? '...' : ''}` });
    }
    
    return uniqueBrands;
  } catch (error) {
    console.error('Brand extraction failed:', error);
    return [];
  }
}

/**
 * Fetch specific brands by name from HubSpot
 */
async function fetchBrandsByName(brandNames, { add }) {
  if (!brandNames || brandNames.length === 0) return [];
  
  add({ type: 'info', text: `🔍 Fetching details for ${brandNames.length} brands from HubSpot...` });
  
  // Use the new smart parallel search with controlled concurrency
  const searchResults = await smartParallelSearch(brandNames.slice(0, 15), 3);
  
  // Flatten and dedupe results
  const brandMap = new Map();
  searchResults.forEach((searchResult) => {
    const searchedName = searchResult.searchTerm.toLowerCase();
    searchResult.matches?.forEach(brand => {
      if (brand.id && brand.properties?.brand_name) {
        const brandNameLower = brand.properties.brand_name.toLowerCase();
        // Improved matching logic - exact match or strong partial match
        const isMatch = brandNameLower === searchedName || 
                       searchedName === brandNameLower ||
                       (brandNameLower.includes(searchedName) && searchedName.length > 3) ||
                       (searchedName.includes(brandNameLower) && brandNameLower.length > 3);
        
        if (isMatch && !brandMap.has(brand.id)) {
          // Transform to our standard format
          const transformedBrand = {
            id: brand.id,
            name: brand.properties.brand_name,
            brand: brand.properties.brand_name,
            category: brand.properties.main_category || 'General',
            subcategories: brand.properties.product_sub_category__multi_ || '',
            clientStatus: brand.properties.client_status || '',
            clientType: brand.properties.client_type || '',
            partnershipCount: brand.properties.partnership_count || '0',
            dealsCount: brand.properties.deals_count || '0',
            lastActivity: brand.properties.hs_lastmodifieddate,
            hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI?.portalId || process.env.HUBSPOT_PORTAL_ID || '0'}/company/${brand.id}`,
            oneSheetLink: brand.properties.one_sheet_link || null,
            secondary_owner: brand.properties.secondary_owner || null,
            specialty_lead: brand.properties.specialty_lead || null,
            secondaryOwnerId: brand.properties.secondary_owner || null,
            specialtyLeadId: brand.properties.specialty_lead || null,
            source: 'hubspot',
            tags: ['💬 Found in Comms'],
            reason: `Actively discussed in recent communications about ${searchResult.searchTerm}`,
            relevanceScore: 150 // High score for being found in comms
          };
          brandMap.set(brand.id, transformedBrand);
        }
      }
    });
  });
  
  const brands = Array.from(brandMap.values());
  add({ type: 'result', text: `✅ Found ${brands.length} brands in HubSpot from communication mentions` });
  
  return brands;
}

/* ========================================================================
 * CURATED BUCKET BRAND SEARCH SYSTEM
 * ====================================================================== */

/**
 * Fetch brands from 4 curated buckets to ensure diversity and relevance.
 * This replaces the old fetchAllBrandData and rankAndCombineBrands functions.
 */
async function fetchCuratedBrandBuckets(partnershipData, { add }) {
  add({ type: 'start', text: '🔎 Fetching curated brand buckets...' });

  // Increased quotas to support 30 brand default view with generous representation
  const quotas = { active: 8, category: 8, dormant: 6, discovery: 5, wildcard: 6 };  // Total potential: 33 brands

  // --- Bucket 1: Active Clients ---
  // Find brands that are currently Active AND have significant partnership history
  const activeClientsPromise = hubspotAPI.searchBrands({
    limit: quotas.active,
    filterGroups: [{ filters: [
      { propertyName: 'client_status', operator: 'EQ', value: 'Active' },
      { propertyName: 'partnership_count', operator: 'GT', value: '10' } // Top partners only
    ] }],
    sorts: [{ propertyName: 'partnership_count', direction: 'DESCENDING' }] // Prioritize most experienced
  });

  // --- Bucket 2: Category-Matched Prospects (Dynamic) ---
  const relevantCategories = await generateDynamicCategories(partnershipData, { add });
  
  // Find high-potential prospects that match project genre but aren't current clients
  let categoryMatchedPromise;
  if (relevantCategories.length > 0) {
    add({ type: 'info', text: `🎯 Searching for brands in categories: ${relevantCategories.slice(0, 4).join(', ')}...` });
    categoryMatchedPromise = hubspotAPI.searchBrands({
      limit: quotas.category,
      filterGroups: [{ filters: [
        { propertyName: 'main_category', operator: 'IN', values: relevantCategories },
        { propertyName: 'client_status', operator: 'IN', values: ['Pending', 'Inactive'] }, // Prospects and inactive
        { propertyName: 'partnership_count', operator: 'GT', value: '0' } // Has partnership experience
      ]}],
      sorts: [{ propertyName: 'partnership_count', direction: 'DESCENDING' }]
    });
  } else {
    // Fallback to any non-active brands with experience if no categories
    categoryMatchedPromise = hubspotAPI.searchBrands({
      limit: quotas.category,
      filterGroups: [{ filters: [
        { propertyName: 'client_status', operator: 'EQ', value: 'Pending' },
        { propertyName: 'partnership_count', operator: 'GT', value: '0' }
      ]}],
      sorts: [{ propertyName: 'partnership_count', direction: 'DESCENDING' }]
    });
  }

  // --- Bucket 3: Dormant / Win-Back ---
  // Re-engage previously successful partners who are now inactive
  const dormantPromise = hubspotAPI.searchBrands({
    limit: quotas.dormant,
    filterGroups: [{ filters: [
      { propertyName: 'client_status', operator: 'EQ', value: 'Inactive' },
      { propertyName: 'partnership_count', operator: 'GT', value: '0' } // Must be former partner, not just prospect
    ]}],
    sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }] // Find "warmest" dormant accounts
  });

  // --- Bucket 4: Discovery - Fresh Prospects ---
  // Find new prospects with little to no history with agency
  const discoveryPromise = hubspotAPI.searchBrands({
    limit: quotas.discovery,
    filterGroups: [{ filters: [
      { propertyName: 'client_status', operator: 'EQ', value: 'Pending' },
      { propertyName: 'partnership_count', operator: 'LTE', value: '1' } // Has 0 or 1 partnerships
    ]}],
    sorts: [{ propertyName: 'hs_createdate', direction: 'DESCENDING' }] // Newest leads first
  });

  // --- Bucket 5: Wild Card Discovery (from AI) ---
  const wildcardPromise = generateWildcardBrands(partnershipData.synopsis);

  // First, get the brand results
  const [
    activeResults,
    categoryResults,
    dormantResults,
    discoveryResults,
    wildcardResults
  ] = await Promise.all([
    activeClientsPromise,
    categoryMatchedPromise,
    dormantPromise,
    discoveryPromise,
    wildcardPromise
  ]);

  // Skip communications search in traditional bucket fetching
  // Communications are already being searched in the comms-first orchestrator
  const communications = { meetings: [], emails: [] };

  const brandMap = new Map();

  // Helper to add brands to the map with their source bucket
  const addBrandToMap = (brand, bucket, isPrimary = true) => {
    if (!brand || !brand.id) return;
    
    // Check if brand already exists in map
    if (brandMap.has(brand.id)) {
      // Brand already exists - DO NOT add primary tag, only track for secondary tagging later
      return;
    }
    
    // New brand - add with primary tag
    const brandName = brand.properties?.brand_name || brand.name || 'Unknown Brand';
    const category = brand.properties?.main_category || brand.category || 'General';
    const subcategories = brand.properties?.product_sub_category__multi_ || '';
    const clientStatus = brand.properties?.client_status || '';
    const clientType = brand.properties?.client_type || '';
    const partnershipCount = brand.properties?.partnership_count || '0';
    const dealsCount = brand.properties?.deals_count || '0';
    const lastActivity = brand.properties?.hs_lastmodifieddate || null;
    const secondaryOwner = brand.properties?.secondary_owner || brand.properties?.secondaryOwnerId || null;
    const specialtyLead = brand.properties?.specialty_lead || brand.properties?.specialtyLeadId || null;
    const oneSheetLink = brand.properties?.one_sheet_link || null;
    
    // Create brand object with extracted properties
    const brandData = {
      id: brand.id,
      name: brandName,
      brand: brandName,  // For compatibility
      category: category,
      main_category: category,  // For generateReason
      subcategories: subcategories,
      clientStatus: clientStatus,
      clientType: clientType,
      partnership_count: partnershipCount,  // Keep underscore version for generateReason
      partnershipCount: partnershipCount,
      deals_count: dealsCount,  // Keep underscore version for generateReason
      dealsCount: dealsCount,
      lastActivity: lastActivity,
      hubspotUrl: `https://app.hubspot.com/contacts/${hubspotAPI?.portalId || process.env.HUBSPOT_PORTAL_ID || '0'}/company/${brand.id}`,
      oneSheetLink: oneSheetLink,
      secondary_owner: secondaryOwner,
      specialty_lead: specialtyLead,
      secondaryOwnerId: secondaryOwner,  // For compatibility
      specialtyLeadId: specialtyLead,     // For compatibility
      sourceBucket: bucket,  // Primary source bucket
      reason: generateReason(brand.properties || brand, partnershipData),  // Use smart reason
      tags: [bucket],  // Start with primary tag
      relevanceScore: 100, // We are curating, so all are initially relevant
      source: 'hubspot'
    };
    
    brandMap.set(brand.id, brandData);
  };

  // Process buckets in the CORRECT priority order:
  // 1. 🎯 Category Match (highest priority - best creative fits)
  add({ type: 'result', text: `🎯 Category Matches: ${categoryResults.results.length}` });
  categoryResults.results.forEach(b => addBrandToMap(b, '🎯 Category Match'));

  // 2. 📈 Dormant / Win-Back (re-engagement opportunities)
  add({ type: 'result', text: `📈 Dormant / Win-Back: ${dormantResults.results.length}` });
  dormantResults.results.forEach(b => addBrandToMap(b, '📈 Win-Back'));

  // 3. 🔥 Active Client (existing partners)
  add({ type: 'result', text: `💼 Active Clients: ${activeResults.results.length}` });
  activeResults.results.forEach(b => addBrandToMap(b, '🔥 Active Client'));

  // 4. 🆕 Discovery (new prospects - validate they truly have low partnership count)
  add({ type: 'result', text: `🆕 Discovery Prospects: ${discoveryResults.results.length}` });
  discoveryResults.results.forEach(b => {
    // Only add as Discovery if they truly have ≤1 partnership
    const partnershipCount = parseInt(b.properties?.partnership_count || '0');
    if (partnershipCount <= 1) {
      addBrandToMap(b, '🆕 Discovery');
    }
  });

  // 5. Wild Card brands (lowest priority)
  wildcardResults.forEach((brandString, idx) => {
    const [brandName, brandDescription] = brandString.split(/ - | – /).map(s => s.trim());
    const id = `wildcard_${idx}`;
    brandMap.set(id, {
        id: id,
        name: brandName,
        brand: brandName,
        sourceBucket: '🚀 Wild Card',
        reason: `AI creative suggestion: ${brandDescription || 'Excellent fit for the project themes.'}`,
        tags: ['🚀 Wild Card'],
        relevanceScore: 70, // Lower base score for wildcards
        isWildcard: true,
    });
  });

  // Get the final brand list
  let finalBrandList = Array.from(brandMap.values());

  // Apply multi-tagging and enforce mutually exclusive logic
  finalBrandList = finalBrandList.map(brand => {
    // Start with the primary tag only (from sourceBucket)
    const tags = [brand.sourceBucket]; // Primary tag only
    
    // Add secondary tags based on additional criteria
    // Check if brand ALSO qualifies for Category Match (if not already primary)
    if (brand.sourceBucket !== '🎯 Category Match' && relevantCategories.includes(brand.category)) {
      tags.push('🎯 Category Match');
    }
    
    // Check if brand ALSO qualifies as Active (if not already primary)  
    if (brand.sourceBucket !== '🔥 Active Client' && 
        (brand.clientStatus === 'Active' || brand.clientStatus === 'Contract')) {
      tags.push('🔥 Active Client');
    }
    
    // Check if brand ALSO qualifies as Win-Back (if not already primary)
    if (brand.sourceBucket !== '📈 Win-Back' && 
        brand.clientStatus === 'Inactive' && parseInt(brand.partnershipCount || '0') > 0) {
      tags.push('📈 Win-Back');
    }
    
    // Activity-based descriptive tags
    const partnershipCount = parseInt(brand.partnershipCount || '0');
    const dealsCount = parseInt(brand.dealsCount || '0');
    
    if (partnershipCount >= 10) {
      tags.push(`🤝 ${partnershipCount} Partnerships`);
    }
    
    if (dealsCount >= 5) {
      tags.push(`💡 ${dealsCount} Active Deals`);
    }
    
    // CRITICAL: Enforce mutually exclusive logic for Active vs Win-Back
    if (brand.clientStatus === 'Active' || brand.clientStatus === 'Contract') {
      // Active clients can NEVER be Win-Back
      const filteredTags = tags.filter(tag => !tag.includes('📈 Win-Back'));
      // Ensure Active tag is present
      if (!filteredTags.includes('🔥 Active Client')) {
        filteredTags.push('🔥 Active Client');
      }
      brand.tags = filteredTags;
    } else if (brand.clientStatus === 'Inactive') {
      // Inactive clients can NEVER be Active
      const filteredTags = tags.filter(tag => !tag.includes('🔥 Active Client'));
      brand.tags = filteredTags;
    } else {
      brand.tags = tags;
    }
    
    // Update relevance score based on tag combinations
    let score = brand.relevanceScore || 0;
    
    // Priority-based scoring (matching the new bucket order)
    if (brand.sourceBucket === '🎯 Category Match') score = 150;
    else if (brand.sourceBucket === '📈 Win-Back') score = 120;
    else if (brand.sourceBucket === '🔥 Active Client') score = 90;
    else if (brand.sourceBucket === '🆕 Discovery') score = 80;
    else if (brand.sourceBucket === '🚀 Wild Card') score = 70;
    
    // Bonus for multiple qualifying criteria
    const tagCount = brand.tags.length;
    if (tagCount > 1) score += (tagCount - 1) * 10;
    
    // Discovery bonus: Category match but not active = +50
    if (brand.tags.includes('🎯 Category Match') && !brand.tags.includes('🔥 Active Client')) {
      score += 50;
    }
    
    // Partnership history bonus (up to 20 points)
    score += Math.min(20, partnershipCount);
    
    brand.relevanceScore = score;
    return brand;
  });
  
  // Sort by final relevance score
  finalBrandList.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Return both the brands and the communications data
  // ADD FINAL RANKED BRAND LIST DEBUG INFO
  if (finalBrandList && finalBrandList.length > 0) {
    const rankedDebugInfo = finalBrandList.map(b => ({
      name: b.name,
      score: b.relevanceScore,
      reason: b.reason,
      tags: b.tags,
      source: b.sourceBucket,
      hasInsight: !!b.insight
    }));
    console.log('--- FINAL RANKED BRAND LIST ---');
    console.table(rankedDebugInfo);
    console.log('-------------------------------');
  }
  
  return {
    brands: finalBrandList,
    communications: communications
  };
}

// Note: rankAndCombineBrands function has been removed - replaced by fetchCuratedBrandBuckets

/**
 * Takes the top-ranked brands and calls an AI to generate creative content.
 * It reliably merges the AI content back while preserving the original brand ID.
 */
async function generateCreativeContent(topBrands, { add, actualProjectName, search_term, partnershipData, communications }) {
  if (!topBrands || topBrands.length === 0) return { enrichedBrands: [], finalReplyText: '' };
  add({ type: 'process', text: '✍️ Generating creative content...' });

  // Add any communications context to the brands
  const brandsWithContext = topBrands.map(brand => {
    const enrichedBrand = { ...brand };
    
    // Use the insight field if available (set by fetchCuratedBrandBuckets)
    if (brand.insight) {
      enrichedBrand.insightContext = brand.insight;
    } else if (brand.hasRecentActivity && brand.activityContext) {
      // Fallback to activityContext if set by orchestrator
      enrichedBrand.insightContext = brand.activityContext;
    }
    
    return enrichedBrand;
  });

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

CREATE INTEGRATION IDEAS FOR THESE ${brandsWithContext.length} BRANDS:

${brandsWithContext
    .map(
      (brand, idx) =>
        `${idx + 1}. Brand: ${brand.name}\nCategory: ${brand.category}\nTrack Record: ${brand.partnershipCount} partnerships, ${brand.dealsCount} deals\nClient Status: ${brand.clientStatus || 'Prospect'}\nClient Type: ${brand.clientType || 'New'}${
          brand.insightContext ? `\nRecent Activity: ${brand.insightContext}` : ''
        }`
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
HB Insights: [Use recent activity data if provided, otherwise mention partnership track record]

Provide recommendations for ALL ${brandsWithContext.length} brands.`;

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
  communications,  // ADD THIS PARAMETER
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
      // Pass the communications data
      communications: communications || { meetings: [], emails: [] },  // ADD THIS
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
  // Check if communications-first search is enabled
  if (USE_COMMS_FIRST_DISCOVERY) {
    // Delegate to the new communications-first orchestrator
    return await runCommunicationsFirstSearch(intent, { add, knownProjectName, userMessage, mcpThinking, conversationContext });
  }
  
  // Original orchestrator logic continues below...
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
  
  // Use the new curated bucket system
  const curatedResults = await fetchCuratedBrandBuckets(finalPartnershipData, { add });
  
  // The brands are already fetched, processed and have insights attached
  // But we need to apply the sophisticated ranking from tagAndCombineBrands
  let allRankedBrands = curatedResults.brands;
  
  // Apply the sophisticated scoring system to re-rank the brands
  allRankedBrands = allRankedBrands.map(brand => {
    // CRITICAL: First enforce mutually exclusive Active vs Win-Back
    if (brand.clientStatus === 'Active' || brand.clientStatus === 'Contract') {
      // Active clients can NEVER be Win-Back
      brand.tags = brand.tags?.filter(tag => !tag.includes('📈 Win-Back') && !tag.includes('Re-Ignition')) || [];
      // Ensure Active tag is present
      if (!brand.tags.includes('🔥 Active Client')) {
        brand.tags.push('🔥 Active Client');
      }
    } else if (brand.clientStatus === 'Inactive') {
      // Inactive clients can NEVER be Active
      brand.tags = brand.tags?.filter(tag => !tag.includes('🔥 Active Client')) || [];
    }
    
    // New weighted scoring system with CORRECTED priority order
    let score = 0;
    
    // Check for all possible tag combinations
    const hasCommsDiscovery = brand.tags?.includes('💬 Comms Discovery');
    const hasCategoryMatch = brand.tags?.some(tag => 
      tag.includes('🎯 Category Match') || 
      tag.includes('🎯 Genre Match') || 
      tag.includes('🎯 Perfect Context Match')
    );
    const hasWinBack = brand.tags?.some(tag => 
      tag.includes('📈 Win-Back') || 
      tag.includes('📈 Re-Ignition Opportunity')
    );
    const hasActiveClient = brand.tags?.includes('🔥 Active Client');
    const hasDiscovery = brand.tags?.includes('🆕 Discovery');
    const hasWildcard = brand.tags?.includes('🚀 Wild Card');
    
    // Base scores according to CORRECTED priority order:
    // 1. Category Match (highest)
    // 2. Win-Back 
    // 3. Active Client
    // 4. Discovery
    // 5. Wild Card (lowest)
    
    if (hasCommsDiscovery) {
      score += 160; // Comms Discovery gets highest bonus (special case)
    }
    if (hasCategoryMatch) {
      score += 150; // Category Match - highest priority bucket
    }
    if (hasWinBack) {
      score += 120; // Win-Back - second priority
    }
    if (hasActiveClient) {
      score += 90; // Active Client - third priority
    }
    if (hasDiscovery) {
      score += 80; // Discovery - fourth priority
    }
    if (hasWildcard) {
      score += 70; // Wild Card - lowest priority
    }
    
    // Discovery bonus: +50 if Category Match but NOT Active Client
    if (hasCategoryMatch && !hasActiveClient) {
      score += 50;
    }
    
    // Partnership count bonus: 1-20 points scaled
    const partnershipCount = parseInt(brand.partnershipCount || brand.partnership_count || 0);
    score += Math.min(20, partnershipCount);
    
    brand.relevanceScore = score;
    return brand;
  }).sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  // Apply jitter if enabled - now targeting 30 for more generous default view
  let targetSize = 30;
  if (RECS_JITTER_TARGET && finalPartnershipData.synopsis) {
    const hashCode = finalPartnershipData.synopsis
      .split('')
      .reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0);
    const jitter = (Math.abs(hashCode) % 7) - 3; // -3..+3
    targetSize = Math.max(27, Math.min(33, 30 + jitter));  // Range: 27-33 brands
  }
  
  // Implement tiered curation for better diversity
  const diversifiedBrands = [];
  const addedIds = new Set();
  
  // Define buckets and their filters
  const buckets = [
    { name: 'Comms Discovery', filter: b => b.tags?.includes('💬 Comms Discovery') },
    { name: 'Category Match', filter: b => b.tags?.some(tag => tag.includes('🎯 Category Match')) },
    { name: 'Win-Back', filter: b => b.tags?.some(tag => tag.includes('📈 Win-Back')) },
    { name: 'Active Client', filter: b => b.tags?.includes('🔥 Active Client') },
    { name: 'Wild Card', filter: b => b.tags?.includes('🚀 Wild Card') }
  ];
  
  // Add top 2 from each bucket that has results
  for (const bucket of buckets) {
    const bucketBrands = allRankedBrands.filter(b => bucket.filter(b) && !addedIds.has(b.id));
    const topFromBucket = bucketBrands.slice(0, 2);
    
    for (const brand of topFromBucket) {
      diversifiedBrands.push(brand);
      addedIds.add(brand.id);
    }
  }
  
  // Fill remaining slots with highest-scoring brands not yet added
  for (const brand of allRankedBrands) {
    if (!addedIds.has(brand.id)) {
      diversifiedBrands.push(brand);
      addedIds.add(brand.id);
      if (diversifiedBrands.length >= targetSize) break;
    }
  }
  
  // Final brand list with diversity guarantee
  allRankedBrands = diversifiedBrands.slice(0, targetSize);
  
  // If we have communications data, enhance brands with context
  if (curatedResults.communications) {
    allRankedBrands = allRankedBrands.map(brand => {
      // Check if this brand appears in recent communications
      const brandName = brand.name || brand.brand;
      let contextFound = false;
      
      // Check meetings
      if (curatedResults.communications.meetings?.length > 0) {
        for (const meeting of curatedResults.communications.meetings) {
          if (meeting.title?.toLowerCase().includes(brandName.toLowerCase()) ||
              meeting.summary?.overview?.toLowerCase().includes(brandName.toLowerCase())) {
            brand.hasRecentActivity = true;
            brand.activityContext = `Recent meeting: "${meeting.title}" on ${meeting.dateString}`;
            contextFound = true;
            break;
          }
        }
      }
      
      // Check emails if no meeting context found
      if (!contextFound && curatedResults.communications.emails?.length > 0) {
        for (const email of curatedResults.communications.emails) {
          if (email.subject?.toLowerCase().includes(brandName.toLowerCase()) ||
              email.preview?.toLowerCase().includes(brandName.toLowerCase())) {
            brand.hasRecentActivity = true;
            brand.activityContext = `Recent email: "${email.subject}" from ${email.fromName || email.from}`;
            break;
          }
        }
      }
      
      return brand;
    });
  }
  
  // Smart selection logic for exactly 2 diverse brands for creative pitches
  const brandsForPitching = [];
  const usedIds = new Set();
  
  // Brand 1: Highest-scoring Win-Back brand
  const winBackBrands = allRankedBrands.filter(b => 
    b.tags?.some(tag => tag.includes('📈 Win-Back') || tag.includes('📈 Re-Ignition Opportunity'))
  );
  const categoryMatchBrands = allRankedBrands.filter(b => 
    b.tags?.some(tag => tag.includes('🎯 Category Match'))
  );
  const wildCardBrands = allRankedBrands.filter(b => 
    b.tags?.includes('🚀 Wild Card')
  );
  const activeClientBrands = allRankedBrands.filter(b => 
    b.tags?.includes('🔥 Active Client')
  );
  
  // Select Brand 1: Win-Back or fallback to Category Match
  if (winBackBrands.length > 0) {
    const brand1 = winBackBrands[0];
    brandsForPitching.push(brand1);
    usedIds.add(brand1.id);
  } else if (categoryMatchBrands.length > 0) {
    // Fallback: highest-scoring Category Match
    const brand1 = categoryMatchBrands.find(b => !usedIds.has(b.id));
    if (brand1) {
      brandsForPitching.push(brand1);
      usedIds.add(brand1.id);
    }
  }
  
  // Select Brand 2: Wild Card or fallback to Active Client
  if (wildCardBrands.length > 0 && !usedIds.has(wildCardBrands[0].id)) {
    const brand2 = wildCardBrands.find(b => !usedIds.has(b.id));
    if (brand2) {
      brandsForPitching.push(brand2);
      usedIds.add(brand2.id);
    }
  } else if (activeClientBrands.length > 0) {
    // Fallback: highest-scoring Active Client
    const brand2 = activeClientBrands.find(b => !usedIds.has(b.id));
    if (brand2) {
      brandsForPitching.push(brand2);
      usedIds.add(brand2.id);
    }
  }
  
  // Final fallback: if we don't have 2 brands yet, fill from overall top brands
  if (brandsForPitching.length < 2) {
    for (const brand of allRankedBrands) {
      if (!usedIds.has(brand.id)) {
        brandsForPitching.push(brand);
        usedIds.add(brand.id);
        if (brandsForPitching.length >= 2) break;
      }
    }
  }
  
  // Ensure we have at least 2 brands or take what we have
  const finalBrandsForPitching = brandsForPitching.slice(0, 2);
  
  // Generate creative content for selected brands
  const creativeResult = await generateCreativeContent(finalBrandsForPitching, {
    add,
    actualProjectName: knownProjectName || projectName, // Use original name if provided, else what we found
    search_term: intent.args.search_term,
    partnershipData: finalPartnershipData,
    communications: curatedResults.communications, // Pass communications for richer insights
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
