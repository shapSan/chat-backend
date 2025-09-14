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

// Import what we need locally
import { 
  extractJson, 
  extractLastProduction, 
  extractGenreFromSynopsis, 
  getConversationHistory, 
  shouldUseSearch, 
  progressInit as utilsProgressInit, 
  progressPush as utilsProgressPush, 
  progressDone as utilsProgressDone,
  progKey as utilsProgKey
} from './core.utils.js';
import { normalizePartnership } from './core.tags.js';

// Re-export from core.utils.js
export { 
  updateAirtableConversation, 
  extractLastProduction, 
  extractGenreFromSynopsis, 
  getConversationHistory, 
  shouldUseSearch, 
  progressInit,
  progressPush,
  progressDone,
  extractJson,
  progKey
} from './core.utils.js';

// Re-export from core.tags.js
export { 
  narrowWithIntelligentTags, 
  normalizePartnership 
} from './core.tags.js';

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
  // This is now just a fallback - the AI should generate specific reasons
  const brandName = brand.brand_name || brand.properties?.brand_name || 'Brand';
  const category = (brand.main_category || brand.category || 'Product').toLowerCase();
  const title = partnershipData.title || 'the project';
  const genre = (partnershipData.vibe || partnershipData.genre_production || 'content').toLowerCase();
  
  // Generate a slightly more specific fallback reason
  const categoryClean = category.charAt(0).toUpperCase() + category.slice(1);
  return `${categoryClean} opportunities in ${genre} scenes for ${title}`;
}

/* =========================
 * KV PROGRESS HELPERS
 * ======================= */
