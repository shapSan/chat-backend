// lib/deepDive.js
import fetch from 'node-fetch';
import hubspotAPI from '../client/hubspot-client.js';
import { firefliesApiKey } from '../client/fireflies-client.js';
import { openAIApiKey, MODELS } from './config.js';
import { extractJson } from './core.utils.js';
import { searchFireflies, o365API, extractKeywordsForContextSearch } from './services.js';

// Define withTimeout locally to avoid circular dependency
function withTimeout(promise, ms, defaultValue) {
  let timeoutId = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(defaultValue), ms);
  });
  return Promise.race([promise, timeoutPromise]).then((result) => {
    clearTimeout(timeoutId);
    return result;
  });
}

// HubSpot fields we need for deep dive
const BRAND_FIELDS = [
  'hs_object_id',
  'brand_name',
  'brand_website_url', 
  'one_sheet_link',
  'main_category',
  'product_sub_category__multi_',
  'target_gen',
  'target_age_group__multi_',
  'client_status',
  'partnership_count',
  'deals_count'
];

const PARTNERSHIP_FIELDS = [
  'hs_object_id',
  'partnership_name',
  'genre_production',
  'movie_rating',
  'tv_ratings',
  'synopsis',
  'release__est__date',
  'production_start_date',
  'cast',
  'location'
];

/**
 * Search communications for brand + production mentions
 */
async function searchCommunications(brand, partnershipData) { // Use the full brand object
  const results = { meetings: [], emails: [], keywords: [] };
  const searchTerms = new Set(); // Use a Set to avoid duplicates
  
  // Only add the 4 specific search terms
  if (brand.brand_name) searchTerms.add(brand.brand_name);
  if (brand.main_category) searchTerms.add(brand.main_category);
  
  const productionName = partnershipData.partnership_name || partnershipData.title;
  if (productionName && productionName !== 'Not specified') searchTerms.add(productionName);
  
  const genre = partnershipData.genre_production || partnershipData.vibe;
  if (genre && genre !== 'Not specified') {
    // Only add the first genre if multiple
    const firstGenre = genre.split(/[;,]/)[0].trim();
    if (firstGenre) searchTerms.add(firstGenre);
  }
  
  const finalSearchTerms = Array.from(searchTerms).filter(term => 
    term && term !== 'Not specified' && term.length > 2
  );
  results.keywords = finalSearchTerms;
  
  console.log('[searchCommunications] Using search terms:', finalSearchTerms);
  
  // Return empty results if no valid search terms
  if (finalSearchTerms.length === 0) {
    console.log('[searchCommunications] No valid search terms, returning empty results');
    return results;
  }
  
  try {
    // Parallel search Fireflies and O365
    const DAYS = 90; // Always use 90 days for consistency
    const fromDate = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
    
    const [ffResult, o365Result] = await Promise.allSettled([
      firefliesApiKey ? 
        withTimeout(searchFireflies(finalSearchTerms, { limit: 10, fromDate }), 8000, { transcripts: [] }) : 
        Promise.resolve({ transcripts: [] }),
      o365API.searchEmails ? 
        withTimeout(o365API.searchEmails(finalSearchTerms, { limit: 10 }), 8000, { emails: [] }) : 
        Promise.resolve({ emails: [] })
    ]);
    
    if (ffResult.status === 'fulfilled' && ffResult.value.transcripts) {
      results.meetings = ffResult.value.transcripts.map(t => ({
        title: t.title,
        date: t.dateString,
        summary: t.summary?.overview || '',
        relevantQuote: extractRelevantQuote(t, brand.brand_name)
      }));
    }
    
    if (o365Result.status === 'fulfilled' && o365Result.value.emails) {
      results.emails = o365Result.value.emails.map(e => ({
        subject: e.subject,
        from: e.fromName || e.from,
        date: e.receivedDate,
        preview: e.preview
      }));
    }
  } catch (error) {
    console.error('[searchCommunications] Error:', error.message);
  }
  
  console.log(`[searchCommunications] Found ${results.meetings.length} meetings, ${results.emails.length} emails`);
  
  // NO FALLBACK - return actual results only
  return results;
}

