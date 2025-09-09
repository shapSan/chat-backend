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

/* Helper function to normalize HubSpot's inconsistent field names */
function normalizePartnership(src = {}) {
  // This function cleans up the inconsistent field names from HubSpot
  return {
    distributor: src.distributor ?? src.studio ?? src.distribution_partner,
    releaseDate: src.releaseDate ?? src.release__est__date ?? src.release_estimated ?? src.release ?? src.release_date,
    productionStartDate: src.start_date ?? src.productionStartDate ?? src.production_start ?? src.prod_start,
    productionType: src.production_type ?? src.productionType ?? src.prod_type,
    location: src.storyline_location__city_ ?? src.plot_location ?? src.location ?? src.city ?? src.shooting_location,
    time_period: src.time_period ?? src.period,
    audience_segment: src.audience_segment ?? src.audience ?? src.target_audience,
    genre_production: src.genre_production ?? src.genre ?? src.genres,
    cast: src.cast ?? src.stars ?? src.talent,
    synopsis: src.synopsis ?? src.logline ?? src.description,
    vibe: src.vibe ?? src.genre_production ?? src.genre ?? src.genres
  };
}

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
  if (brand.sourceBucket === '🚀 Net-New' || brand.sourceBucket === '🚀 Net-New Opportunity')
    return brand.reason || 'Trending brand with strong cultural relevance for target demo.';
  if (brand.sourceBucket === '🆕 Discovery')
    return 'Emerging brand opportunity aligned with production themes.';

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
 * Execute parallel HubSpot searches with optimized concurrency
 * @param {string[]} brandNames - Array of brand names to search
 * @param {number} maxConcurrent - Maximum concurrent searches (default 5 for better parallelization)
 * @returns {Array} Array of objects with searchTerm and matches
 */