// Now imported from core.utils.js - see imports section

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
        description: 'Use when user wants detailed integration ideas for specific named brands. Includes: "create pitches for [brands]", "integration ideas for [brands]", "[brands] for [production]", or when user picks specific brands from the brand picker.',
        parameters: {
          type: 'object',
          properties: { 
            brand_names: { type: 'array', items: { type: 'string' } },
            production: { type: 'string', description: 'Optional production/project name' }
          },
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

ROUTING RULES:
- "find brands" / "brands for [production]" / vague brand search → find_brands
- "[specific brands] for [production]" / "pitches for [brands]" / "integration ideas for [brands]" → create_pitches_for_brands
- Any request for emails/meetings/communications → get_brand_activity
- User picked specific brands from picker → create_pitches_for_brands
- else → answer_general_question

Examples:
- "Find brands for Fast 11" → find_brands
- "Nike and Adidas for Fast 11" → create_pitches_for_brands with ["Nike", "Adidas"]
- "Create pitches for Doritos" → create_pitches_for_brands with ["Doritos"]
- "Show me emails about Nike" → get_brand_activity`;

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

/**
 * AI brand picker that understands project context and selects brands with natural fit
 */
async function getCreativeFitBrands(partnershipData, { add }) {
  // Check for production-specific cached results first
  const projectName = partnershipData.title || partnershipData.partnership_name || 'unknown';
  const cacheKey = `brand-matches:${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  
  try {
    const cachedMatches = await kv.get(cacheKey);
    // Only use cache if we have a reasonable number of brands (at least 20)
    if (cachedMatches && Array.isArray(cachedMatches) && cachedMatches.length >= 20) {
      add({ type: 'info', text: `📦 Using cached brand matches for "${projectName}" (${cachedMatches.length} brands)` });
      return cachedMatches;
    } else if (cachedMatches && cachedMatches.length < 20) {
      console.log(`[getCreativeFitBrands] Cache has only ${cachedMatches.length} brands, regenerating...`);
    }
  } catch (error) {
    console.log('[getCreativeFitBrands] Cache check failed:', error.message);
  }
  
  // Load brands from cache
  add({ type: 'process', text: '📦 Loading brand database...' });
  const cachedBrands = await kv.get('hubspot-brand-cache');
  if (!Array.isArray(cachedBrands) || cachedBrands.length === 0) {
    add({ type: 'warning', text: '⚠️ Brand cache is empty. Cannot proceed.' });
    return [];
  }
  
  // Extract ALL project details for context understanding
  const projectContext = {
    title: partnershipData.title || 'Unknown Project',
    genre: partnershipData.vibe || partnershipData.genre_production || 'Drama',
    rating: partnershipData.rating || 'PG-13',
    synopsis: partnershipData.synopsis || 'No synopsis provided',
    cast: Array.isArray(partnershipData.cast) ? partnershipData.cast.join(', ') : (partnershipData.cast || 'Not specified'),
    location: partnershipData.location || partnershipData.plot_location || 'Not specified',
    distributor: partnershipData.distributor || 'Not specified',
    releaseDate: partnershipData.releaseDate || 'TBD'
  };
  
  add({ type: 'info', text: `🎬 Analyzing ${projectContext.genre} project: "${projectContext.title}"` });

  // Create brand list with categories for AI to analyze (limit to 400 for token efficiency)
  const brandsToAnalyze = cachedBrands.slice(0, 400);
  const brandList = brandsToAnalyze.map((b, idx) => {
    const name = b.properties?.brand_name || 'Unknown';
    const category = b.properties?.main_category || 'General';
    const subCats = b.properties?.product_sub_category__multi_ || '';
    const fullCategory = subCats ? `${category}: ${subCats}` : category;
    return `${idx + 1}. ${name} [${fullCategory}]`;
  }).join('\n');

  // STEP 1: Fast selection of 30 brands (no reasons)
  const selectionPrompt = `You are a brand integration expert. Analyze this project:

PROJECT: "${projectContext.title}"
• Genre/Tone: ${projectContext.genre} (${projectContext.rating})
• Story: ${projectContext.synopsis}

From the following list of brands, select the 30 that are the best creative fit.

BRANDS:
${brandList}

CRITICAL: Return ONLY a valid JSON object with a single key "selected_names" containing an array of the 30 brand names you picked. Do not provide reasons or any other text.

Example Output: {"selected_names": ["Brand A", "Brand B", ...]}`;

  try {
    add({ type: 'process', text: '🤖 AI selecting best-fit brands (step 1/2)...' });
    
    // First AI call - just selection
    const selectionResponse = await withTimeout(
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
        body: JSON.stringify({
          model: MODELS.openai.chat,  // UPGRADED from chatMini to chat
          messages: [
            { 
              role: 'system', 
              content: 'You are a brand selection expert. Return only valid JSON with selected_names array.'
            },
            { role: 'user', content: selectionPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.5,
          max_tokens: 500
        })
      }),
      30000,  // INCREASED from 10 seconds to 30 seconds for selection
      null
    );

    if (!selectionResponse || !selectionResponse.ok) {
      throw new Error(`Selection failed: ${selectionResponse ? await selectionResponse.text() : 'Timeout'}`);
    }

    const selectionData = await selectionResponse.json();
    const selectedNames = JSON.parse(selectionData.choices?.[0]?.message?.content || '{}').selected_names || [];
    
    if (!Array.isArray(selectedNames) || selectedNames.length === 0) {
      throw new Error('AI returned no brand selections');
    }
    
    console.log(`[getCreativeFitBrands] Step 1 complete: Selected ${selectedNames.length} brands`);
    
    // STEP 2: Generate reasons for the selected brands
    const reasonPrompt = `You are a brand integration expert. For the project "${projectContext.title}", write a specific, unique reason (max 15 words) for why each of the following 30 brands is a great fit.

BRANDS:
${selectedNames.join("\n")}

CRITICAL: Return ONLY a valid JSON object where each key is a brand name and the value is its integration reason.

Example Output: {"Brand A": "Reason for A...", "Brand B": "Reason for B..."}`;
    
    add({ type: 'process', text: '🤖 AI generating integration reasons (step 2/2)...' });
    
    // Second AI call - generate reasons
    const reasonResponse = await withTimeout(
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
        body: JSON.stringify({
          model: MODELS.openai.chat,  // UPGRADED from chatMini to chat
          messages: [
            { 
              role: 'system', 
              content: 'You are a brand integration specialist. For each brand, provide a specific, unique reason (max 15 words) showing why it fits THIS exact project. Be specific about scenes, characters, or story elements.'
            },
            { role: 'user', content: reasonPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.7,
          max_tokens: 1500
        })
      }),
      30000,  // INCREASED from 10 seconds to 30 seconds for reasons
      null
    );
    
    let reasons = {};
    if (reasonResponse && reasonResponse.ok) {
      const reasonData = await reasonResponse.json();
      reasons = JSON.parse(reasonData.choices?.[0]?.message?.content || '{}');
      console.log(`[getCreativeFitBrands] Step 2 complete: Generated ${Object.keys(reasons).length} reasons`);
    } else {
      console.warn('[getCreativeFitBrands] Reason generation failed, using fallback reasons');
      // Create fallback reasons if the second call fails
      selectedNames.forEach(name => {
        reasons[name] = `Natural fit for ${projectContext.genre} storytelling`;
      });
    }
    
    // Combine results into selections array
    const selections = selectedNames.map(name => ({
      name: name,
      reason: reasons[name] || `Aligns with ${projectContext.genre} themes`
    }));

    if (!Array.isArray(selections) || selections.length === 0) {
      throw new Error('AI returned no selections');
    }

    console.log(`[getCreativeFitBrands] AI selected ${selections.length} brands with natural fit reasons`);

    // Map selections back to full brand objects
    const brandMap = new Map(
      brandsToAnalyze.map(b => [
        (b.properties?.brand_name || '').toLowerCase(), 
        b
      ])
    );
    
    const selectedBrands = [];
    for (const selection of selections) {
      const brand = brandMap.get(selection.name.toLowerCase());
      if (brand) {
        selectedBrands.push({
          ...brand,
          brand_name: brand.properties?.brand_name || selection.name,
          main_category: brand.properties?.main_category || 'General',
          product_sub_category__multi_: brand.properties?.product_sub_category__multi_ || '',
          relevanceScore: 80 + Math.random() * 20, // 80-100 for selected brands
          reason: selection.reason,
          relevanceReason: selection.reason,
          tags: ['🎯 Natural Fit'],
          source: 'ai-context-analysis'
        });
      }
    }

    // Ensure we have exactly 30 brands
    const finalBrands = selectedBrands.slice(0, 30);
    
    // If we need more, add from remaining with generic reasons
    while (finalBrands.length < 30 && brandsToAnalyze.length > finalBrands.length) {
      const usedNames = new Set(finalBrands.map(b => (b.brand_name || b.properties?.brand_name || '').toLowerCase()));
      const nextBrand = brandsToAnalyze.find(b => 
        !usedNames.has((b.properties?.brand_name || '').toLowerCase())
      );
      
      if (nextBrand) {
        finalBrands.push({
          ...nextBrand,
          brand_name: nextBrand.properties?.brand_name || 'Unknown',
          main_category: nextBrand.properties?.main_category || 'General',
          relevanceScore: 60 + Math.random() * 20, // 60-80 for fallback
          reason: `${nextBrand.properties?.main_category || 'Brand'} aligns with ${projectContext.genre} themes`,
          relevanceReason: `Potential fit for ${projectContext.genre} content`,
          tags: ['📋 Additional Option'],
          source: 'fallback'
        });
      } else {
        break;
      }
    }

    // Log sample reasons for debugging
    if (finalBrands.length > 0) {
      console.log('[getCreativeFitBrands] Sample natural fit reasons:');
      finalBrands.slice(0, 3).forEach(b => {
        console.log(`  - ${b.name}: "${b.reason}"`);
      });
    }

    add({ type: 'result', text: `✅ Selected ${finalBrands.length} brands with natural fit for "${projectContext.title}"` });
    
    // Cache the results (24 hour TTL)
    try {
      await kv.set(cacheKey, finalBrands, { ex: 86400 });
    } catch (error) {
      console.error('[getCreativeFitBrands] Cache save failed:', error.message);
    }
    
    return finalBrands;

  } catch (error) {
    console.error('[getCreativeFitBrands] Error:', error.message);
    add({ type: 'warning', text: `⚠️ AI analysis failed, using fallback selection` });
    
    // Fallback: return first 30 brands with better contextual reasons
    return brandsToAnalyze.slice(0, 30).map(b => {
      const name = b.properties?.brand_name || 'Unknown';
      const category = b.properties?.main_category || 'General';
      const subCats = b.properties?.product_sub_category__multi_ || '';
      
      // Generate a more specific fallback reason based on available data
      let reason = '';
      if (category.toLowerCase().includes('home') && projectContext.genre.toLowerCase().includes('comedy')) {
        reason = `Home products for domestic comedy scenes in ${projectContext.title}`;
      } else if (category.toLowerCase().includes('tech') && projectContext.genre.toLowerCase().includes('horror')) {
        reason = `Tech elements for modern horror atmosphere`;
      } else if (category.toLowerCase().includes('food')) {
        reason = `Food/beverage for character moments and social scenes`;
      } else if (subCats.toLowerCase().includes('appliance')) {
        reason = `Household scenes and character daily life moments`;
      } else {
        reason = `${category} elements for ${projectContext.genre.toLowerCase()} storytelling`;
      }
      
      return {
        ...b,
        brand_name: name,
        main_category: category,
        product_sub_category__multi_: subCats,
        relevanceScore: 50,
        reason: reason,
        relevanceReason: reason
      };
    });
  }
}
export async function runBrandSearchOrchestrator(
  intent,
  { add, knownProjectName, userMessage, mcpThinking, conversationContext, lastProductionContext }
) {
  // Step 1: Have AI structure the entire input once, properly
  let structuredInput = null;
  if (userMessage && openAIApiKey) {
    try {
      const structurePrompt = `Parse this film/TV project description into structured data.
Prioritize the "Additional Context" as the main source of truth if it is provided.

IMPORTANT: Extract the actual title, not descriptions. "Scary Movie A reboot" means title is "Scary Movie".

User's immediate request: "${userMessage}"

${lastProductionContext ? `Additional Context:\n"""\n${lastProductionContext}\n"""` : ''}

Return this exact JSON structure:
{
  "title": "actual project title",
  "synopsis": "full plot description",
  "genre": "genre/vibe",
  "cast": ["actor1", "actor2"],
  "location": "filming location",
  "releaseDate": "YYYY-MM-DD or null",
  "productionStartDate": "YYYY-MM-DD or null",
  "distributor": "studio/distributor",
  "notes": "any other important notes from the input"
}`;
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
        body: JSON.stringify({
          model: MODELS.openai.chatMini,
          messages: [
            { role: 'system', content: 'Parse film/TV project descriptions into clean JSON. Extract actual titles, not descriptive text.' },
            { role: 'user', content: structurePrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 500
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        structuredInput = JSON.parse(data.choices?.[0]?.message?.content || '{}');
        console.log('[runBrandSearchOrchestrator] AI structured input:', structuredInput);
      }
    } catch (e) {
      console.log('[runBrandSearchOrchestrator] AI structuring failed:', e.message);
    }
  }
  
  // Step 2: Use structured title or fall back to intent
  let projectName = knownProjectName || structuredInput?.title || intent?.args?.search_term || '';
  let extractedData = structuredInput || { title: projectName };
  
  let commsResults = { meetings: [], emails: [], brandHasEvidence: () => false };
  let extractedKeywords = [];

  // STEP 2: HUBSPOT FETCH & NORMALIZATION (This part was already working)
  add({ type: 'process', text: `🔍 Checking HubSpot for "${projectName || 'unknown project'}"...` });
  let partnershipData = null;
  if (projectName && hubspotAPI?.getPartnershipForProject) {
    try {
      const rawPartnershipData = await hubspotAPI.getPartnershipForProject(projectName);
      if (rawPartnershipData) {
        partnershipData = normalizePartnership(rawPartnershipData); // Uses the function we added
        console.log('[runCommunicationsFirstSearch] Normalized HubSpot Data:', JSON.stringify(partnershipData, null, 2));
        add({ type: 'result', text: `✅ Found "${projectName}" in HubSpot with synopsis` });
      } else {
        add({ type: 'info', text: `ℹ️ "${projectName}" not in HubSpot - using extracted details from message` });
      }
    } catch (error) {
      console.error('[runCommunicationsFirstSearch] Error fetching partnership data:', error);
      add({ type: 'warning', text: `⚠️ HubSpot lookup failed - using extracted details` });
    }
  } else if (!projectName) {
    add({ type: 'warning', text: '⚠️ No project name detected - using message content directly' });
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
      vibe: hasContent(partnershipData?.vibe) ? partnershipData.vibe : (extractedData.genre || extractedData.vibe),
      synopsis: hasContent(partnershipData?.synopsis) ? partnershipData.synopsis : extractedData.synopsis,
  };
   if (!finalPartnershipData.vibe) finalPartnershipData.vibe = partnershipData?.genre_production;
   
  // Extract genre from synopsis if we have one
  if (finalPartnershipData.synopsis && !finalPartnershipData.vibe) {
    try {
      add({ type: 'process', text: '🎭 Detecting genre from synopsis...' });
      const detectedGenre = await extractGenreFromSynopsis(finalPartnershipData.synopsis);
      if (detectedGenre) {
        finalPartnershipData.vibe = detectedGenre;
        add({ type: 'info', text: `🎬 Detected genre: ${detectedGenre}` });
      }
    } catch (e) {
      console.log('[runBrandSearchOrchestrator] Genre extraction failed:', e.message);
    }
  }
   
  // Try to detect production from conversation/context
  let detectedProduction = null;
  try {
    // First try from user message
    detectedProduction = extractLastProduction(userMessage);
    
    // If not found, try from conversation context
    if (!detectedProduction && conversationContext) {
      detectedProduction = extractLastProduction(conversationContext);
    }
  } catch (e) {
    add({ type: 'warning', text: `⚠️ Production detection error: ${e.message}` });
  }
  
  // Surface detected production to MCP
  if (detectedProduction) {
    add({ type: 'info', text: `🎬 Production detected: ${detectedProduction.substring(0, 100)}${detectedProduction.length > 100 ? '...' : ''}` });
    // Store in partnership data for later use
    if (!finalPartnershipData.synopsis && detectedProduction) {
      finalPartnershipData.synopsis = detectedProduction;
    }
  } else if (projectName) {
    add({ type: 'info', text: `🎬 Project: "${projectName}"` });
  } else {
    add({ type: 'info', text: '🎬 No production explicitly detected.' });
  }
  
  // Show project context in MCP
  const dataSource = partnershipData ? 'HubSpot' : 'Extracted';
  add({
    type: 'info',
    text: `📊 Data source: ${dataSource} | Genre: ${finalPartnershipData?.vibe || 'unknown'} | Synopsis: ${(finalPartnershipData?.synopsis || '').substring(0, 80)}${(finalPartnershipData?.synopsis || '').length > 80 ? '...' : ''}`
  });
  
  // Extract and show keywords - use existing variable instead of redeclaring
  if (extractKeywordsForContextSearch) {
    try {
      extractedKeywords = await extractKeywordsForContextSearch(finalPartnershipData);
      if (Array.isArray(extractedKeywords) && extractedKeywords.length) {
        add({ type: 'info', text: `🔑 Keywords: ${extractedKeywords.slice(0, 12).join(', ')}` });
      }
    } catch (e) {
      console.log('[runBrandSearchOrchestrator] Keyword extraction failed:', e.message);
    }
  }


  // ... The rest of the function continues from here ...
  // (Search communications, fetch brand buckets, apply signal booster, etc.)

  // Step 4: Try AI ranking first with cache
  let finalPickerList = [];
  let usedAI = false;
  
  console.log('[runBrandSearchOrchestrator] Starting AI ranking with partnership data:', {
    hasTitle: !!finalPartnershipData.title,
    hasSynopsis: !!finalPartnershipData.synopsis,
    synopsisLength: finalPartnershipData.synopsis?.length,
    hasVibe: !!finalPartnershipData.vibe,
    hasCast: !!finalPartnershipData.cast
  });
  
  try {
    add({ type: 'process', text: '🤠 Selecting brands by creative fit...' });
    const ranked = await getCreativeFitBrands(finalPartnershipData, { add });
    if (ranked?.length) {
      finalPickerList = ranked;
      usedAI = true;
      // Use the consistent field name: brand_name
      const brandNames = ranked.slice(0,5).map(b => b.brand_name || b.properties?.brand_name || 'Unknown').filter(n => n !== 'Unknown');
      add({ type: 'result', text: `✅ AI picked ${ranked.length} brands. Top: ${brandNames.join(' • ')}` });
    } else {
      console.error('[runBrandSearchOrchestrator] AI ranking returned empty array');
      add({ type: 'warning', text: '⚠️ AI returned no results.' });
      // Return empty result if AI fails
      return {
        mcpThinking,
        organizedData: {
          dataType: 'BRAND_RECOMMENDATIONS',
          detailedBrands: [],
          brandSuggestions: [],
          projectName,
          partnershipData: finalPartnershipData,
          communications: { meetings: [], emails: [] },
          error: 'AI ranking failed - please try again'
        },
      };
    }
  } catch (e) {
    add({ type: 'warning', text: `⚠️ AI ranking error: ${e.message}.` });
    // Return empty result if AI fails
    return {
      mcpThinking,
      organizedData: {
        dataType: 'BRAND_RECOMMENDATIONS',
        detailedBrands: [],
        brandSuggestions: [],
        projectName,
        partnershipData: finalPartnershipData,
        communications: { meetings: [], emails: [] },
        error: `AI ranking error: ${e.message}`
      },
    };
  }
  
  // Step 5: Search communications for brand mentions
  add({ type: 'process', text: '📧 Searching communications for brand clues...' });
  commsResults = await searchCommunicationsForClues(finalPartnershipData, { add, extractedKeywords });
  
  // Apply communications signal boosting to AI-ranked brands
  const commsText = [
    ...commsResults.meetings.map(m => `${m.title || ''} ${m.summary?.overview || ''} ${m.summary?.keywords?.join(' ') || ''}`),
    ...commsResults.emails.map(e => `${e.subject || ''} ${e.preview || ''}`)
  ].join(' ').toLowerCase();
  
  // Don't boost scores - just note if there were communications
  const boostedBrands = finalPickerList.map(brand => {
    const brandName = (brand.brand_name || brand.properties?.brand_name || '').toLowerCase();
    
    // Just tag brands that had communications, don't change their score
    if (brandName && brandName.length > 2 && commsText.includes(brandName)) {
      brand.tags = [...(brand.tags || []), '💬 Recent Comms Mention'];
    }
    
    // Keep the AI's original reason if it exists, only use fallback if absolutely necessary
    if (!brand.reason || brand.reason === '') {
      brand.reason = generateReason(brand, finalPartnershipData);
    }
    
    return brand;
  });
  
  // Sort by the AI's original relevance score (based on creative fit)
  let allRankedBrands = boostedBrands.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  
  // Take top 50 brands
  allRankedBrands = allRankedBrands.slice(0, 50);
  
  // Add source information to brands
  allRankedBrands = allRankedBrands.map(brand => ({
    ...brand,
    source: brand.source || (usedAI ? '🤖 AI Ranking' : '🎯 Curated Buckets')
  }));
  
  // --- CREATIVE-FIRST SELECTION WITH DEEP DIVE ---
  // Select the top 2 brands and run LITE deep dive analysis
  add({ type: 'process', text: '🎨 Selecting top 2 brands by pure creative fit...' });

  const brandsForPitching = [];
  
  // Simply take the top 2 highest-scoring brands from the AI ranking
  if (allRankedBrands.length > 0) {
    brandsForPitching.push(allRankedBrands[0]);
    const brandName1 = allRankedBrands[0].brand_name || allRankedBrands[0].properties?.brand_name || 'Unknown';
    add({ type: 'info', text: `🥇 #1 Creative Fit: ${brandName1} (score: ${Math.round(allRankedBrands[0].relevanceScore || 0)})` });
  }
  
  if (allRankedBrands.length > 1) {
    brandsForPitching.push(allRankedBrands[1]);
    const brandName2 = allRankedBrands[1].brand_name || allRankedBrands[1].properties?.brand_name || 'Unknown';
    add({ type: 'info', text: `🥈 #2 Creative Fit: ${brandName2} (score: ${Math.round(allRankedBrands[1].relevanceScore || 0)})` });
  }
  
  // Fallback if somehow we have less than 2 brands
  if (brandsForPitching.length < 2 && allRankedBrands.length > brandsForPitching.length) {
    for (let i = brandsForPitching.length; i < Math.min(2, allRankedBrands.length); i++) {
      brandsForPitching.push(allRankedBrands[i]);
    }
  }
  
  // Run LITE deep dive for AI-selected brands
  add({ type: 'process', text: '⚡ Running LITE analysis (30-day comms, no web search)' });
  const { deepDiveMultipleBrands } = await import('./deepDive.js');
  const deepDiveResults = await deepDiveMultipleBrands(
    brandsForPitching, 
    finalPartnershipData, 
    { isLite: true, add, communications: commsResults } // Pass comms to avoid re-searching
  );
  
  // Enhance brands with deep dive insights
  const enhancedBrands = brandsForPitching.map((brand, idx) => {
    const insights = deepDiveResults[idx];
    if (!insights) return brand;
    
    return {
      ...brand,
      deepInsights: insights,
      // Use the AI's strategic fit as the primary reason
      reason: insights.strategicFit || brand.reason,
      // Add integration ideas directly to brand
      integrationIdeas: insights.integrationIdeas,
      whyItWorks: insights.whyItWorks,
      hbInsight: insights.insight
    };
  });
  // --- END OF CREATIVE-FIRST SELECTION WITH DEEP DIVE ---
  
  const creativeResult = await generateCreativeContent(enhancedBrands.slice(0, 2), { add, actualProjectName: projectName, search_term: userMessage, partnershipData: finalPartnershipData, communications: commsResults });
  
  return prepareFrontendPayload({ enrichedBrands: creativeResult.enrichedBrands, allRankedBrands, mcpThinking, projectName, partnershipData: finalPartnershipData, communications: commsResults, finalReplyText: creativeResult.finalReplyText });
}

/**
 * Search communications with intelligent, targeted terms
 */
async function searchCommunicationsForClues(partnershipData, { add, extractedKeywords = [] }) {
  // Pass known values directly to avoid redundant extraction
  const projectName = partnershipData.title;
  const leadActor = Array.isArray(partnershipData.cast) ? partnershipData.cast[0] : null;
  
  // Combine extracted keywords with intelligent search terms
  let primarySearchTerms = [];
  
  // Use extracted keywords if available (more efficient)
  if (extractedKeywords && extractedKeywords.length > 0) {
    primarySearchTerms = extractedKeywords.slice(0, 5);
    add({ type: 'info', text: `🎯 Using extracted keywords: ${primarySearchTerms.join(', ')}` });
  } else {
    // Fallback to generating terms if no keywords
    primarySearchTerms = await generateIntelligentSearchTerms({
      projectName,
      leadActor,
      synopsis: partnershipData.synopsis
    }, { add });
  }
  
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
  
  // No fallback - if no results, that's fine
  
  const meetings = Array.from(allMeetings.values());
  const emails = Array.from(allEmails.values());
  
  add({ type: 'result', text: `📊 Found ${meetings.length} meetings & ${emails.length} emails from intelligent search for signal boosting` });
  return { meetings, emails };
}

/**
 * Takes the top-ranked brands and calls an AI to generate creative content.
 * It reliably merges the AI content back while preserving the original brand ID.
 */
async function generateCreativeContent(topBrands, { add, actualProjectName, search_term, partnershipData, communications }) {
  if (!topBrands || topBrands.length === 0) return { enrichedBrands: [], finalReplyText: '' };
  add({ type: 'process', text: '✍️ Formatting creative pitches...' });

  // NEW RELIABLE LOGIC: Directly map the deep dive results without another AI call.
  const enrichedBrandsWithContent = topBrands.map((originalBrand) => {
    const brandName = originalBrand.brand_name || originalBrand.properties?.brand_name || originalBrand.name || 'Unknown Brand';
    const insights = originalBrand.deepInsights || {};

    // UPDATED LOGIC: Join the array of ideas into a single string for display.
    const integrationIdeas = Array.isArray(insights.integrationIdeas) && insights.integrationIdeas.length > 0
        ? insights.integrationIdeas.join(' ') 
        : 'No specific ideas generated.';
    
    const whyItWorks = insights.strategicFit || 'Aligns with production themes.';
    const hbInsights = insights.insight || 'Strong partnership potential based on analysis.';

    // Construct the final content array for frontend display.
    const finalContent = [
        `Brand: ${brandName}`,
        `Integration: ${integrationIdeas}`,
        `Why it works: ${whyItWorks}`,
        `HB Insights: ${hbInsights}`
    ];

    return {
      ...originalBrand,
      content: finalContent,
      // Populate the deepInsights structure for the frontend BrandCard.
      deepInsights: {
        // Pass the original array to the BrandCard
        integrationIdeas: Array.isArray(insights.integrationIdeas) ? insights.integrationIdeas : [],
        whyItWorks: whyItWorks,
        insight: hbInsights,
        strategicFit: whyItWorks // Add for consistency
      },
      name: brandName,
      brand_name: brandName,
      secondary_owner: originalBrand.secondary_owner || originalBrand.secondaryOwnerId || null,
      specialty_lead: originalBrand.specialty_lead || originalBrand.specialtyLeadId || null,
      secondaryOwnerId: originalBrand.secondary_owner || originalBrand.secondaryOwnerId || null,
      specialtyLeadId: originalBrand.specialty_lead || originalBrand.specialtyLeadId || null
    };
  });
  
  add({ type: 'checkpoint', text: `✍️ Pitches formatted for top ${topBrands.length} brands.` });

  // Since there's no single AI reply, we can return an empty string or a summary.
  const finalReplyText = `Generated creative ideas for ${topBrands.map(b => b.brand_name || b.name).join(' and ')}.`;

  return {
    enrichedBrands: enrichedBrandsWithContent,
    finalReplyText: finalReplyText 
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
      const cleanName = (brand.brand_name || brand.properties?.brand_name || 'brand')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      id = `${cleanName}-${index}`;
    }
    // Ensure we preserve the HubSpot user IDs and isInSystem flag
    return { 
      ...brand, 
      id: String(id),
      // Add a 'name' field for frontend compatibility if it expects it
      name: brand.brand_name || brand.properties?.brand_name || brand.name || 'Unknown',
      // Keep brand_name as well for consistency
      brand_name: brand.brand_name || brand.properties?.brand_name || 'Unknown',
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
  sessionId,  // Changed from projectId to sessionId
  conversationContext,
  lastProductionContext,
  knownProjectName,
  runId,
  onStep = () => {},
  knownPartnershipData = null  // New parameter for partnership data from frontend
) {
  console.log('[handleClaudeSearch] Entry with knownProjectName:', knownProjectName);
  console.log('[handleClaudeSearch] userMessage:', userMessage);
  console.log('[handleClaudeSearch] sessionId:', sessionId);  // Log sessionId
  console.log('[handleClaudeSearch] runId:', runId);  // Log runId
  
  // Add try-catch around entire function
  try {
  
  // Ensure HubSpot is ready (cold start)
  if (hubspotAPI?.initialize) {
    console.log('[handleClaudeSearch] Initializing HubSpot API...');
    await hubspotAPI.initialize().catch((err) => {
      console.error('[handleClaudeSearch] HubSpot initialization failed:', err);
    });
  }

  const mcpThinking = [];
  const add = (step) => {
    console.log('[handleClaudeSearch] add() called with step:', step);
    mcpThinking.push(step);
    try {
      // Call the onStep callback which should push to KV
      if (onStep) {
        console.log('[handleClaudeSearch] Calling onStep with sessionId:', sessionId, 'runId:', runId);
        // Fire and forget - don't await to avoid blocking
        Promise.resolve(onStep(step)).catch(err => {
          console.error('[handleClaudeSearch] onStep error:', err);
        });
      } else {
        console.log('[handleClaudeSearch] WARNING: onStep is not defined!');
      }
    } catch (err) {
      console.error('[handleClaudeSearch] onStep sync error:', err);
    }
  };

  const intent = await routeUserIntent(userMessage, conversationContext, lastProductionContext);
  if (!intent) return null;
  
  // Add routing decision to MCP reasoning
  add({ 
    type: 'route', 
    text: `🧭 Route: ${intent.tool}${intent.tool === 'create_pitches_for_brands' ? ' (FULL deep dive)' : intent.tool === 'find_brands' ? ' (LITE deep dive)' : ''}` 
  });

  switch (intent.tool) {
    case 'find_brands': {
      add({ type: 'info', text: '🎯 Starting brand discovery with AI matching + LITE analysis' });
      return await runBrandSearchOrchestrator(intent, {
        add,
        knownProjectName,
        userMessage,
        mcpThinking, // Already present, confirming it's passed through
        conversationContext,
        lastProductionContext, // Pass the full context for proper AI structuring
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
      add({ type: 'info', text: '🔬 Starting FULL deep dive analysis for specific brands' });
      
      // --- START: NEW AUTHORITATIVE LOGIC ---
      const brandsToAnalyze = intent.args.brand_names || [];
      const projectName = knownProjectName; // <-- USE THIS. IT IS THE SOURCE OF TRUTH.
      
      // 1. Log what we are using to be certain.
      console.log(`[handleClaudeSearch] Using project: ${projectName}`);
      console.log(`[handleClaudeSearch] Analyzing brands: ${brandsToAnalyze.join(', ')}`);
      
      // 2. Pass the correct, stable project name to the deep dive process.
      // The 'partnershipData' object MUST be fetched using the reliable 'projectName'.
      let partnershipData = null;
      if (projectName && hubspotAPI?.getPartnershipForProject) {
        try {
          // Use the state-passing optimization if available
          if (knownPartnershipData && knownPartnershipData.title === projectName) {
            partnershipData = normalizePartnership(knownPartnershipData);
            add({ type: 'info', text: `✅ Using project context for "${projectName}" from client.` });
          } else {
            partnershipData = await hubspotAPI.getPartnershipForProject(projectName);
            if (partnershipData) {
              partnershipData = normalizePartnership(partnershipData);
              add({ type: 'result', text: `✅ Found project data for "${projectName}".` });
            }
          }
        } catch (error) {
          console.error('[handleClaudeSearch] Error fetching partnership data:', error);
        }
      }
      
      if (!partnershipData) {
        // If we can't get data for our known project, we must stop or use minimal fallback.
        partnershipData = { title: projectName, partnership_name: projectName, synopsis: lastProductionContext };
        add({ type: 'warning', text: `⚠️ Could not find HubSpot data for "${projectName}". Proceeding with limited context.` });
      }
      // --- END: NEW AUTHORITATIVE LOGIC ---
      
      // Now continue processing the brands themselves
      let brands = brandsToAnalyze;
      
      // The partnership data fetching is already handled above in the NEW AUTHORITATIVE LOGIC
      // No need to duplicate the logic here
      
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
              add({ type: 'result', text: `✅ Found in HubSpot: ${brandName} (${brand.properties.main_category || 'Unknown category'})` });
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
              add({ type: 'result', text: `✅ Found in HubSpot: ${brandName} (${brand.properties.main_category || 'Unknown'}) - ${brand.properties.client_status || 'No status'}` });
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
      const updatedUserMessage = `Generate brand integration ideas for: ${brandNamesForMessage.join(', ')}${projectName ? ` for ${projectName}` : ''}`;
      add({ type: 'start', text: `🧠 ${updatedUserMessage}` });
    
      // Partnership data has already been fetched earlier in the function
    
      // Run FULL deep dive for user-selected brands
      add({ type: 'process', text: '🔬 Running FULL analysis (90-day comms, web search, market context)' });
      const { deepDiveMultipleBrands } = await import('./deepDive.js');
      const deepDiveResults = await deepDiveMultipleBrands(
        processedBrands.slice(0, 5),
        partnershipData,  // We now guarantee partnershipData exists
        { isLite: false, add } // FULL mode for user-selected
      );
      
      // Enhance brands with deep insights
      const enhancedBrands = processedBrands.slice(0, 5).map((brand, idx) => {
        const insights = deepDiveResults[idx];
        return {
          ...brand,
          deepInsights: insights,
          reason: insights?.strategicFit || brand.reason
        };
      });
      
      // Generate creative content with deep insights
      const creativeResult = await generateCreativeContent(enhancedBrands, {
        add,
        actualProjectName: projectName || 'your project',
        search_term: updatedUserMessage,
        partnershipData: partnershipData,  // We now guarantee this exists
        isUserSelected: true
      });
    
      return {
        mcpThinking,
        finalReplyText: creativeResult.finalReplyText || `Generated integration ideas for ${brandNamesForMessage.join(', ')}${projectName ? ` for ${projectName}` : ''}`,
        organizedData: {
          dataType: 'BRAND_RECOMMENDATIONS',
          detailedBrands: creativeResult.enrichedBrands || processedBrands,
          brandSuggestions: [],
          projectName: projectName || knownProjectName,
          partnershipData: partnershipData,  // We now guarantee this exists
          context: lastProductionContext || conversationContext || '',
        },
      };
    }

    case 'answer_general_question':
    default:
      return null;
  }
  } catch (error) {
    // Log the actual error that's causing the 500
    console.error('[handleClaudeSearch] CRITICAL ERROR:', error);
    console.error('[handleClaudeSearch] Error stack:', error.stack);
    console.error('[handleClaudeSearch] Error details:', {
      message: error.message,
      name: error.name,
      code: error.code
    });
    
    // Re-throw with more context
    throw new Error(`handleClaudeSearch failed: ${error.message}`);
  }
}

/* =========================
 * COLLECTED EXPORTS
 * ======================= */
export const core = {
  runBrandSearchOrchestrator,
  handleClaudeSearch,
  getCreativeFitBrands,
  generateIntelligentSearchTerms,
  searchCommunicationsForClues,
};

export default core;