/**
 * Extract a relevant quote from transcript that mentions the brand
 */
function extractRelevantQuote(transcript, brandName) {
  if (!transcript.summary?.sentences || !brandName) return null;
  
  const brandLower = brandName.toLowerCase();
  const relevantSentence = transcript.summary.sentences.find(s => 
    s.toLowerCase().includes(brandLower)
  );
  
  return relevantSentence ? relevantSentence.substring(0, 150) : null;
}

/**
 * Get minimal market context from web search (1 search only)
 */
async function getMarketContext(brandName, isLite = false) {
  if (!brandName || isLite) {
    return { recentActivity: null, source: null };
  }
  
  console.log(`[getMarketContext] Starting web search for brand: "${brandName}"`);
  
  try {
    // Import web search dynamically to avoid circular dependencies
    const { searchWeb } = await import('./services.js');
    
    // Wrap searchWeb in try-catch for better error handling
    let searchResults;
    try {
      searchResults = await withTimeout(
        searchWeb(`"${brandName}" marketing campaign 2025 OR partnership OR activation`, { limit: 3 }),
        8000,  // Increased timeout for better reliability
        { results: [] }
      );
    } catch (searchError) {
      console.error(`[getMarketContext] searchWeb failed for "${brandName}":`, searchError.message);
      return { recentActivity: null, source: null };
    }
    
    if (searchResults?.results?.length > 0) {
      console.log(`[getMarketContext] ✅ Success: Found ${searchResults.results.length} results for "${brandName}"`);
      return {
        recentActivity: searchResults.results[0].snippet || null,
        source: searchResults.results[0].url || null
      };
    } else {
      console.log(`[getMarketContext] No results found for "${brandName}"`);
    }
  } catch (error) {
    console.error('[getMarketContext] Error:', error.message, error.stack);
  }
  
  return { recentActivity: null, source: null };
}

/**
 * Generate strategic insights using AI
 */
