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
import { 
  loadSessionContext, 
  saveSessionContext, 
  detectNewProject 
} from './session.js';

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
 * Intelligently extract the project name from any partnership data structure
 * Uses AI to be robust against inconsistent field names
 */
async function extractProjectName(partnershipData) {
  if (!partnershipData || !openAIApiKey) return null;
  
  // Common placeholder values to ignore
  const PLACEHOLDERS = ['tbd', 'to be determined', 'unknown', 'untitled', 'n/a', 'na', 'none', ''];
  
  const isValidName = (name) => {
    if (!name || typeof name !== 'string') return false;
    const normalized = name.trim().toLowerCase();
    if (normalized.length === 0) return false;
    if (PLACEHOLDERS.includes(normalized)) return false;
    return true;
  };
  
  // Try common field names first for speed - prioritize title over partnership_name
  const candidates = [
    partnershipData.title,
    partnershipData.partnership_name,
    partnershipData.name,
    partnershipData.projectName
  ];
  
  for (const candidate of candidates) {
    if (!isValidName(candidate)) continue;
    
    // Remove any prefixes like "Quick Match for"
    const cleaned = candidate.replace(/^(quick match|fast match|generate.*?for)\s+/i, '').trim();
    if (isValidName(cleaned)) {
      if (cleaned !== candidate) {
        console.log(`[extractProjectName] Cleaned "${candidate}" -> "${cleaned}"`);
      }
      return cleaned;
    }
  }
  
  // Fallback: Use AI to extract from the entire data structure
  try {
    const prompt = `Extract ONLY the project/production/show name from this data. Return just the name, nothing else.

Data: ${JSON.stringify(partnershipData).substring(0, 500)}`;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: MODELS.openai.chatMini,
        messages: [
          { role: 'system', content: 'Extract the project name. Return ONLY the name, no prefixes, no explanation.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 50
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const extracted = data.choices?.[0]?.message?.content?.trim();
      if (extracted) {
        console.log(`[extractProjectName] AI extracted: "${extracted}"`);
        return extracted;
      }
    }
  } catch (error) {
    console.error('[extractProjectName] AI extraction failed:', error.message);
  }
  
  return null;
}

/**
 * Generate intelligent search terms using a single, sophisticated AI call
 * Now accepts known project name and lead actor directly to avoid redundant extraction
 */
async function generateIntelligentSearchTerms(partnershipData, { add }) {
  // Use intelligent extraction instead of rigid field mapping
  const projectName = await extractProjectName(partnershipData);
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
        name: 'quick_match_brands',
        description:
          'Use when user wants a FAST brand match using only cached data. Triggers: "quick match", "fast match", "quick brands". Uses AI analysis on cached brands only, no deep dive.',
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
- "quick match" / "fast match" / "quick brands" → quick_match_brands
- "find brands" / "brands for [production]" / vague brand search → find_brands
- "[specific brands] for [production]" / "pitches for [brands]" / "integration ideas for [brands]" → create_pitches_for_brands
- Any request for emails/meetings/communications → get_brand_activity
- User picked specific brands from picker → create_pitches_for_brands
- else → answer_general_question

Examples:
- "Quick match for Clayface" → quick_match_brands
- "Generate a quick match for Fast 11" → quick_match_brands
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
  const projectName = await extractProjectName(partnershipData) || 'unknown';
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
    title: projectName,
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
      brandsToAnalyze.map(b => {
        const brandName = b.properties?.brand_name || b.brand_name || '';
        // CRITICAL FIX: Only toLowerCase if brandName is a valid non-empty string
        const key = brandName && typeof brandName === 'string' ? brandName.toLowerCase() : '';
        return [key, b];
      })
    );
    
    const selectedBrands = [];
    for (const selection of selections) {
      if (!selection || !selection.name) {
        console.warn('[getCreativeFitBrands] Skipping invalid selection:', selection);
        continue;
      }
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
      const usedNames = new Set(finalBrands.map(b => (b.brand_name || '').toLowerCase()));
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
/**
 * NEW: Performs a fast, AI-powered match using only cached brand data.
 * Ensures data integrity by fetching full project details first.
 * Returns the SAME format as regular search, just faster.
 */
async function runQuickMatchOrchestrator(
  intent,
  { add, knownProjectName, userMessage, mcpThinking, conversationContext, knownPartnershipData, lastProductionContext }
) {
  add({ type: 'process', text: 'Fetching project details...' });

  // STEP 1: Get complete project data to ensure data integrity
  // First try to extract from known partnership data
  let projectName = knownPartnershipData ? await extractProjectName(knownPartnershipData) : null;
  
  // Fallback to knownProjectName if extraction failed
  if (!projectName) projectName = knownProjectName;
  if (!projectName && lastProductionContext) {
    const contextMatch = lastProductionContext.match(/(?:title|project|production|^)\s*[:"]​?\s*([^"\n,]+?)(?:["\n,]|$)/i);
    if (contextMatch) projectName = contextMatch[1].trim();
  }
  if (!projectName) {
     const fromMessageMatch = userMessage.match(/for\s+([\w\s]+?)$/i);
     if (fromMessageMatch) projectName = fromMessageMatch[1].trim();
  }
  
  let partnershipData = knownPartnershipData;
  if (!partnershipData && projectName && hubspotAPI?.getPartnershipForProject) {
    const rawData = await hubspotAPI.getPartnershipForProject(projectName);
    if (rawData) {
      partnershipData = normalizePartnership(rawData);
      add({ type: 'result', text: `✅ Found "${projectName}" in HubSpot.` });
    } else {
       add({ type: 'warning', text: `⚠️ Could not find "${projectName}" in HubSpot.` });
       partnershipData = { title: projectName, synopsis: lastProductionContext || userMessage };
    }
  } else if (!projectName) {
     add({ type: 'warning', text: '⚠️ No project name found.' });
     return { mcpThinking, organizedData: { error: 'Could not identify a project for the quick match.' } };
  }

  // STEP 2: Check for cached quick match results FIRST
  const cacheKey = `quick-match:${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  
  try {
    const cachedResults = await kv.get(cacheKey);
    if (cachedResults && cachedResults.matchedBrands && Array.isArray(cachedResults.matchedBrands) && cachedResults.matchedBrands.length > 0) {
      add({ type: 'info', text: `📦 Using cached quick match for "${projectName}" (${cachedResults.matchedBrands.length} brands)` });
      
      // Use cached matched brands - skip directly to creative generation
      const brandsForPitching = cachedResults.matchedBrands.slice(0, 2);
      
      add({ type: 'process', text: '⚡ Quick Match: Generating creative pitches from cache...' });
      
      // Use the cached brands directly (no deep dive)
      const creativeResult = await generateCreativeContent(brandsForPitching, {
        add,
        actualProjectName: partnershipData.title || partnershipData.partnership_name || projectName,
        search_term: userMessage,
        partnershipData,
        communications: { meetings: [], emails: [] }
      });
      
      return prepareFrontendPayload({
        enrichedBrands: creativeResult.enrichedBrands,
        allRankedBrands: cachedResults.matchedBrands,
        mcpThinking,
        projectName: partnershipData.title || partnershipData.partnership_name || projectName,
        partnershipData,
        communications: { meetings: [], emails: [] },
        finalReplyText: creativeResult.finalReplyText || `Here are quick match suggestions for ${partnershipData.title || partnershipData.partnership_name || projectName}.`
      });
    }
  } catch (error) {
    console.log('[Quick Match] Cache check failed:', error.message);
  }
  
  // STEP 2B: Load the brand database from the fast cache
  add({ type: 'process', text: 'Loading brand database from cache...' });
  const cachedBrands = await kv.get('hubspot-brand-cache');
  if (!Array.isArray(cachedBrands) || cachedBrands.length === 0) {
    add({ type: 'error', text: '❌ Brand cache is empty. Quick Match cannot proceed.' });
    return { mcpThinking, organizedData: { error: 'Brand cache is not available.' } };
  }
  
  const brandsToAnalyze = cachedBrands.slice(0, 400); // Analyze a sizable chunk
  
  // Enhanced brand list with intelligence signals for AI
  const brandList = brandsToAnalyze.map((b, idx) => {
    const name = b.properties?.brand_name || 'Unknown';
    const category = b.properties?.main_category || 'General';
    const subCats = b.properties?.product_sub_category__multi_ || '';
    const partnerships = b.properties?.partnership_count || 0;
    
    // Give AI more signals to be intelligent
    const fullCategory = subCats ? `${category}: ${subCats}` : category;
    const experience = partnerships > 0 ? ` (${partnerships} past integrations)` : '';
    
    return `${idx + 1}. ${name} [${fullCategory}]${experience}`;
  }).join('\n');
  
  // STEP 3: Use AI for FAST matching - direct to 2 brands!
  add({ type: 'process', text: '⚡ Quick Match: AI selecting TOP 2 brands...' });
  
  // Smart, strategic prompt for intelligent 2-brand selection
  const matchPrompt = `You are Hollywood Branded's senior brand strategist with deep knowledge of entertainment partnerships.

PROJECT CONTEXT:
• Title: "${partnershipData.title || projectName}"
• Genre: ${partnershipData.vibe || partnershipData.genre_production || 'Not specified'}
• Synopsis: ${(partnershipData.synopsis || 'Not provided').substring(0, 500)}
• Cast: ${partnershipData.cast || 'Not specified'}
• Location: ${partnershipData.location || 'Not specified'}

YOUR TASK:
Analyze the ${brandsToAnalyze.length} brands below and select the TOP 2 that would create the most NATURAL, AUTHENTIC integration for this specific project.

SELECTION CRITERIA (in order of importance):
1. **Category-Genre Alignment**: Does the brand's category naturally fit this genre/story?
   - Action/Thriller → Automotive, Sports, Tech, Energy Drinks
   - Romance/Drama → Fashion, Jewelry, Lifestyle
   - Comedy → Food & Beverage, Entertainment
   - Sci-Fi → Technology, Gaming, Automotive

2. **Brand Recognition & Integration Potential**: 
   - Well-known brands create stronger audience connection
   - Consider if YOU (as AI) recognize the brand name
   - Premium brands work better for premium productions

3. **Authentic Story Fit**: 
   - Would this brand NATURALLY appear in this story world?
   - Does the synopsis suggest specific product categories?
   - Does the setting/location favor certain brands?

4. **Track Record**: Brands with entertainment experience (partnership_count > 0) are safer bets

BRANDS AVAILABLE:
${brandList}

THINK STRATEGICALLY:
- Read the synopsis carefully - what products would NATURALLY appear?
- Consider the genre - what categories authentically fit?
- Use your knowledge - which brand NAMES do you recognize as leaders in their space?
- Trust your intelligence - what would a smart strategist recommend?

Return ONLY valid JSON with EXACTLY 2 selections:
{
  "selections": [
    {
      "name": "Brand Name Exactly As Listed",
      "reason": "One sentence explaining the natural fit based on category-genre alignment and story context",
      "confidence": "high"
    },
    {
      "name": "Second Brand Name",
      "reason": "One sentence for second best fit",
      "confidence": "high"
    }
  ]
}

Be confident. Pick the 2 BEST brands based on strategic thinking, not random selection.`;

  try {
    const response = await withTimeout(
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
        body: JSON.stringify({
          model: MODELS.openai.chat, // Use GPT-4o for better intelligence
          messages: [{ role: 'system', content: 'You are a brand integration expert. Return only valid JSON.' }, { role: 'user', content: matchPrompt }],
          response_format: { type: 'json_object' },
          temperature: 0.6,
          max_tokens: 400
        })
      }), 10000, null);

    if (!response || !response.ok) {
      const errorText = response ? await response.text().catch(() => 'Response unreadable') : 'Request timed out after 30s';
      console.error('[Quick Match] AI error:', errorText);
      throw new Error(`AI matching failed: ${errorText.substring(0, 100)}`);
    }

    const data = await response.json();
    const aiResponse = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    const selections = aiResponse.selections || [];

    if (selections.length === 0) throw new Error('AI returned no brand selections.');
    if (selections.length !== 2) {
      console.warn(`[Quick Match] AI returned ${selections.length} brands instead of 2. Using first 2.`);
    }
    
    const confidenceLevels = selections.map(s => s.confidence || 'medium').join(', ');
    add({ type: 'result', text: `✅ AI picked ${selections.length} brands (confidence: ${confidenceLevels})` });
    
    // STEP 4: Map results back to full brand objects
    const brandMap = new Map(brandsToAnalyze.map(b => [(b.properties?.brand_name || '').toLowerCase(), b]));
    const matchedBrands = selections.slice(0, 2).map((sel, index) => {
      const brandData = brandMap.get(sel.name.toLowerCase());
      if (!brandData) return null;
      
      return {
        ...brandData,
        brand_name: brandData.properties?.brand_name,
        main_category: brandData.properties?.main_category || 'General',
        product_sub_category__multi_: brandData.properties?.product_sub_category__multi_ || '',
        relevanceScore: 95 - index, // Rank from 95 down
        reason: sel.reason,
        confidence: sel.confidence || 'medium',
        tags: ['🚀 Quick Match'],
        source: 'ai-quick-match'
      };
    }).filter(Boolean);
    
    // Cache the AI-matched brands (24 hour TTL)
    try {
      await kv.set(cacheKey, { matchedBrands }, { ex: 86400 });
      console.log(`[Quick Match] Cached ${matchedBrands.length} matched brands for "${projectName}"`);
    } catch (error) {
      console.error('[Quick Match] Cache save failed:', error.message);
    }
    
    // STEP 5: Skip Deep Dive for speed - go straight to creative generation
    const brandsForPitching = matchedBrands.slice(0, 2);
    
    add({ type: 'process', text: '⚡ Quick Match: Generating creative pitches...' });
    
    // Use the AI-selected brands directly (no deep dive)
    const creativeResult = await generateCreativeContent(brandsForPitching, {
      add,
      actualProjectName: partnershipData.title || partnershipData.partnership_name || projectName,  // Use actual partnership name, not user message
      search_term: userMessage,
      partnershipData,
      communications: { meetings: [], emails: [] }
    });
    
    // STEP 7: Return in the SAME format as regular search
    return prepareFrontendPayload({
      enrichedBrands: creativeResult.enrichedBrands,
      allRankedBrands: matchedBrands, // All 30 brands for picker
      mcpThinking,
      projectName: partnershipData.title || partnershipData.partnership_name || projectName,  // Use actual partnership name
      partnershipData,
      communications: { meetings: [], emails: [] },
      finalReplyText: creativeResult.finalReplyText || `Here are quick match suggestions for ${partnershipData.title || partnershipData.partnership_name || projectName}.`
    });

  } catch (error) {
    add({ type: 'error', text: `❌ Quick Match Error: ${error.message}` });
    return { mcpThinking, organizedData: { error: error.message } };
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
  
  // CRITICAL FIX: Extract ONLY the project name from the search term, removing any prefix text
  // Examples: "Easy money brands for X" -> "X", "Find brands for X" -> "X", "X" -> "X"
  let projectName = knownProjectName || ''; // Start with session context
  
  // If there's a search term from the router, try to extract just the project name
  if (intent?.args?.search_term) {
    const searchTerm = intent.args.search_term;
    // Remove common prefixes like "Easy money brands for", "Find brands for", etc.
    const cleaned = searchTerm
      .replace(/^(easy money|find|get|show me|give me|suggest|recommend)\s+(brands?|companies?|partners?)\s+(for|about|related to)\s+/i, '')
      .replace(/^(brands?|companies?|partners?)\s+(for|about|related to)\s+/i, '')
      .replace(/^(for|about|related to)\s+/i, '')
      .trim();
    
    // Only use the cleaned version if it's significantly shorter (likely just the project name)
    if (cleaned.length > 0 && cleaned.length < searchTerm.length * 0.7) {
      projectName = cleaned;
      console.log(`[runBrandSearchOrchestrator] Extracted project name "${projectName}" from "${searchTerm}"`);
    } else if (!knownProjectName) {
      // If we don't have a known project and cleaning didn't help, use the full search term
      projectName = searchTerm;
    }
  }
  
  // Fallback to other intent args if still no project name
  if (!projectName && (intent?.args?.project_name || intent?.args?.production)) {
    projectName = intent.args.project_name || intent.args.production;
  }
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

  // CRITICAL FIX: Only use extractedData if partnershipData is completely missing
  // Never merge fields that might overwrite clean HubSpot data with AI extraction errors
  const finalPartnershipData = {
      title: projectName || extractedData.title,
      distributor: partnershipData?.distributor || extractedData.distributor || null,
      releaseDate: partnershipData?.releaseDate || extractedData.releaseDate || null,
      productionStartDate: partnershipData?.productionStartDate || extractedData.startDate || null,
      productionType: partnershipData?.productionType || extractedData.productionType || null,
      location: partnershipData?.location || extractedData.location || null,
      // CRITICAL: NEVER use extractedData.cast - it's unreliable and can contain AI extraction errors
      // Only use cast from verified HubSpot partnership data
      cast: partnershipData?.cast || null,
      vibe: partnershipData?.vibe || partnershipData?.genre_production || extractedData.genre || extractedData.vibe || null,
      synopsis: partnershipData?.synopsis || extractedData.synopsis || null,
  };
   
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
  
  // Intelligently extract the actual project name if not provided
  if (!actualProjectName && partnershipData) {
    actualProjectName = await extractProjectName(partnershipData) || 'this project';
  }

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
    // Use the Airtable prompt format for system message
    const airtableSystemPrompt = `You are Hollywood Branded's brand integration strategist. Suggest natural, budget-realistic partnerships for TV/film projects.
CRITICAL: If "PRIORITY CONTEXT FROM YOUR BUSINESS DATA" is provided above, you MUST:
* Include ALL "HOT" brands in your suggestions
* Reference any pending deals or recent meetings
* Prioritize brands with recent activity
* Mention if a brand was discussed in meetings

Consider: Synopsis, Cast, Distribution, Release Date, Location, Fee, Story Era, Target Demographics, and existing integrations.
Generate integration ideas that:
* Feel organic to the story
* Excite both production and brand
* Match real spending patterns
* Include hidden gems alongside majors (GenAI brands, etc.)
* PRIORITIZE brands from your active pipeline when relevant

Format rules:
* Use EXACT brand names - never shorten or abbreviate
* Never use asterisks (**) or HTML tags for brand names
* Never include links in your output
* Don't repeat brands unless offering new angles
* DON'T INCLUDE ANYTHING AFTER THE LAST BRAND Integration IDEA
* Don't summarize the response

If from MCP data, include specific REAL meeting references like "Meeting: [name] on [date]" or "Email: [subject]". DO NOT LIE IF YOU DONT HAVE PROOF OF INSIGHT!`;

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        model: MODELS.openai.chat, // Use GPT-4o for best quality
        messages: [
          { role: 'system', content: airtableSystemPrompt },
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
 * Main handler with server-side session management.
 * The session is the single source of truth for project context.
 */
export async function handleClaudeSearch(
  userMessage,
  sessionId,
  conversationContext,
  lastProductionContext,
  knownProjectName,  // DEPRECATED: Only used as fallback during migration
  runId,
  onStep = () => {}
) {
  console.log('[handleClaudeSearch] Entry');
  console.log('[handleClaudeSearch] sessionId:', sessionId);
  console.log('[handleClaudeSearch] userMessage:', userMessage);
  
  try {
    // Initialize the add function and MCP thinking array FIRST
    const mcpThinking = [];
    const add = (step) => {
      console.log('[handleClaudeSearch] add() called with step:', step);
      mcpThinking.push(step);
      try {
        if (onStep) {
          console.log('[handleClaudeSearch] Calling onStep with sessionId:', sessionId, 'runId:', runId);
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
    
    // === STEP 1: LOAD SESSION CONTEXT ===
    // Always load the current session context first
    const sessionContext = await loadSessionContext(sessionId);
    let currentProjectContext = sessionContext?.partnershipData || null;
    let currentProjectName = sessionContext?.projectName || null;
    
    if (currentProjectContext) {
      console.log('[handleClaudeSearch] Loaded session context for project:', currentProjectName);
    } else {
      console.log('[handleClaudeSearch] No existing session context');
    }
    
    // === STEP 2: DETECT NEW PROJECT ===
    // Check if the user's message signals a new project
    const newProjectInfo = await detectNewProject(userMessage, openAIApiKey);
    
    if (newProjectInfo && newProjectInfo.isNewProject && newProjectInfo.title) {
      console.log('[handleClaudeSearch] New project detected:', newProjectInfo.title);
      // This is a NEW project - ignore the loaded session context
      currentProjectName = newProjectInfo.title;
      currentProjectContext = null; // Will be fetched from HubSpot below
    } else if (!currentProjectContext && lastProductionContext) {
      // === STEP 2B: FALLBACK TO CONVERSATION HISTORY ===
      // If no session exists and this isn't a new project, check conversation history
      console.log('[handleClaudeSearch] No session context. Checking conversation history...');
      add({ type: 'info', text: '🧠 No active session. Checking conversation history...' });
      
      // Use robust marker pattern to extract project name from history
      const markerMatch = lastProductionContext.match(/\[PRODUCTION:([^\]]+)\]/i);
      if (markerMatch && markerMatch[1]) {
        const recoveredProjectName = markerMatch[1].trim();
        console.log('[handleClaudeSearch] Found project in history:', recoveredProjectName);
        
        // CRITICAL: Fetch the full data from HubSpot and save to KV immediately
        if (hubspotAPI?.getPartnershipForProject) {
          try {
            const hubspotData = await hubspotAPI.getPartnershipForProject(recoveredProjectName);
            if (hubspotData) {
              currentProjectName = hubspotData.partnership_name || recoveredProjectName;
              currentProjectContext = normalizePartnership(hubspotData);
              
              // Save the recovered context to KV to establish the session
              await saveSessionContext(sessionId, {
                projectName: currentProjectName,
                partnershipData: currentProjectContext
              });
              
              add({ type: 'result', text: `✅ Restored project context from history: "${currentProjectName}"` });
              console.log('[handleClaudeSearch] Successfully recovered and saved project to session');
            } else {
              console.log('[handleClaudeSearch] Project not found in HubSpot:', recoveredProjectName);
              add({ type: 'warning', text: `⚠️ Project "${recoveredProjectName}" not found in HubSpot` });
            }
          } catch (error) {
            console.error('[handleClaudeSearch] Error recovering from history:', error);
            add({ type: 'warning', text: '⚠️ Failed to recover project from history' });
          }
        }
      } else if (knownProjectName) {
        // Final fallback for migration
        console.log('[handleClaudeSearch] Using fallback knownProjectName:', knownProjectName);
        currentProjectName = knownProjectName;
      }
    } else if (!currentProjectName && knownProjectName) {
      // Fallback for migration: Use knownProjectName if no session exists
      console.log('[handleClaudeSearch] Using fallback knownProjectName:', knownProjectName);
      currentProjectName = knownProjectName;
    }
    
    // === STEP 3: FETCH FROM HUBSPOT IF NEEDED ===
    // If we have a project name but no partnership data, fetch it
    // (This handles new project detection and migration fallback)
    if (currentProjectName && !currentProjectContext && hubspotAPI?.getPartnershipForProject) {
      console.log('[handleClaudeSearch] Fetching partnership data from HubSpot for:', currentProjectName);
      try {
        const rawPartnershipData = await hubspotAPI.getPartnershipForProject(currentProjectName);
        if (rawPartnershipData) {
          currentProjectContext = normalizePartnership(rawPartnershipData);
          
          // === STEP 4: SAVE TO SESSION ===
          // Successfully fetched from HubSpot - save to session
          await saveSessionContext(sessionId, {
            projectName: currentProjectContext.title || currentProjectContext.partnership_name || currentProjectName,
            partnershipData: currentProjectContext
          });
          
          console.log('[handleClaudeSearch] Saved project context to session');
        }
      } catch (error) {
        console.error('[handleClaudeSearch] Error fetching from HubSpot:', error);
      }
    }
    
    // From this point forward, currentProjectContext is the single source of truth
    const projectName = currentProjectContext?.title || currentProjectContext?.partnership_name || currentProjectName;
  
  // Ensure HubSpot is ready (cold start)
  if (hubspotAPI?.initialize) {
    console.log('[handleClaudeSearch] Initializing HubSpot API...');
    await hubspotAPI.initialize().catch((err) => {
      console.error('[handleClaudeSearch] HubSpot initialization failed:', err);
    });
  }

  const intent = await routeUserIntent(userMessage, conversationContext, lastProductionContext);
  if (!intent) return null;
  
  // Add routing decision to MCP reasoning
  add({ 
    type: 'route', 
    text: `🧭 Route: ${intent.tool}${intent.tool === 'create_pitches_for_brands' ? ' (FULL deep dive)' : intent.tool === 'find_brands' ? ' (LITE deep dive)' : ''}` 
  });

  switch (intent.tool) {
    case 'quick_match_brands': {
      add({ type: 'info', text: '🚀 Starting Quick Match...' });
      // We will create this new function below
      return await runQuickMatchOrchestrator(intent, {
        add,
        knownProjectName: projectName,
        userMessage,
        mcpThinking,
        conversationContext,
        lastProductionContext,
        knownPartnershipData: currentProjectContext
      });
    }

    case 'find_brands': {
      add({ type: 'info', text: '🎯 Starting brand discovery with AI matching + LITE analysis' });
      
      if (projectName) {
        add({ type: 'info', text: `📚 Session context: "${projectName}"` });
      }
      
      return await runBrandSearchOrchestrator(intent, {
        add,
        knownProjectName: projectName,  // Pass session-managed project name
        userMessage,
        mcpThinking,
        conversationContext,
        knownPartnershipData: currentProjectContext,  // Pass session-managed data
        lastProductionContext
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
      
      // Use session-managed project context - no parsing needed!
      if (projectName) {
        add({ type: 'info', text: `📚 Session context: "${projectName}"` });
      } else {
        add({ type: 'warning', text: '⚠️ No project context in session' });
      }
      
      // Parse brand names from user message
      let brands = [];
      const forPattern = userMessage.match(/for:\s*(.+?)(?:\s+for\s+|$)/i);
      const theseBrandsPattern = userMessage.match(/these brands:\s*(.+)/i);

      let brandString = '';
      if (forPattern) {
        brandString = forPattern[1];
      } else if (theseBrandsPattern) {
        brandString = theseBrandsPattern[1];
      }
      
      if (brandString) {
        brands = brandString.split(/,|and|&/).map(b => b.trim()).filter(Boolean);
      } else {
        // Fallback to AI router's output
        brands = intent.args.brand_names || [];
      }
      
      console.log('[handleClaudeSearch] Parsed brands:', brands);
      console.log('[handleClaudeSearch] Session project:', projectName);
      
      // Use session-managed partnership data (already clean and verified)
      const partnershipData = currentProjectContext;
      
      // Reload full suggestion list from cache
      let fullSuggestionList = [];
      if (projectName && partnershipData) {
        add({ type: 'info', text: `🔄 Loading brand suggestions for "${projectName}"...` });
        // Reuse cached suggestions - fast operation
        fullSuggestionList = await getCreativeFitBrands(partnershipData, { add: () => {} });
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
      const updatedUserMessage = `Generate brand integration ideas for: ${brandNamesForMessage.join(', ')}${projectName ? ` for ${projectName}` : ''}`;
      add({ type: 'start', text: `🧠 ${updatedUserMessage}` });
    
      // Partnership data already loaded from session
      if (!partnershipData && projectName) {
        add({ type: 'warning', text: `⚠️ No partnership data in session for "${projectName}"` });
      }
    
      // Run FULL deep dive for user-selected brands
      add({ type: 'process', text: '🔬 Running FULL analysis (90-day comms, web search, market context)' });
      const { deepDiveMultipleBrands } = await import('./deepDive.js');
      const deepDiveResults = await deepDiveMultipleBrands(
        processedBrands.slice(0, 5),
        partnershipData || {
          title: projectName,
          synopsis: lastProductionContext,
          partnership_name: projectName,
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
        actualProjectName: projectName || 'your project',
        search_term: updatedUserMessage,
        partnershipData: partnershipData || {
          title: projectName,
          synopsis: lastProductionContext
        },
        isUserSelected: true
      });
    
      return prepareFrontendPayload({
        enrichedBrands: creativeResult.enrichedBrands || processedBrands,
        allRankedBrands: fullSuggestionList,
        mcpThinking,
        projectName: projectName,
        partnershipData: partnershipData || {
          title: projectName,
          synopsis: lastProductionContext
        },
        communications: { meetings: [], emails: [] },
        finalReplyText: creativeResult.finalReplyText || `Generated integration ideas for ${brandNamesForMessage.join(', ')}${projectName ? ` for ${projectName}` : ''}`
      });
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