export async function smartParallelSearch(brandNames, maxConcurrent = 5) {
  console.log('[smartParallelSearch] Starting parallel search for', brandNames.length, 'terms');
  
  // Filter and prioritize terms
  const filteredTerms = brandNames
    .filter(term => term && term.length >= 3) // Ignore very short terms
    .slice(0, 10); // Increased limit to 10 terms for better coverage
  
  if (filteredTerms.length === 0) {
    console.log('[smartParallelSearch] No valid search terms after filtering');
    return [];
  }
  
  console.log('[smartParallelSearch] Searching for:', filteredTerms);
  const startTime = Date.now();
  
  // Create all search promises upfront for true parallelization
  const searchPromises = filteredTerms.map((term, index) => {
    // Small stagger to avoid rate limiting (50ms between requests)
    const delay = index * 50;
    
    return new Promise(resolve => setTimeout(resolve, delay)).then(() => 
      hubspotAPI.searchBrands({
        query: term,
        limit: 10,
        properties: ['brand_name', 'main_category', 'product_sub_category__multi_', 
                     'client_status', 'client_type', 'partnership_count', 'deals_count', 
                     'hs_lastmodifieddate', 'secondary_owner', 'specialty_lead', 'one_sheet_link']
      }).then(result => {
        console.log(`[smartParallelSearch] ✓ Found ${result.results?.length || 0} brands for: ${term}`);
        return {
          searchTerm: term,
          matches: result.results || [],
          success: true
        };
      }).catch(error => {
        console.error(`[smartParallelSearch] ✗ Failed for ${term}:`, error.message);
        return {
          searchTerm: term,
          matches: [],
          error: error.message,
          success: false
        };
      })
    );
  });
  
  // Execute all searches in parallel with controlled concurrency
  // Using Promise.allSettled to ensure all complete even if some fail
  const searchResults = await Promise.allSettled(searchPromises);
  
  // Extract results from settled promises
  const finalResults = searchResults.map(result => 
    result.status === 'fulfilled' ? result.value : { searchTerm: '', matches: [], error: 'Promise rejected' }
  ).filter(r => r.searchTerm); // Filter out any empty results
  
  const duration = Date.now() - startTime;
  const totalMatches = finalResults.reduce((sum, r) => sum + r.matches.length, 0);
  const successCount = finalResults.filter(r => r.success).length;
  
  console.log(`[smartParallelSearch] Completed ${successCount}/${filteredTerms.length} searches in ${duration}ms, found ${totalMatches} total brands`);
  
  return finalResults;
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


async function runCommunicationsFirstSearch(intent, { add, knownProjectName, userMessage, mcpThinking, conversationContext }) {
  
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
          add({ type: 'info', text: `🎬 Analyzing project: "${projectName}"` });
        }
      }
    } catch (error) {
      console.error('[runCommunicationsFirstSearch] Error extracting data:', error);
    }
  }

  // STEP 2: HUBSPOT FETCH & NORMALIZATION (This part was already working)
  let partnershipData = null;
  if (projectName && hubspotAPI?.getPartnershipForProject) {
    try {
      const rawPartnershipData = await hubspotAPI.getPartnershipForProject(projectName);
      if (rawPartnershipData) {
        partnershipData = normalizePartnership(rawPartnershipData); // Uses the function we added
        console.log('[runCommunicationsFirstSearch] Normalized HubSpot Data:', JSON.stringify(partnershipData, null, 2));
        add({ type: 'result', text: `✅ Found partnership data in HubSpot` });
      }
    } catch (error) {
      console.error('[runCommunicationsFirstSearch] Error fetching partnership data:', error);
    }
  }
  
  // STEP 3: FIXED DATA MERGE LOGIC
  const hasContent = (val) => {
      if (val === null || val === undefined) return false;
      if (Array.isArray(val) && val.length === 0) return false;
      if (typeof val === 'string' && val.trim() === '') return false;
      return true;
  };

  const finalPartnershipData = {
      title: projectName || extractedData.title,
      distributor: hasContent(partnershipData?.distributor) ? partnershipData.distributor : extractedData.distributor,
      releaseDate: hasContent(partnershipData?.releaseDate) ? partnershipData.releaseDate : extractedData.releaseDate,
      productionStartDate: hasContent(partnershipData?.productionStartDate) ? partnershipData.productionStartDate : extractedData.startDate,
      productionType: hasContent(partnershipData?.productionType) ? partnershipData.productionType : extractedData.productionType,
      location: hasContent(partnershipData?.location) ? partnershipData.location : extractedData.location,
      cast: hasContent(partnershipData?.cast) ? partnershipData.cast : extractedData.cast,
      vibe: hasContent(partnershipData?.vibe) ? partnershipData.vibe : extractedData.vibe,
      synopsis: hasContent(partnershipData?.synopsis) ? partnershipData.synopsis : extractedData.synopsis,
  };
   if (!finalPartnershipData.vibe) finalPartnershipData.vibe = partnershipData?.genre_production;


  // ... The rest of the function continues from here ...
  // (Search communications, fetch brand buckets, apply signal booster, etc.)

  const commsResults = await searchCommunicationsForClues(finalPartnershipData, { add });
  
  add({ type: 'info', text: '🎯 Fetching brands from curated buckets...' });
  const traditionalResults = await fetchCuratedBrandBuckets(finalPartnershipData, { add });
  
  const commsText = [
    ...commsResults.meetings.map(m => `${m.title || ''} ${m.summary?.overview || ''} ${m.summary?.keywords?.join(' ') || ''}`),
    ...commsResults.emails.map(e => `${e.subject || ''} ${e.preview || ''}`)
  ].join(' ').toLowerCase();
  
  const boostedBrands = traditionalResults.brands.map(brand => {
    const brandName = (brand.name || brand.brand || '').toLowerCase();
    if (brandName && brandName.length > 2 && commsText.includes(brandName)) {
      brand.relevanceScore = (brand.relevanceScore || 100) + 75;
      brand.tags = [...(brand.tags || []), '💬 Recent Comms Mention'];
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
  
  let allRankedBrands = boostedBrands.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  
  // --- NEW: TIERED CURATION FOR A DIVERSE FINAL LIST ---
  const diversifiedBrands = [];
  const addedIds = new Set();
  const targetSize = 30;
  
  // Define buckets and their GUARANTEED quotas for the final list
  const buckets = [
    { name: 'Category Match', filter: b => b.tags?.some(tag => tag.includes('🎯')), quota: 5 },
    { name: 'Win-Back', filter: b => b.tags?.some(tag => tag.includes('📈')), quota: 4 },
    { name: 'Active Client', filter: b => b.tags?.some(tag => tag.includes('🔥')), quota: 4 },
    { name: 'Net-New', filter: b => b.tags?.some(tag => tag.includes('🚀')) || b.isWildcard, quota: 5 },
    { name: 'Discovery', filter: b => b.tags?.some(tag => tag.includes('🆕')), quota: 4 }
  ];
  
  // Tier 1: Fill quotas to guarantee representation from each bucket
  for (const bucket of buckets) {
    // Find the top brands for this bucket from the master list
    const topBrandsInBucket = allRankedBrands
      .filter(b => bucket.filter(b) && !addedIds.has(b.id))
      .slice(0, bucket.quota);
    
    for (const brand of topBrandsInBucket) {
      diversifiedBrands.push(brand);
      addedIds.add(brand.id);
    }
  }
  
  // Tier 2: Fill remaining spots with the best of the rest to reach the target size
  if (diversifiedBrands.length < targetSize) {
    for (const brand of allRankedBrands) {
      if (!addedIds.has(brand.id)) {
        diversifiedBrands.push(brand);
        if (diversifiedBrands.length >= targetSize) break;
      }
    }
  }
  
  const finalPickerList = diversifiedBrands.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, targetSize);
  // Update allRankedBrands to be the diversified list for consistency
  allRankedBrands = finalPickerList;
  
  // --- NEW, REFINED SELECTION LOGIC ---
  const brandsForPitching = [];
  const usedIds = new Set();
  
  // Step 1: Find the IDEAL "safe bet". This is a brand that is BOTH an established partner AND a perfect creative fit.
  // It's the highest-scoring brand that has a "Category Match" tag AND either a "Win-Back" or "Active Client" tag.
  const idealSafeBet = allRankedBrands.find(b => 
    b.tags?.some(tag => tag.includes('🎯 Category Match')) &&
    b.tags?.some(tag => tag.includes('📈 Win-Back') || tag.includes('🔥 Active Client'))
  );
  
  // Step 2: If no ideal candidate exists, find the best FALLBACK "safe bet".
  // This is simply the highest-scoring brand that is a "Category Match", regardless of its status.
  // This prioritizes creative fit above all else.
  const fallbackSafeBet = allRankedBrands.find(b =>
    b.tags?.some(tag => tag.includes('🎯 Category Match'))
  );
  
  // Step 3: Add the best available "safe bet" to our list.
  const safeBet = idealSafeBet || fallbackSafeBet;
  if (safeBet) {
    brandsForPitching.push(safeBet);
    usedIds.add(safeBet.id);
  }
  
  // Step 4: Find the best "creative bet". This is the highest-scoring "Net-New" that we haven't already picked.
  const creativeBet = allRankedBrands.find(b => 
    (b.tags?.some(tag => tag.includes('🚀 Net-New')) || b.isWildcard) && !usedIds.has(b.id)
  );
  if (creativeBet) {
    brandsForPitching.push(creativeBet);
    usedIds.add(creativeBet.id);
  }
  
  // Step 5: Final fallback to ensure we always have two brands.
  // This fills any remaining slots with the best overall brands that haven't been picked yet.
  if (brandsForPitching.length < 2) {
    for (const brand of allRankedBrands) {
      if (!usedIds.has(brand.id)) {
        brandsForPitching.push(brand);
        if (brandsForPitching.length >= 2) break;
      }
    }
  }
  // --- END OF NEW LOGIC ---
  
  const creativeResult = await generateCreativeContent(brandsForPitching.slice(0, 2), { add, actualProjectName: projectName, search_term: userMessage, partnershipData: finalPartnershipData, communications: commsResults });
  
  return prepareFrontendPayload({ enrichedBrands: creativeResult.enrichedBrands, allRankedBrands, mcpThinking, projectName, partnershipData: finalPartnershipData, communications: commsResults, finalReplyText: creativeResult.finalReplyText });
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
  
  // --- NEW LOGIC to track keywords ---
  const allMeetings = new Map();
  const allEmails = new Map();
  
  if (primarySearchTerms.length > 0) {
    add({ type: 'info', text: `🔍 Searching comms for: ${primarySearchTerms.join(', ')}` });
    const DAYS = 90;
    const fromDate = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
    
    for (const term of primarySearchTerms) {
      const [ffResult, o365Result] = await Promise.allSettled([
        firefliesApiKey ? searchFireflies([term], { limit: 10, fromDate }) : Promise.resolve({ transcripts: [] }),
        o365API.searchEmails ? withTimeout(o365API.searchEmails([term], { limit: 10 }), 15000, { emails: [] }) : Promise.resolve({ emails: [] })
      ]);
      
      if (ffResult.status === 'fulfilled' && ffResult.value.transcripts) {
        ffResult.value.transcripts.forEach(t => {
          if (!allMeetings.has(t.id)) {
            allMeetings.set(t.id, { ...t, matchedKeyword: term });
          }
        });
      }
      if (o365Result.status === 'fulfilled' && o365Result.value.emails) {
        o365Result.value.emails.forEach(e => {
          if (!allEmails.has(e.id)) {
            allEmails.set(e.id, { ...e, matchedKeyword: term });
          }
        });
      }
    }
  }
  // --- END OF NEW LOGIC ---
  
  // If no results, get recent transcripts as fallback with proper timeframe
  if (allMeetings.size === 0 && firefliesApiKey) {
    add({ type: 'info', text: '🔍 Getting recent meeting transcripts as fallback' });
    try {
      const DAYS = 90; // Same rolling window for fallback
      const fromDate = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
      const recentResult = await searchFireflies([], { limit: 10, fromDate }); // Empty search = recent
      if (recentResult.transcripts) {
        recentResult.transcripts.forEach(t => {
          if (!allMeetings.has(t.id)) {
            allMeetings.set(t.id, { ...t, matchedKeyword: 'recent activity' });
          }
        });
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

  // --- Generate Categories First (needed by other buckets) ---
  const relevantCategories = await generateDynamicCategories(partnershipData, { add });

  // --- Bucket 1: Active Clients ---
  // Find brands that are currently Active AND have significant partnership history AND match categories
  const activeClientsPromise = relevantCategories.length > 0 ? 
    hubspotAPI.searchBrands({
      limit: quotas.active,
      filterGroups: [{ filters: [
        { propertyName: 'client_status', operator: 'EQ', value: 'Active' },
        { propertyName: 'partnership_count', operator: 'GT', value: '10' }, // Top partners only
        { propertyName: 'main_category', operator: 'IN', values: relevantCategories } // Only contextually relevant
      ] }],
      sorts: [{ propertyName: 'partnership_count', direction: 'DESCENDING' }] // Prioritize most experienced
    }) : 
    // Fallback if no categories generated
    hubspotAPI.searchBrands({
      limit: quotas.active,
      filterGroups: [{ filters: [
        { propertyName: 'client_status', operator: 'EQ', value: 'Active' },
        { propertyName: 'partnership_count', operator: 'GT', value: '10' }
      ] }],
      sorts: [{ propertyName: 'partnership_count', direction: 'DESCENDING' }]
    });

  // --- Bucket 2: Category-Matched Prospects (Dynamic) ---
  
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
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }] // Prioritize recent engagement for discovery
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
  // Re-engage previously successful partners who are now inactive AND match categories
  const dormantPromise = relevantCategories.length > 0 ?
    hubspotAPI.searchBrands({
      limit: quotas.dormant,
      filterGroups: [{ filters: [
        { propertyName: 'client_status', operator: 'EQ', value: 'Inactive' },
        { propertyName: 'partnership_count', operator: 'GT', value: '0' }, // Must be former partner, not just prospect
        { propertyName: 'main_category', operator: 'IN', values: relevantCategories } // Only contextually relevant
      ]}],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }] // Find "warmest" dormant accounts
    }) :
    // Fallback if no categories
    hubspotAPI.searchBrands({
      limit: quotas.dormant,
      filterGroups: [{ filters: [
        { propertyName: 'client_status', operator: 'EQ', value: 'Inactive' },
        { propertyName: 'partnership_count', operator: 'GT', value: '0' }
      ]}],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }]
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

  // Execute all bucket searches in parallel for better performance
  const startTime = Date.now();
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
  const searchDuration = Date.now() - startTime;
  console.log(`[fetchCuratedBrandBuckets] All bucket searches completed in ${searchDuration}ms`);

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
    // Extract all owner fields with multiple naming variations
    const secondaryOwner = brand.properties?.secondary_owner || 
                          brand.properties?.secondaryowner ||
                          brand.properties?.secondary_owner_id ||
                          brand.properties?.secondaryOwnerId || null;
    const specialtyLead = brand.properties?.specialty_lead || 
                         brand.properties?.specialtylead ||
                         brand.properties?.specialty_lead_id ||
                         brand.properties?.specialtyLeadId || null;
    const partnershipsLead = brand.properties?.partnerships_lead ||
                            brand.properties?.partnershipslead ||
                            brand.properties?.partnerships_lead_id || null;
    const primaryOwner = brand.properties?.hubspot_owner_id ||
                        brand.properties?.hubspot_owner ||
                        brand.properties?.hs_owner_id ||
                        brand.properties?.owner || null;
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
      partnerships_lead: partnershipsLead,
      hubspot_owner_id: primaryOwner,
      secondaryOwnerId: secondaryOwner,  // For compatibility
      specialtyLeadId: specialtyLead,     // For compatibility
      partnershipsLeadId: partnershipsLead,  // For compatibility
      hubspotOwnerId: primaryOwner,  // For compatibility
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
  add({ type: 'process', text: '✍️ Finding evidence & generating creative...' });

  // --- NEW: Find specific evidence for each brand ---
  const brandsWithEvidence = topBrands.map(brand => {
    let evidence = null;
    const brandNameLower = (brand.name || '').toLowerCase();

    if (communications?.meetings?.length > 0) {
      const relevantMeeting = communications.meetings.find(m =>
        (m.title?.toLowerCase().includes(brandNameLower) || m.summary?.overview?.toLowerCase().includes(brandNameLower))
      );
      if (relevantMeeting) {
        evidence = `Referenced in meeting: "${relevantMeeting.title}" on ${relevantMeeting.dateString}.`;
      }
    }

    if (!evidence && communications?.emails?.length > 0) {
      const relevantEmail = communications.emails.find(e =>
        (e.subject?.toLowerCase().includes(brandNameLower) || e.preview?.toLowerCase().includes(brandNameLower))
      );
      if (relevantEmail) {
        evidence = `Referenced in email from ${relevantEmail.fromName || relevantEmail.from}: "${relevantEmail.subject}".`;
      }
    }

    return { ...brand, evidence };
  });
  // --- END OF NEW EVIDENCE LOGIC ---

  // Add any additional communications context to the brands
  const brandsWithContext = brandsWithEvidence.map(brand => {
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
  const creativePrompt = `You are Hollywood Branded's brand integration strategist. Your goal is to suggest natural, budget-realistic partnerships for the project "${actualProjectName}". Your ideas must feel organic to the story and excite both the production and the brand.

<PROJECT_DETAILS>
Synopsis: ${partnershipData?.synopsis || 'Not provided'}
Genre/Vibe: ${partnershipData?.vibe || partnershipData?.genre_production || 'Not specified'}
Cast: ${Array.isArray(partnershipData?.cast) ? partnershipData.cast.join(', ') : partnershipData?.cast || 'Not specified'}
</PROJECT_DETAILS>

You will generate ideas for these two brands:
${brandsWithContext.map((brand, idx) => `
<BRAND_${idx + 1}>
Name: ${brand.name}
Category: ${brand.category}
Subcategories: ${Array.isArray(brand.subcategories) ? brand.subcategories.join(', ') : brand.subcategories || 'N/A'}
EVIDENCE_PROVIDED: ${brand.evidence || "No specific meeting or email mentions were found for this brand."}
</BRAND_${idx + 1}>
`).join('\n')}

CRITICAL INSTRUCTIONS:
1. **Integration Idea:** Write a brief, exciting on-screen or campaign description. It should be a short elevator pitch.
2. **Why it works:** Your reasoning MUST deeply connect the brand's specific Category and Subcategories to the project's Genre, Vibe, and Synopsis. This is the most important rule. Explain the natural, organic fit.
3. **HB Insights:** You MUST use the exact text from "EVIDENCE_PROVIDED" for your insight.
   - If evidence exists (e.g., "Referenced in meeting..."), use that exact sentence.
   - If the evidence is "No specific meeting or email mentions were found for this brand.", you MUST state: "This is a fresh creative idea based on strong contextual alignment."
   - DO NOT mention partnership stats (\`171 partnerships\`, etc.). DO NOT LIE or invent insights.
4. **Formatting:** Follow the output format EXACTLY. Do not include any text before the first "Brand:" or after the last "HB Insights:". Do not use asterisks or any other formatting on the brand names. Do not summarize your response.

<OUTPUT_FORMAT>
Brand: [Brand Name]
Integration: [Your creative integration idea.]
Why it works: [Your reasoning for the natural fit based on Category/Genre connection.]
HB Insights: [Your insight based on the EVIDENCE_PROVIDED rule.]
</OUTPUT_FORMAT>`;

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
    // Helper to clean the name for matching by removing asterisks and text in parentheses.
    const cleanBrandNameForMatch = (originalBrand.name || '')
      .toLowerCase()
      .replace(/\* /g, '')
      .replace(/\s*\(.*\)/, '')
      .trim();

    // Use the cleaned name for a more reliable match.
    const brandSectionText = brandSections.find(section =>
      section.toLowerCase().startsWith(`brand: ${cleanBrandNameForMatch}`)
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
      console.log('[handleClaudeSearch] Creating pitches for brands:', intent.args);
      let brands = intent.args.brand_names || [];
      
      // Extract brand IDs/names from the message if not in args
      if (brands.length === 0 && userMessage.includes('Generate brand integration ideas for:')) {
        const match = userMessage.match(/Generate brand integration ideas for:\s*(.+?)(?:\s+for|$)/i);
        if (match) {
          brands = match[1].split(/,\s*/).map(b => b.trim());
        }
      }
      
      console.log('[handleClaudeSearch] Extracted brands:', brands);
      
      // Get project context
      let projectContext = knownProjectName;
      if (!projectContext && lastProductionContext) {
        // Try to extract project name from last production context
        const projectMatch = lastProductionContext.match(/(?:title|project|production):\s*([^,\n]+)/i);
        if (projectMatch) {
          projectContext = projectMatch[1].trim();
        }
      }
      if (!projectContext && conversationContext) {
        // Try to extract from conversation context
        const contextMatch = conversationContext.match(/\[PRODUCTION:([^\]]+)\]/i);
        if (contextMatch) {
          projectContext = contextMatch[1].trim();
        }
      }
      
      console.log('[handleClaudeSearch] Project context:', projectContext);
      
      // Process each brand - could be ID or name
      const processedBrands = [];
      const brandNamesForMessage = [];
      
      for (const brandInput of brands) {
        const trimmedInput = String(brandInput).trim();
        
        // Check if it's a HubSpot ID (numeric string)
        if (/^\d{10,}$/.test(trimmedInput)) {
          add({ type: 'info', text: `🔍 Looking up brand with ID ${trimmedInput}...` });
          
          try {
            // Use HubSpot API to get company by ID
            const searchResult = await hubspotAPI.searchBrands({
              filterGroups: [{
                filters: [{
                  propertyName: 'hs_object_id',
                  operator: 'EQ',
                  value: trimmedInput
                }]
              }],
              limit: 1,
              properties: ['brand_name', 'name', 'main_category', 'product_sub_category__multi_', 
                          'client_status', 'client_type', 'partnership_count', 'deals_count']
            });
            
            if (searchResult?.results?.length > 0) {
              const brand = searchResult.results[0];
              const brandName = brand.properties.brand_name || brand.properties.name || `Brand ${trimmedInput}`;
              
              processedBrands.push({
                id: brand.id,
                name: brandName,
                category: brand.properties.main_category || 'Unknown',
                subcategories: brand.properties.product_sub_category__multi_ || '',
                clientStatus: brand.properties.client_status || '',
                clientType: brand.properties.client_type || '',
                partnershipCount: brand.properties.partnership_count || '0',
                dealsCount: brand.properties.deals_count || '0'
              });
              
              brandNamesForMessage.push(brandName);
              add({ type: 'result', text: `✅ Found: ${brandName}` });
            } else {
              // Can't find by ID - use placeholder
              const placeholderName = `Unknown Brand (ID: ${trimmedInput})`;
              processedBrands.push({
                id: trimmedInput,
                name: placeholderName,
                category: 'Unknown',
                isExternal: true
              });
              brandNamesForMessage.push(placeholderName);
              add({ type: 'warning', text: `⚠️ Could not find brand with ID ${trimmedInput}` });
            }
          } catch (error) {
            console.error(`[handleClaudeSearch] Error fetching brand ID ${trimmedInput}:`, error);
            const errorName = `Unknown Brand (ID: ${trimmedInput})`;
            processedBrands.push({
              id: trimmedInput,
              name: errorName,
              category: 'Unknown',
              error: true
            });
            brandNamesForMessage.push(errorName);
          }
        } else {
          // It's a brand name - search for it
          add({ type: 'info', text: `🔍 Searching for brand "${trimmedInput}"...` });
          
          try {
            const searchResult = await hubspotAPI.searchBrands({
              query: trimmedInput,
              limit: 1,
              properties: ['brand_name', 'name', 'main_category', 'product_sub_category__multi_', 
                          'client_status', 'client_type', 'partnership_count', 'deals_count']
            });
            
            if (searchResult?.results?.length > 0) {
              const brand = searchResult.results[0];
              const brandName = brand.properties.brand_name || brand.properties.name || trimmedInput;
              
              processedBrands.push({
                id: brand.id,
                name: brandName,
                category: brand.properties.main_category || 'Unknown',
                subcategories: brand.properties.product_sub_category__multi_ || '',
                clientStatus: brand.properties.client_status || '',
                clientType: brand.properties.client_type || '',
                partnershipCount: brand.properties.partnership_count || '0',
                dealsCount: brand.properties.deals_count || '0'
              });
              
              brandNamesForMessage.push(brandName);
              add({ type: 'result', text: `✅ Found: ${brandName} in HubSpot` });
            } else {
              // Not in HubSpot - treat as external brand
              processedBrands.push({
                id: `external-${trimmedInput.replace(/\s+/g, '-').toLowerCase()}`,
                name: trimmedInput,
                category: 'Unknown',
                isExternal: true
              });
              brandNamesForMessage.push(trimmedInput);
              add({ type: 'info', text: `ℹ️ "${trimmedInput}" not found in HubSpot, treating as external brand` });
            }
          } catch (error) {
            console.error(`[handleClaudeSearch] Error searching for brand "${trimmedInput}":`, error);
            processedBrands.push({
              id: `error-${trimmedInput.replace(/\s+/g, '-').toLowerCase()}`,
              name: trimmedInput,
              category: 'Unknown',
              error: true
            });
            brandNamesForMessage.push(trimmedInput);
          }
        }
      }
    
      if (processedBrands.length === 0) {
        return {
          mcpThinking,
          organizedData: {
            dataType: 'ERROR',
            message: 'No brands could be processed. Please provide valid brand names or IDs.',
          },
        };
      }
    
      // Update the user message to show brand names instead of IDs
      const updatedUserMessage = `Generate brand integration ideas for: ${brandNamesForMessage.join(', ')}${projectContext ? ` for ${projectContext}` : ''}`;
      add({ type: 'start', text: `🧠 ${updatedUserMessage}` });
    
      // Get partnership data if we have a project context
      let partnershipData = null;
      if (projectContext && hubspotAPI?.getPartnershipForProject) {
        try {
          partnershipData = await hubspotAPI.getPartnershipForProject(projectContext);
          if (partnershipData) {
            console.log('[handleClaudeSearch] Found partnership data for project:', projectContext);
          }
        } catch (error) {
          console.error('[handleClaudeSearch] Error fetching partnership data:', error);
        }
      }
    
      // Generate creative content for these brands
      const creativeResult = await generateCreativeContent(processedBrands.slice(0, 5), {
        add,
        actualProjectName: projectContext || 'your project',
        search_term: updatedUserMessage,
        partnershipData: partnershipData || {
          title: projectContext,
          synopsis: lastProductionContext
        }
      });
    
      return {
        mcpThinking,
        finalReplyText: creativeResult.finalReplyText || `Generated integration ideas for ${brandNamesForMessage.join(', ')}${projectContext ? ` for ${projectContext}` : ''}`,
        organizedData: {
          dataType: 'BRAND_RECOMMENDATIONS',
          detailedBrands: creativeResult.enrichedBrands || processedBrands,
          brandSuggestions: [],
          projectName: projectContext || knownProjectName,
          partnershipData: partnershipData || {
            title: projectContext,
            synopsis: lastProductionContext
          },
          context: lastProductionContext || conversationContext || '',
        },
      };
    }

    case 'answer_general_question':
    default:
      return null;
  }
}
