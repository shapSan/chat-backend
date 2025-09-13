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

  // Clear, context-aware prompt with better reasoning instructions
  const prompt = `You are a brand integration expert. Analyze this ${projectContext.genre} project and select 30 brands that naturally fit.

PROJECT: "${projectContext.title}"
• Genre/Tone: ${projectContext.genre} (${projectContext.rating})
• Cast: ${projectContext.cast}
• Setting: ${projectContext.location}
• Story: ${projectContext.synopsis}

BRANDS TO EVALUATE:
${brandList}

SELECT 30 BRANDS based on:
1. How their product category naturally fits the story/scenes
2. Target audience alignment with the ${projectContext.rating} ${projectContext.genre} demographic
3. Thematic resonance (e.g., luxury brands for upscale settings, tech for sci-fi)
4. Location/setting opportunities (${projectContext.location})
5. Character integration potential

FOR EACH BRAND, write a SPECIFIC, UNIQUE reason (max 15 words) that shows:
- WHY this exact brand fits THIS exact project
- HOW it could appear naturally in scenes
- WHAT makes it better than similar brands

AVOID generic phrases like:
- "aligns with [genre] themes" 
- "fits the project"
- "natural placement"

INSTEAD write specific reasons like:
- "Bio Bidet: Bathroom humor perfect for Scary Movie's parody style"
- "Pilot Pen: Writers' room scenes showcase creative process"
- "Govee: Smart home tech for modern horror jump scares"

Return JSON:
{
  "selections": [
    {"name": "Brand Name", "reason": "Specific integration reason"}
  ]
}`;

  try {
    add({ type: 'process', text: '🤖 AI analyzing project context and selecting best-fit brands...' });
    
    const response = await withTimeout(
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
        body: JSON.stringify({
          model: MODELS.openai.chatMini,
          messages: [
            { 
              role: 'system', 
              content: 'You are a Hollywood brand integration specialist who deeply understands product placement. For each brand, think about SPECIFIC SCENES where it could appear, which CHARACTERS would use it, and WHY that brand specifically (not just its category) enhances the story. Never use generic reasons - always be specific about THIS brand in THIS project.'
            },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.7,
          max_tokens: 2500
        })
      }),
      25000,  // Increased from 15s to 25s
      null
    );

    if (!response || !response.ok) {
      throw new Error(`AI failed: ${response ? await response.text() : 'Timeout'}`);
    }

    const data = await response.json();
    const aiResponse = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    const selections = aiResponse.selections || [];

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
      const usedNames = new Set(finalBrands.map(b => b.name.toLowerCase()));
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
  { add, knownProjectName, userMessage, mcpThinking, conversationContext }
) {
  // Step 1: Have AI structure the entire input once, properly
  let structuredInput = null;
  if (userMessage && openAIApiKey) {
    try {
      const structurePrompt = `Parse this film/TV project description into structured data.

IMPORTANT: Extract the actual title, not descriptions. "Scary Movie A reboot" means title is "Scary Movie".

Input: "${userMessage}"

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
  
  // If no results, get recent transcripts as fallback with proper timeframe
  if (allMeetings.size === 0 && firefliesApiKey) {
    add({ type: 'info', text: '🔍 No specific matches. Getting recent meeting transcripts as fallback...' });
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
        if (recentResult.transcripts.length > 0) {
          add({ type: 'result', text: `✅ Retrieved ${recentResult.transcripts.length} recent meetings for context` });
        }
      }
    } catch (error) {
      console.log('[searchCommunicationsForClues] Fallback search failed:', error.message);
      add({ type: 'warning', text: '⚠️ Could not retrieve recent meetings' });
    }
  }
  
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
  add({ type: 'process', text: '✍️ Finding evidence & generating creative...' });

  // --- NEW: Find specific evidence for each brand ---
  const brandsWithEvidence = topBrands.map(brand => {
    let evidence = null;
    const brandNameLower = (brand.brand_name || brand.properties?.brand_name || '').toLowerCase();

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

  // Check if we have deep insights to use
  const hasDeepInsights = brandsWithContext.some(b => b.deepInsights);
  
  // Build prompt based on whether we have deep insights
  let creativePrompt;
  
  if (hasDeepInsights) {
    // Format deep insights into presentation-ready content
    creativePrompt = `Format these brand integration insights for "${actualProjectName}" into a polished pitch:

${brandsWithContext.map((brand, idx) => `
BRAND ${idx + 1}: ${brand.name}
Strategic Fit: ${brand.deepInsights?.strategicFit || brand.reason}
Integration Ideas:
${(brand.deepInsights?.integrationIdeas || brand.integrationIdeas || []).map((idea, i) => `${i+1}. ${idea}`).join('\n')}
Why It Works: ${brand.deepInsights?.whyItWorks || brand.whyItWorks || 'Creates cohesive brand narrative'}
HB Insight: ${brand.deepInsights?.insight || brand.hbInsight || 'Based on analysis'}
${brand.deepInsights?.campaignTimeline ? `Timeline: ${brand.deepInsights.campaignTimeline}` : ''}
${brand.deepInsights?.budgetEstimate ? `Budget: ${brand.deepInsights.budgetEstimate}` : ''}`).join('\n\n')}

Format each brand as:
Brand: [Name]
Integration: [Best integration idea expanded to 30 words]
Why it works: [Strategic fit expanded to 40 words]
HB Insights: [Most compelling data point or market activity]`;
  } else {
    // Original prompt for when we don't have deep insights
    creativePrompt = `You are Hollywood Branded's brand integration strategist. Your goal is to suggest natural, budget-realistic partnerships for the project "${actualProjectName}". Your ideas must feel organic to the story and excite both the production and the brand.

<PROJECT_DETAILS>
Synopsis: ${partnershipData?.synopsis || 'Not provided'}
Genre/Vibe: ${partnershipData?.vibe || partnershipData?.genre_production || 'Not specified'}
Cast: ${Array.isArray(partnershipData?.cast) ? partnershipData.cast.join(', ') : partnershipData?.cast || 'Not specified'}
</PROJECT_DETAILS>`;
  } // Close the else block for the prompt

  // Continue with the rest of the original prompt only if not using deep insights
  if (!hasDeepInsights) {
    creativePrompt += `

You will generate ideas for these two brands:
${brandsWithContext.map((brand, idx) => {
  const brandName = brand.brand_name || brand.properties?.brand_name || 'Unknown Brand';
  const category = brand.main_category || brand.properties?.main_category || 'General';
  const subcategories = brand.product_sub_category__multi_ || brand.properties?.product_sub_category__multi_ || 'N/A';
  return `
<BRAND_${idx + 1}>
Name: ${brandName}
Category: ${category}
Subcategories: ${Array.isArray(subcategories) ? subcategories.join(', ') : subcategories || 'N/A'}
EVIDENCE_PROVIDED: ${brand.evidence || "No specific meeting or email mentions were found for this brand."}
</BRAND_${idx + 1}>`;
}).join('\n')}

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
  } // End of !hasDeepInsights block

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

  // If no AI response or empty response, generate a robust fallback
  if (!finalFormattedText || finalFormattedText.trim() === '') {
    console.log('[generateCreativeContent] AI response empty, using detailed fallback');
    finalFormattedText = topBrands.map((brand, idx) => {
      const brandName = brand.brand_name || brand.properties?.brand_name || brand.name || 'Unknown Brand';
      const category = brand.main_category || brand.category || 'Product';
      const reason = brand.reason || brand.relevanceReason || `${category} opportunities for authentic integration`;
      const insight = brand.evidence || brand.hbInsight || brand.insight || 'Strong partnership potential based on category alignment';
      
      // Build more specific integration based on available data
      let integration = `Strategic ${brandName} placement integrated naturally into key production moments`;
      if (brand.deepInsights?.integrationIdeas?.[0]) {
        integration = brand.deepInsights.integrationIdeas[0];
      } else if (brand.integrationIdeas?.[0]) {
        integration = brand.integrationIdeas[0];
      } else if (partnershipData?.synopsis) {
        integration = `${brandName} products featured in scenes that align with ${partnershipData.vibe || 'the story'}`;
      }
      
      // Build why it works
      let whyItWorks = `Strong alignment between ${brandName} and production themes`;
      if (brand.deepInsights?.whyItWorks) {
        whyItWorks = brand.deepInsights.whyItWorks;
      } else if (brand.whyItWorks) {
        whyItWorks = brand.whyItWorks;
      } else if (reason) {
        whyItWorks = reason;
      }
      
      return `Brand: ${brandName}\nIntegration Idea: ${integration}\nWhy it works: ${whyItWorks}\nHB Insights: ${insight}`;
    }).join('\n\n');
    
    console.log('[generateCreativeContent] Generated fallback content for', topBrands.length, 'brands');
  }

  // Split the AI response into chunks, one for each brand.
  // The split pattern looks for "Brand:" at the beginning of a line.
  const brandSections = finalFormattedText.split(/\n(?=Brand:)/).map(s => s.trim()).filter(s => s.length > 0);
  
  console.log('[generateCreativeContent] Split into', brandSections.length, 'brand sections');

  const enrichedBrandsWithContent = topBrands.map((originalBrand, index) => {
    // Get the actual brand name from the brand object
    const actualBrandName = originalBrand.brand_name || originalBrand.properties?.brand_name || originalBrand.name || '';
    
    // Helper to clean the name for matching by removing asterisks and text in parentheses.
    const cleanBrandNameForMatch = actualBrandName
      .toLowerCase()
      .replace(/\* /g, '')
      .replace(/\s*\(.*\)/, '')
      .trim();

    // Try to find matching section by name
    let brandSectionText = brandSections.find(section =>
      section.toLowerCase().startsWith(`brand: ${cleanBrandNameForMatch}`)
    );
    
    // If not found by name, try to use index-based matching
    if (!brandSectionText && brandSections[index]) {
      console.log(`[generateCreativeContent] Using index-based match for brand ${actualBrandName} at index ${index}`);
      brandSectionText = brandSections[index];
    }
    
    // Parse the section text if found
    let parsedContent = [];
    if (brandSectionText) {
      parsedContent = brandSectionText.split('\n').filter(line => line.trim());
      
      // Validate that we have all required sections
      const hasIntegration = parsedContent.some(line => line.toLowerCase().includes('integration'));
      const hasWhyItWorks = parsedContent.some(line => line.toLowerCase().includes('why it works'));
      const hasInsights = parsedContent.some(line => line.toLowerCase().includes('insights'));
      
      if (!hasIntegration || !hasWhyItWorks || !hasInsights) {
        console.warn(`[generateCreativeContent] Incomplete content for ${actualBrandName}, regenerating...`);
        // Generate complete fallback content for this brand
        const brandName = actualBrandName || 'Unknown Brand';
        const integration = originalBrand.deepInsights?.integrationIdeas?.[0] || 
                          originalBrand.integrationIdeas?.[0] || 
                          `Strategic ${brandName} placement in key scenes`;
        const whyItWorks = originalBrand.deepInsights?.whyItWorks || 
                          originalBrand.whyItWorks || 
                          originalBrand.reason || 
                          'Natural brand fit with production themes';
        const insights = originalBrand.deepInsights?.insight || 
                        originalBrand.hbInsight || 
                        originalBrand.evidence || 
                        'Strong partnership potential';
        
        parsedContent = [
          `Brand: ${brandName}`,
          `Integration Idea: ${integration}`,
          `Why it works: ${whyItWorks}`,
          `HB Insights: ${insights}`
        ];
      }
    } else {
      // No matching section found - generate fallback
      console.warn(`[generateCreativeContent] No content found for ${actualBrandName}, using fallback`);
      const brandName = actualBrandName || 'Unknown Brand';
      parsedContent = [
        `Brand: ${brandName}`,
        `Integration Idea: Strategic ${brandName} placement in key production moments`,
        `Why it works: ${originalBrand.reason || 'Natural alignment with production values'}`,
        `HB Insights: ${originalBrand.evidence || 'Strong partnership potential based on analysis'}`
      ];
    }

    return {
      ...originalBrand,
      // Use the validated/regenerated content
      content: parsedContent,
      // Ensure we have a valid name field
      name: actualBrandName,
      brand_name: actualBrandName,
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
  onStep = () => {}
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
      console.log('[handleClaudeSearch] Creating pitches for brands:', intent.args);
      let brands = intent.args.brand_names || [];
      let projectContext = intent.args.production || knownProjectName;
      
      // Extract brand names from the message if not in args
      if (brands.length === 0) {
        // Pattern 1: "Nike and Adidas for Fast 11"
        const forPattern = userMessage.match(/([\w\s,&]+?)\s+for\s+([\w\s]+?)$/i);
        if (forPattern) {
          brands = forPattern[1].split(/,|and|&/).map(b => b.trim()).filter(Boolean);
          projectContext = forPattern[2].trim();
        }
        // Pattern 2: "Generate brand integration ideas for: X, Y, Z"
        else if (userMessage.includes('Generate brand integration ideas for:')) {
          const match = userMessage.match(/Generate brand integration ideas for:\s*(.+?)(?:\s+for|$)/i);
          if (match) {
            brands = match[1].split(/,\s*/).map(b => b.trim());
          }
        }
      }
      
      console.log('[handleClaudeSearch] Extracted brands:', brands);
      console.log('[handleClaudeSearch] Project context:', projectContext);
      
      // Fallback: try to get project from last production context if still missing
      if (!projectContext && lastProductionContext) {
        const projectMatch = lastProductionContext.match(/(?:title|project|production):\s*([^,\n]+)/i);
        if (projectMatch) {
          projectContext = projectMatch[1].trim();
        }
      }
      
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
    
      // Run FULL deep dive for user-selected brands
      add({ type: 'process', text: '🔬 Running FULL analysis (90-day comms, web search, market context)' });
      const { deepDiveMultipleBrands } = await import('./deepDive.js');
      const deepDiveResults = await deepDiveMultipleBrands(
        processedBrands.slice(0, 5),
        partnershipData || {
          title: projectContext,
          synopsis: lastProductionContext,
          partnership_name: projectContext,
          genre_production: 'Not specified'
        },
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
        actualProjectName: projectContext || 'your project',
        search_term: updatedUserMessage,
        partnershipData: partnershipData || {
          title: projectContext,
          synopsis: lastProductionContext
        },
        isUserSelected: true
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