async function generateDeepInsights(hubspotData, marketContext, commsData, isLite = false) {
  if (!openAIApiKey) {
    return {
      strategicFit: 'Brand aligns with production themes',
      integrationIdeas: 'Product placement opportunity, campaign tie-in potential, and cross-promotion possibility',
      pitchAngle: 'Strong demographic alignment'
    };
  }
  
  // Build communications context
  const commsContext = [];
  if (commsData?.meetings?.length > 0) {
    commsContext.push(`Recent meeting: "${commsData.meetings[0].title}"`);
  }
  if (commsData?.emails?.length > 0) {
    commsContext.push(`Email thread: "${commsData.emails[0].subject}"`);
  }
  
  const prompt = isLite ? 
    // NEW LITE VERSION - Asks for reliable JSON output
    `Analyze this brand/film pairing and return a JSON object.

    <Brand>
    Name: ${hubspotData.brand.brand_name}
    Category: ${hubspotData.brand.main_category}
    </Brand>

    <Film>
    Name: ${hubspotData.partnership.partnership_name}
    Genre: ${hubspotData.partnership.genre_production}
    Synopsis Excerpt: ${(hubspotData.partnership.synopsis || '').substring(0, 200)}
    </Film>

    CRITICAL: Return ONLY a valid JSON object with these exact keys:
    {
      "strategicFit": "A concise sentence (max 20 words) explaining the strategic fit.",
      "integrationIdeas": [
        "A specific, creative integration idea (max 20 words).",
        "A second specific integration idea (max 20 words)."
      ],
      "insight": "A data-driven insight (max 15 words)."
    }` :
    
    // FULL VERSION - Comprehensive insights for user-selected brands
    `Brand: ${hubspotData.brand.brand_name}
Category: ${hubspotData.brand.main_category}
Subcategories: ${hubspotData.brand.product_sub_category__multi_ || 'N/A'}
Target Demo: ${hubspotData.brand.target_gen} / ${hubspotData.brand.target_age_group__multi_}
Partnership History: ${hubspotData.brand.partnership_count} integrations

Film: ${hubspotData.partnership.partnership_name}
Genre: ${hubspotData.partnership.genre_production}
Rating: ${hubspotData.partnership.movie_rating || hubspotData.partnership.tv_ratings}
Cast: ${hubspotData.partnership.cast}
Location: ${hubspotData.partnership.location}
Synopsis: ${hubspotData.partnership.synopsis}

Recent Market Activity: ${marketContext.recentActivity || 'No recent campaigns found'}
${commsContext.length > 0 ? `\nInternal Communications:\n${commsContext.join('\n')}` : ''}
${commsData?.meetings?.length > 0 && commsData.meetings[0].relevantQuote ? `\nKey Quote: "${commsData.meetings[0].relevantQuote}"` : ''}

Generate comprehensive insights:
1. Strategic Fit Analysis (30 words) - Why this brand-production match is powerful
2. Integration Paragraph (40-60 words) - Combine your top 2-3 integration ideas into a single, cohesive paragraph.
3. Why It Works - Explain how all 3 ideas create a cohesive brand narrative (25 words)
4. HB Insights - Data-driven insight from communications or market activity (20 words)
5. Campaign activation suggestion with timeline (20 words)
6. Estimated budget tier based on category and scale (15 words)

All integration ideas must:
- Reference specific plot points, cast, or locations
- Build on each other to tell a brand story
- Feel organic to the narrative`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAIApiKey}` },
      body: JSON.stringify({
        // Use a modern, reliable model like gpt-4o-mini
        model: isLite ? 'gpt-4o-mini' : MODELS.openai.chat,
        messages: [
          { role: 'system', content: 'You are a brand integration strategist. Return ONLY valid JSON when requested.' },
          { role: 'user', content: prompt }
        ],
        // Add this line to enable JSON mode for the LITE prompt
        ...(isLite && { response_format: { type: 'json_object' } }),
        temperature: 0.7,
        max_tokens: isLite ? 300 : 800 // Increase LITE tokens for JSON
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      // Parse the response into structured format
      if (isLite) {
        // NEW LITE PARSER - Robustly extracts JSON
        const parsed = extractJson(content);
        return {
          strategicFit: parsed?.strategicFit || 'Natural brand fit',
          // Ensure integrationIdeas is always an array
          integrationIdeas: Array.isArray(parsed?.integrationIdeas) ? parsed.integrationIdeas : [],
          insight: parsed?.insight || 'Strong alignment with production themes'
        };
      } else {
        // Parse full response
        const sections = content.split(/\d\.\s+/);
        return {
          strategicFit: sections[1]?.trim() || 'Strategic alignment identified',
          integrationIdeas: sections[2]?.trim() || '',
          whyItWorks: sections[3]?.trim() || 'Creates cohesive brand narrative',
          insight: sections[4]?.trim() || 'Based on recent activity',
          campaignTimeline: sections[5]?.trim() || 'Pre-release activation recommended',
          budgetEstimate: sections[6]?.trim() || 'Mid-tier budget suggested'
        };
      }
    }
  } catch (error) {
    console.error('[generateDeepInsights] Error:', error.message);
  }
  
  return {
    strategicFit: 'Brand aligns with production themes',
    integrationIdeas: 'Integration opportunity identified',
    pitchAngle: 'Demographic alignment'
  };
}

/**
 * Main deep dive function - can run in LITE or FULL mode
 */
export async function deepDiveBrand(brandId, partnershipData, options = {}) {
  const { isLite = false, add = () => {}, communications = null } = options;
  
  // Get brand data from HubSpot
  let brand = null;
  if (typeof brandId === 'object') {
    // Already have brand data
    brand = brandId;
  } else {
    // Fetch from HubSpot
    try {
      const searchResult = await hubspotAPI.searchBrands({
        filterGroups: [{
          filters: [{ propertyName: 'hs_object_id', operator: 'EQ', value: String(brandId) }]
        }],
        limit: 1,
        properties: BRAND_FIELDS
      });
      
      if (searchResult?.results?.length > 0) {
        brand = searchResult.results[0].properties;
      }
    } catch (error) {
      console.error('[deepDiveBrand] Error fetching brand:', error);
    }
  }
  
  if (!brand) {
    add({ type: 'warning', text: '⚠️ Could not fetch brand data' });
    return null;
  }
  
  // Now we have brand, add MCP step
  add({ type: 'process', text: `${isLite ? '⚡' : '🔬'} ${isLite ? 'Quick' : 'Deep'} dive: ${brand.brand_name || brand.name || 'Brand'}` });
  
  // Use provided communications or search for new ones
  let commsData = communications;
  if (!commsData) {
    // Only search if not provided - pass the full brand object
    commsData = await searchCommunications(
      brand,
      partnershipData
    );
  }
  
  if (commsData && (commsData.meetings?.length > 0 || commsData.emails?.length > 0)) {
    add({ type: 'info', text: `📧 Found ${commsData.meetings?.length || 0} meetings, ${commsData.emails?.length || 0} emails` });
  }
  
  // Get market context (skip for lite mode)
  const marketContext = await getMarketContext(brand.brand_name || brand.name, isLite);
  
  // Generate AI insights
  const insights = await generateDeepInsights(
    { 
      brand, 
      partnership: partnershipData 
    },
    marketContext,
    commsData,
    isLite
  );
  
  // Build response
  const result = {
    // Core data
    brandName: brand.brand_name || brand.name,
    category: brand.main_category || brand.category,
    demographics: {
      generation: brand.target_gen,
      ageGroups: brand.target_age_group__multi_
    },
    
    // Production info
    production: partnershipData.partnership_name || partnershipData.title,
    genre: partnershipData.genre_production || partnershipData.vibe,
    
    // Market intelligence (full mode only)
    ...(marketContext.recentActivity && {
      currentContext: marketContext.recentActivity,
      source: marketContext.source
    }),
    
    // AI-generated insights
    strategicFit: insights.strategicFit,
    integrationIdeas: insights.integrationIdeas || '',
    whyItWorks: insights.whyItWorks || insights.strategicFit,
    insight: insights.insight || 'Based on analysis',
    ...(insights.campaignTimeline && { campaignTimeline: insights.campaignTimeline }),
    ...(insights.budgetEstimate && { budgetEstimate: insights.budgetEstimate }),
    
    // Communications data
    ...(commsData.meetings.length > 0 && { 
      recentMeetings: commsData.meetings.slice(0, 2) 
    }),
    ...(commsData.emails.length > 0 && { 
      recentEmails: commsData.emails.slice(0, 2) 
    }),
    
    // Resources
    brandWebsite: brand.brand_website_url,
    materials: brand.one_sheet_link,
    
    // Metadata
    analysisDepth: isLite ? 'lite' : 'full'
  };
  
  add({ type: 'result', text: `✅ ${isLite ? 'Quick' : 'Deep'} analysis complete for ${result.brandName}` });
  
  return result;
}

/**
 * Batch deep dive for multiple brands
 */
export async function deepDiveMultipleBrands(brands, partnershipData, options = {}) {
  const { isLite = false, add = () => {}, communications = null } = options;
  
  add({ type: 'start', text: `🔬 Analyzing ${brands.length} brands...` });
  
  const results = [];
  for (const brand of brands) {
    const brandId = brand.id || brand.hs_object_id || brand;
    const result = await deepDiveBrand(brandId, partnershipData, { isLite, add, communications });
    if (result) {
      results.push(result);
    }
  }
  
  return results;
}
