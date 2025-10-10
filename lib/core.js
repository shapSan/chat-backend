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
  
  // Default fallback with some context
  if (category && partnershipGenres)
    return `${category.charAt(0).toUpperCase() + category.slice(1)} brand aligned with ${partnershipGenres} themes.`;
    
  return 'Strong potential match based on project creative needs.';
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
    if (cachedMatches && Array.isArray(cachedMatches) && cachedMatches.length > 0) {
      add({ type: 'info', text: `📦 Using cached brand matches for "${projectName}" (${cachedMatches.length} brands)` });
      return cachedMatches;
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

  // Clear, context-aware prompt
  const prompt = `Analyze this project and select the 30 brands with the most NATURAL FIT.

PROJECT CONTEXT:
• Title: "${projectContext.title}"
• Genre: ${projectContext.genre}
• Rating: ${projectContext.rating}
• Cast: ${projectContext.cast}
• Location: ${projectContext.location}
• Synopsis: ${projectContext.synopsis}

UNDERSTAND the story, tone, and audience. Then select 30 brands that would integrate naturally.

BRANDS AVAILABLE:
${brandList}

For each brand selected, provide a SHORT reason (under 15 words) explaining the natural fit.
Focus on WHY this specific brand works for THIS specific project.

Return JSON format:
{
  "selections": [
    {"name": "Brand Name", "reason": "Natural fit explanation based on project context"}
  ]
}

Select exactly 30 brands. Make reasons specific and unique.`;

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
              content: 'You are a brand integration expert. Read the project details carefully, understand the story/tone/audience, then select brands that would naturally fit. Each reason should be concise and specific to why THAT brand fits THIS project.'
            },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.6,
          max_tokens: 2500
        })
      }),
      15000,
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
    
    // Fallback: return first 30 brands with basic reasons
    return brandsToAnalyze.slice(0, 30).map(b => ({
      ...b,
      brand_name: b.properties?.brand_name || 'Unknown',
      main_category: b.properties?.main_category || 'General',
      relevanceScore: 50,
      reason: `${b.properties?.main_category || 'Brand'} for ${projectContext.genre} project`,
      relevanceReason: `Selected for ${projectContext.title}`
    }));
  }
}
export async function runBrandSearchOrchestrator(
  intent,
  { add, knownProjectName, userMessage, mcpThinking, conversationContext, knownPartnershipData, lastProductionContext }
) {
  // Step 0: Extract user-suggested brands and category filters
  let userSuggestedBrands = [];
  let requestedCategory = null;
  
  // Check for category requests (e.g., "tech company", "food brand", etc.)
  const categoryPatterns = [
    { pattern: /\b(tech|technology)\s*(company|brand|companies|brands)/i, category: 'Technology' },
    { pattern: /\b(food|beverage|f&b)\s*(company|brand|companies|brands)/i, category: 'Food & Beverage' },
    { pattern: /\b(fashion|apparel|clothing)\s*(company|brand|companies|brands)/i, category: 'Fashion & Apparel' },
    { pattern: /\b(auto|automotive|car)\s*(company|brand|companies|brands)/i, category: 'Automotive' },
    { pattern: /\b(gaming|game)\s*(company|brand|companies|brands)/i, category: 'Gaming' },
    { pattern: /\b(sports|athletic)\s*(company|brand|companies|brands)/i, category: 'Sports & Recreation' },
    { pattern: /\b(entertainment|media)\s*(company|brand|companies|brands)/i, category: 'Entertainment' },
    { pattern: /\b(beauty|cosmetic)\s*(company|brand|companies|brands)/i, category: 'Cosmetics & Personal Care' },
    { pattern: /\b(finance|financial|bank)\s*(company|brand|companies|brands)/i, category: 'Financial Services' },
    { pattern: /\b(health|wellness|medical)\s*(company|brand|companies|brands)/i, category: 'Health & Wellness' }
  ];
  
  for (const { pattern, category } of categoryPatterns) {
    if (pattern.test(userMessage)) {
      requestedCategory = category;
      console.log('[runBrandSearchOrchestrator] User requested category:', category);
      add({ type: 'info', text: `🏷️ Looking for ${category} brands...` });
      break;
    }
  }
  
  // Extract specific brand names if mentioned
  if (userMessage && openAIApiKey) {
    try {
      const extractionPrompt = `Extract any specific brand names the user is suggesting or mentioning from this text.
Look especially for:
1. Brands listed under headings like "Suggested Brands", "Recommendations", "Consider these brands"
2. Brands mentioned with phrases like "I suggest", "Consider", "What about", "How about", "Include"
3. Lists of brands separated by commas, "and", or line breaks
4. Brands specifically named in the context of wanting them analyzed or included

Text: "${userMessage.substring(0, 1500)}"

Rules:
- Extract ONLY actual brand names (e.g., "Nike", "Govee", "Apple")
- Do NOT extract generic terms like "brands", "companies", or "partners"
- If a brand appears multiple times, only list it once
- Return brand names exactly as written (preserve capitalization)

Return ONLY a JSON object with brand names:
{"suggested_brands": ["Brand1", "Brand2"]}

If no specific brands are mentioned, return: {"suggested_brands": []}`;
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
        body: JSON.stringify({
          model: MODELS.openai.chatMini,
          messages: [
            { role: 'system', content: 'Extract brand names from text. Return only valid JSON.' },
            { role: 'user', content: extractionPrompt }
          ],
          temperature: 0.1,
          max_tokens: 200
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
        userSuggestedBrands = result.suggested_brands || [];
        
        if (userSuggestedBrands.length > 0) {
          console.log('[runBrandSearchOrchestrator] User suggested brands detected:', userSuggestedBrands);
          add({ type: 'info', text: `🎯 User suggested brands detected: ${userSuggestedBrands.join(', ')}` });
        }
      }
    } catch (e) {
      console.log('[runBrandSearchOrchestrator] Brand extraction failed:', e.message);
    }
  }
  
  // Step 1: Use context or extract project structure from message
  // Check for follow-up phrases that indicate continuation of current context
  const isFollowUp = /^(how about|what about|also|and|more|try|find me|show me|get me)/i.test(userMessage.trim()) ||
                     userMessage.toLowerCase().includes('from the db') ||
                     userMessage.toLowerCase().includes('from database');
  
  // If it's a follow-up and we have existing context, preserve it
  let projectName = knownProjectName || intent?.args?.search_term || intent?.args?.project_name || intent?.args?.production || '';
  let extractedData = { title: projectName };
  
  // Try to get project from lastProductionContext if this seems like a follow-up
  if (isFollowUp && !projectName && lastProductionContext) {
    // Extract project name from the production context
    const contextMatch = lastProductionContext.match(/(?:title|project|production|^)\s*[:"]?\s*([^"\n,]+?)(?:["\n,]|$)/i);
    if (contextMatch) {
      projectName = contextMatch[1].trim();
      console.log('[runBrandSearchOrchestrator] Using project from context:', projectName);
      add({ type: 'info', text: `📌 Continuing with project: "${projectName}"` });
    }
  }
  
  // Only try to extract new project if we don't have one and it's not a follow-up
  if (!projectName && !isFollowUp && userMessage && openAIApiKey) {
    try {
      const extractionPrompt = `Extract the project/production/show name and key details from this text. Return ONLY valid JSON.

Text: "${userMessage.substring(0, 1000)}"

Return format:
{
  "title": "extracted title or null",
  "synopsis": "plot/description or null",
  "genre": "genre or null",
  "cast": "cast names or null",
  "location": "location or null"
}`;
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
        body: JSON.stringify({
          model: MODELS.openai.chatMini,
          messages: [
            { role: 'system', content: 'Extract structured data from text. Return only valid JSON.' },
            { role: 'user', content: extractionPrompt }
          ],
          temperature: 0.1,
          max_tokens: 200
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const extracted = JSON.parse(data.choices?.[0]?.message?.content || '{}');
        if (extracted.title) {
          projectName = extracted.title;
          extractedData = extracted;
          console.log('[runBrandSearchOrchestrator] AI extracted:', extracted);
        }
      }
    } catch (e) {
      console.log('[runBrandSearchOrchestrator] AI extraction failed:', e.message);
    }
  }
  
  let commsResults = { meetings: [], emails: [], brandHasEvidence: () => false };
  let extractedKeywords = [];

  // STEP 2: HUBSPOT FETCH & NORMALIZATION
  let partnershipData = knownPartnershipData; // Use known data if available
  
  if (partnershipData) {
    // We already have the data from context, no need to search
    add({ type: 'info', text: `📦 Using existing partnership data for "${partnershipData.title || partnershipData.partnership_name || projectName || 'project'}"` });
    console.log('[runBrandSearchOrchestrator] Using knownPartnershipData, skipping HubSpot search');
  } else if (projectName && hubspotAPI?.getPartnershipForProject) {
    // Only fetch from HubSpot if we don't have the data AND we have a project name
    add({ type: 'process', text: `🔍 Checking HubSpot for "${projectName}"...` });
    try {
      const rawPartnershipData = await hubspotAPI.getPartnershipForProject(projectName);
      if (rawPartnershipData) {
        partnershipData = normalizePartnership(rawPartnershipData);
        console.log('[runBrandSearchOrchestrator] Fetched and normalized HubSpot data');
        add({ type: 'result', text: `✅ Found "${projectName}" in HubSpot with synopsis` });
      } else {
        add({ type: 'info', text: `ℹ️ "${projectName}" not in HubSpot - using extracted details from message` });
      }
    } catch (error) {
      console.error('[runBrandSearchOrchestrator] Error fetching partnership data:', error);
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
    hasCast: !!finalPartnershipData.cast,
    requestedCategory
  });
  
  try {
    const processText = requestedCategory 
      ? `🤠 Selecting ${requestedCategory} brands by creative fit...`
      : '🤠 Selecting brands by creative fit...';
    add({ type: 'process', text: processText });
    
    let ranked = await getCreativeFitBrands(finalPartnershipData, { add });
    
    // Filter by requested category if specified
    if (requestedCategory && ranked?.length) {
      const filteredRanked = ranked.filter(b => {
        const brandCategory = b.main_category || b.properties?.main_category || '';
        return brandCategory.toLowerCase().includes(requestedCategory.toLowerCase()) ||
               requestedCategory.toLowerCase().includes(brandCategory.toLowerCase());
      });
      
      if (filteredRanked.length > 0) {
        ranked = filteredRanked;
        add({ type: 'info', text: `🎯 Found ${ranked.length} ${requestedCategory} brands` });
      } else {
        add({ type: 'warning', text: `⚠️ No ${requestedCategory} brands found, showing all categories` });
      }
    }
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
  
  // Apply communications tagging to AI-ranked brands (NO SCORE BOOST, JUST TAGS)
  const commsText = [
    ...commsResults.meetings.map(m => `${m.title || ''} ${m.summary?.overview || ''} ${m.summary?.keywords?.join(' ') || ''}`),
    ...commsResults.emails.map(e => `${e.subject || ''} ${e.preview || ''}`)
  ].join(' ').toLowerCase();
  
  const taggedBrands = finalPickerList.map(brand => {
    const brandName = (brand.brand_name || brand.properties?.brand_name || '').toLowerCase();
    
    // Keep the original creative reason unchanged
    const finalReason = brand.reason || generateReason(brand, finalPartnershipData);
    
    // Only add tags if found in communications, NO score boost, NO reason modification
    if (brandName && brandName.length > 2 && commsText.includes(brandName)) {
      // Just add a tag, don't modify score or reason
      brand.tags = [...(brand.tags || []), '💬 Recent Comms Mention'];
      add({ type: 'info', text: `💬 Found ${brand.brand_name} in recent communications (tag only, no boost)` });
    }
    
    brand.reason = finalReason; // Keep the original creative reason
    return brand;
  });
  
  // Sort by the original AI creative fit scores (no boosting)
  let allRankedBrands = taggedBrands.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  
  // Take top 50 brands
  allRankedBrands = allRankedBrands.slice(0, 50);
  
  // Add source information to brands
  allRankedBrands = allRankedBrands.map(brand => ({
    ...brand,
    source: brand.source || (usedAI ? '🤖 AI Ranking' : '🎯 Curated Buckets')
  }));
  
  // --- USER-FIRST SELECTION WITH DEEP DIVE ---
  // Prioritize user-suggested brands if they exist
  const brandsForPitching = [];
  
  if (userSuggestedBrands.length > 0) {
    add({ type: 'process', text: '🎯 Prioritizing user-suggested brands for deep dive...' });
    
    // Find user-suggested brands in our ranked list
    const foundSuggestedBrands = [];
    const suggestedNotFound = [];
    
    for (const suggestedName of userSuggestedBrands) {
      const suggestedLower = suggestedName.toLowerCase().trim();
      let foundBrand = allRankedBrands.find(b => {
        const brandName = (b.brand_name || b.properties?.brand_name || '').toLowerCase().trim();
        return brandName === suggestedLower || brandName.includes(suggestedLower) || suggestedLower.includes(brandName);
      });
      
      if (!foundBrand && hubspotAPI?.searchBrands) {
        // Try searching HubSpot directly for the suggested brand
        try {
          add({ type: 'info', text: `🔍 Searching HubSpot for "${suggestedName}"...` });
          const searchResult = await hubspotAPI.searchBrands({
            query: suggestedName,
            limit: 1,
            properties: ['brand_name', 'main_category', 'product_sub_category__multi_', 
                        'client_status', 'client_type', 'partnership_count', 'deals_count']
          });
          
          if (searchResult?.results?.length > 0) {
            const hubspotBrand = searchResult.results[0];
            foundBrand = {
              ...hubspotBrand,
              id: hubspotBrand.id,
              brand_name: hubspotBrand.properties?.brand_name || suggestedName,
              main_category: hubspotBrand.properties?.main_category || 'General',
              product_sub_category__multi_: hubspotBrand.properties?.product_sub_category__multi_ || '',
              relevanceScore: 100, // Give user-suggested brands highest priority
              reason: `User-requested brand for ${projectName || 'project'}`,
              tags: ['👤 User Suggested'],
              source: 'user-suggestion'
            };
            // Add to allRankedBrands so it's available for selection
            allRankedBrands.unshift(foundBrand);
          }
        } catch (error) {
          console.log(`[runBrandSearchOrchestrator] Failed to search for user-suggested brand "${suggestedName}":`, error.message);
        }
      }
      
      if (foundBrand) {
        foundSuggestedBrands.push(foundBrand);
        const brandName = foundBrand.brand_name || foundBrand.properties?.brand_name || 'Unknown';
        add({ type: 'info', text: `✅ Found user-suggested brand: ${brandName}` });
      } else {
        suggestedNotFound.push(suggestedName);
        add({ type: 'warning', text: `⚠️ User-suggested brand "${suggestedName}" not found in system - treating as external brand` });
        
        // Create a placeholder for external brands not in our system
        const externalBrand = {
          id: `external-${suggestedName.replace(/\s+/g, '-').toLowerCase()}`,
          brand_name: suggestedName,
          main_category: 'External/Unknown',
          relevanceScore: 95, // Still high priority since user requested
          reason: `User-requested external brand for ${projectName || 'project'}`,
          tags: ['👤 User Suggested', '🌐 External'],
          source: 'user-suggestion-external',
          isExternal: true
        };
        foundSuggestedBrands.push(externalBrand);
        allRankedBrands.unshift(externalBrand);
      }
    }
    
    // Add found suggested brands first
    foundSuggestedBrands.forEach((brand, idx) => {
      brandsForPitching.push(brand);
      const brandName = brand.brand_name || brand.properties?.brand_name || 'Unknown';
      add({ type: 'info', text: `🎯 User Priority #${idx + 1}: ${brandName} (user-suggested)` });
    });
    
    // If we have less than 2 brands, fill with top creative fits
    if (brandsForPitching.length < 2) {
      const remainingSlots = 2 - brandsForPitching.length;
      const usedBrandNames = new Set(brandsForPitching.map(b => (b.brand_name || b.properties?.brand_name || '').toLowerCase()));
      
      let added = 0;
      for (const brand of allRankedBrands) {
        const brandName = (brand.brand_name || brand.properties?.brand_name || '').toLowerCase();
        if (!usedBrandNames.has(brandName)) {
          brandsForPitching.push(brand);
          usedBrandNames.add(brandName);
          const displayName = brand.brand_name || brand.properties?.brand_name || 'Unknown';
          add({ type: 'info', text: `🎨 Creative Fit #${brandsForPitching.length}: ${displayName} (score: ${Math.round(brand.relevanceScore || 0)})` });
          added++;
          if (added >= remainingSlots) break;
        }
      }
    }
  } else {
    // No user suggestions - use pure creative fit selection
    add({ type: 'process', text: '🎨 Selecting top 2 brands by pure creative fit...' });
    
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
  }
  
  // Ensure we have at least some brands
  if (brandsForPitching.length === 0 && allRankedBrands.length > 0) {
    brandsForPitching.push(allRankedBrands[0]);
    if (allRankedBrands.length > 1) {
      brandsForPitching.push(allRankedBrands[1]);
    }
  }
  
  // Run appropriate deep dive based on whether we have user suggestions
  const hasUserSuggestions = userSuggestedBrands.length > 0 && brandsForPitching.some(b => 
    b.source === 'user-suggestion' || b.source === 'user-suggestion-external'
  );
  
  if (hasUserSuggestions) {
    add({ type: 'process', text: '🔬 Running FULL analysis for user-suggested brands (90-day comms, web search, market context)' });
  } else {
    add({ type: 'process', text: '⚡ Running LITE analysis (30-day comms, no web search)' });
  }
  
  const { deepDiveMultipleBrands } = await import('./deepDive.js');
  const deepDiveResults = await deepDiveMultipleBrands(
    brandsForPitching, 
    finalPartnershipData, 
    { 
      isLite: !hasUserSuggestions, // FULL for user suggestions, LITE for AI picks
      add, 
      communications: hasUserSuggestions ? null : commsResults // Don't reuse comms for FULL mode
    }
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
BRAND ${idx + 1}: ${brand.brand_name || brand.properties?.brand_name || brand.name}
Strategic Fit: ${brand.deepInsights?.strategicFit || brand.reason}
Integration Ideas:
${(brand.deepInsights?.integrationIdeas || brand.integrationIdeas || []).map((idea, i) => `${i+1}. ${idea}`).join('\n')}
Why It Works: ${brand.deepInsights?.whyItWorks || brand.whyItWorks || 'Creates cohesive brand narrative'}
HB Insight: ${brand.deepInsights?.insight || brand.hbInsight || 'Based on analysis'}
${brand.deepInsights?.campaignTimeline ? `Timeline: ${brand.deepInsights.campaignTimeline}` : ''}
${brand.deepInsights?.budgetEstimate ? `Budget: ${brand.deepInsights.budgetEstimate}` : ''}`).join('\n\n')}

Format each brand EXACTLY as shown below. You MUST use the exact brand name from BRAND 1, BRAND 2, etc. without any shortening or abbreviation:
Brand: [Use EXACT name from BRAND X above - no shortening]
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
1. **Brand Name:** You MUST use the EXACT brand name as provided in BRAND_1 and BRAND_2 above. DO NOT shorten, abbreviate, or creatively modify the name in ANY way (e.g., if given "Bio Bidet by Bemis", use exactly that, not "Bio Bidet").
2. **Integration Idea:** Write a brief, exciting on-screen or campaign description. It should be a short elevator pitch.
3. **Why it works:** Your reasoning MUST deeply connect the brand's specific Category and Subcategories to the project's Genre, Vibe, and Synopsis. This is the most important rule. Explain the natural, organic fit.
4. **HB Insights:** You MUST use the exact text from "EVIDENCE_PROVIDED" for your insight.
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
          { role: 'system', content: 'You are a creative brand partnership specialist. CRITICAL: Use the EXACT brand names as provided - never shorten or abbreviate them. Follow the formatting rules exactly. Never use asterisks. Start directly with content, no preambles.' },
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
      const brandName = brand.brand_name || brand.properties?.brand_name || brand.name || 'Unknown Brand';
      const category = brand.main_category || brand.properties?.main_category || brand.category || 'General';
      const partnershipCount = brand.partnership_count || brand.partnershipCount || '0';
      const dealsCount = brand.deals_count || brand.dealsCount || '0';
      
      return `Brand: ${brandName}
Integration: Strategic ${brandName} placement integrated naturally into key production moments.
Why it works: Strong alignment between ${brandName} and production themes.
HB Insights: ${partnershipCount} previous partnerships and ${dealsCount} deals demonstrate proven entertainment value.`;
    }).join('\n\n');
  }

  // Split the AI response into chunks, one for each brand.
  // The split pattern looks for "Brand:" at the beginning of a line.
  const brandSections = finalFormattedText.split(/\n(?=Brand:)/).map(s => s.trim());

  const enrichedBrandsWithContent = topBrands.map((originalBrand, index) => {
    // Get the actual brand name from the brand object
    const actualBrandName = originalBrand.brand_name || originalBrand.properties?.brand_name || originalBrand.name || '';
    
    // Helper to clean the name for matching - more flexible approach
    const cleanBrandNameForMatch = actualBrandName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove all special characters
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();

    // More robust matching: check if section includes the brand name (handles AI shortening)
    let brandSectionText = null;
    
    // First try: Look for sections that include the brand name
    for (const section of brandSections) {
      const sectionLower = section.toLowerCase();
      // Extract just the brand name part from "Brand: XYZ" format
      const brandMatch = sectionLower.match(/^brand:\s*(.+?)(?:\n|$)/i);
      if (brandMatch) {
        const sectionBrandName = brandMatch[1].replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        // Check if either name contains the other (handles shortening in both directions)
        if (cleanBrandNameForMatch.includes(sectionBrandName) || sectionBrandName.includes(cleanBrandNameForMatch)) {
          console.log(`[generateCreativeContent] Matched brand "${actualBrandName}" with AI output "${brandMatch[1]}"`);
          brandSectionText = section;
          break;
        }
      }
    }
    
    // Fallback: Use position-based matching if name matching fails
    if (!brandSectionText && brandSections[index]) {
      console.log(`[generateCreativeContent] WARNING: No name match for "${actualBrandName}". Using position-based match at index ${index}`);
      brandSectionText = brandSections[index];
    } else if (!brandSectionText) {
      console.error(`[generateCreativeContent] ERROR: No content found for brand "${actualBrandName}" at index ${index}`);
    }

    return {
      ...originalBrand,
      // Assign the specific, formatted text section to the brand's content field.
      // If not found, it falls back to the brand name.
      content: brandSectionText ? brandSectionText.split('\n') : [actualBrandName],
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
        mcpThinking,
        conversationContext,
        lastProductionContext,  // Pass the production context for follow-ups
        knownPartnershipData: null  // Let orchestrator fetch if needed
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
      
      // --- THIS IS THE FIX ---
      // Prioritize the reliable knownProjectName from the previous turn 
      // over the AI's less reliable extraction from the current turn.
      let projectContext = knownProjectName || intent.args.production;

      // Add logging to confirm which context is being used
      if (knownProjectName) {
        add({ type: 'info', text: `🧠 Using known project context: "${knownProjectName}"` });
      } else if (intent.args.production) {
        add({ type: 'info', text: `🧠 Using new project context from AI router: "${intent.args.production}"` });
      }
      
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
      
      // As a final check, allow the user to explicitly override the project 
      // with the "for [Project Name]" syntax.
      const forPatternOverride = userMessage.match(/([\w\s,&]+?)\s+for\s+([\w\s]+?)$/i);
      if (forPatternOverride) {
        const parsedProject = forPatternOverride[2].trim();
        // Only override if the parsed text looks like a title (is not extremely long)
        if (parsedProject.length < 100) {
          projectContext = parsedProject;
          add({ type: 'info', text: `📝 User override detected. Setting project to: "${projectContext}"` });
        }
      }
      // --- END OF FIX ---
      
      // Fallback: try to get project from last production context if still missing
      if (!projectContext && lastProductionContext) {
        const projectMatch = lastProductionContext.match(/(?:title|project|production):\s*([^,\n]+)/i);
        if (projectMatch) {
          projectContext = projectMatch[1].trim();
        }
      }
      
      // --- SERVER-SIDE FIX: Re-establish canonical project name from HubSpot ---
      // If we have a project context (which might be incorrect synopsis from frontend),
      // use it to look up the correct partnership data and get the canonical name
      let definitiveProjectName = projectContext;
      let partnershipData = null;
      if (projectContext && hubspotAPI?.getPartnershipForProject) {
        try {
          const partnershipLookup = await hubspotAPI.getPartnershipForProject(projectContext);
          if (partnershipLookup && partnershipLookup.partnership_name) {
            // Trust HubSpot's name over what the client sent
            definitiveProjectName = partnershipLookup.partnership_name;
            partnershipData = partnershipLookup;
            add({ type: 'info', text: `✅ Re-established project context as: "${definitiveProjectName}"` });
          }
        } catch (error) {
          console.log('[handleClaudeSearch] Could not re-establish project name from HubSpot:', error.message);
        }
      }
      // Use the corrected project name from here forward
      projectContext = definitiveProjectName;
      
      // --- NEW: Reload full suggestion list from cache ---
      // Re-load the full suggestion list from the cache to persist it across requests.
      let fullSuggestionList = [];
      if (projectContext) {
        add({ type: 'info', text: `🔄 Reloading full suggestion list for "${projectContext}"...` });
        // This function is fast because it reads from a cache.
        // We pass a dummy 'add' function to prevent duplicate MCP steps in the UI.
        const contextForCache = partnershipData || { title: projectContext, partnership_name: projectContext };
        fullSuggestionList = await getCreativeFitBrands(contextForCache, { add: () => {} });
      }
      // --- END OF NEW LOGIC ---
      
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
    
      // Partnership data was already fetched earlier - just log if we have it
      if (partnershipData) {
        console.log('[handleClaudeSearch] Using partnership data for project:', projectContext);
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
          brandSuggestions: fullSuggestionList, // Use reloaded list instead of empty array
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
