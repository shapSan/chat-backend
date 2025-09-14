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
async function searchCommunications(brandName, partnershipData, isLite = false) {
  const results = { meetings: [], emails: [], keywords: [] };
  
  // Generate smart keywords for searching
  const productionName = partnershipData.partnership_name || partnershipData.title;
  const searchTerms = [];
  
  // LITE: Just brand + production
  if (isLite) {
    if (brandName) searchTerms.push(brandName);
    if (productionName) searchTerms.push(productionName);
  } else {
    // FULL: Brand + production + strategic keywords
    if (brandName) searchTerms.push(brandName);
    if (productionName) searchTerms.push(productionName);
    
    // Add genre-specific keywords
    const genre = partnershipData.genre_production || partnershipData.vibe || '';
    if (genre.toLowerCase().includes('action')) searchTerms.push('car chase', 'stunt');
    if (genre.toLowerCase().includes('romance')) searchTerms.push('proposal', 'wedding');
    if (genre.toLowerCase().includes('comedy')) searchTerms.push('product placement', 'integration');
  }
  
  results.keywords = searchTerms;
  
  // Search only if we have terms
  if (searchTerms.length === 0) return results;
  
  try {
    // Parallel search Fireflies and O365
    const DAYS = isLite ? 30 : 90; // LITE searches 30 days, FULL searches 90 days
    const fromDate = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
    
    const [ffResult, o365Result] = await Promise.allSettled([
      firefliesApiKey ? 
        withTimeout(searchFireflies(searchTerms, { limit: isLite ? 3 : 10, fromDate }), 8000, { transcripts: [] }) : 
        Promise.resolve({ transcripts: [] }),
      o365API.searchEmails ? 
        withTimeout(o365API.searchEmails(searchTerms, { limit: isLite ? 3 : 10 }), 8000, { emails: [] }) : 
        Promise.resolve({ emails: [] })
    ]);
    
    if (ffResult.status === 'fulfilled' && ffResult.value.transcripts) {
      results.meetings = ffResult.value.transcripts.map(t => ({
        title: t.title,
        date: t.dateString,
        summary: t.summary?.overview || '',
        relevantQuote: extractRelevantQuote(t, brandName)
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
  
  try {
    // Import web search dynamically to avoid circular dependencies
    const { searchWeb } = await import('./services.js');
    
    const searchResults = await withTimeout(
      searchWeb(`"${brandName}" marketing campaign 2025 OR partnership OR activation`, { limit: 3 }),
      5000,
      { results: [] }
    );
    
    if (searchResults.results?.length > 0) {
      return {
        recentActivity: searchResults.results[0].snippet || null,
        source: searchResults.results[0].url || null
      };
    }
  } catch (error) {
    console.error('[getMarketContext] Error:', error.message);
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
      integrationIdeas: ['Product placement opportunity', 'Campaign tie-in potential', 'Cross-promotion possibility'],
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
    // LITE VERSION - Quick insights for AI-selected top 2
    `Brand: ${hubspotData.brand.brand_name}
Category: ${hubspotData.brand.main_category}
Target: ${hubspotData.brand.target_gen || 'General'}

Film: ${hubspotData.partnership.partnership_name}
Genre: ${hubspotData.partnership.genre_production}
Synopsis excerpt: ${(hubspotData.partnership.synopsis || '').substring(0, 200)}
${commsContext.length > 0 ? `\nRecent Activity: ${commsContext.join('; ')}` : ''}

Generate:
1. ONE strategic fit sentence (20 words)
2. THREE specific integration ideas (20 words each)
3. ONE insight based on the data (15 words)

Be specific to THIS production's plot/genre/cast.` :
    
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
2. THREE specific integration ideas with scene descriptions (30 words each) that connect logically
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
        model: isLite ? MODELS.openai.chatMini : MODELS.openai.chat,
        messages: [
          { role: 'system', content: 'You are a brand integration strategist. Be specific and actionable.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: isLite ? 200 : 800
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      // Parse the response into structured format
      if (isLite) {
        const lines = content.split('\n').filter(l => l.trim());
        const sections = content.split(/\d\.\s+/);
        return {
          strategicFit: sections[1]?.trim() || lines[0] || 'Natural brand fit',
          integrationIdeas: [
            sections[2]?.split('\n')[0]?.trim(),
            sections[2]?.split('\n')[1]?.trim(),
            sections[2]?.split('\n')[2]?.trim()
          ].filter(Boolean).slice(0, 3),
          insight: sections[3]?.trim() || 'Strong alignment with production themes'
        };
      } else {
        // Parse full response
        const sections = content.split(/\d\.\s+/);
        return {
          strategicFit: sections[1]?.trim() || 'Strategic alignment identified',
          integrationIdeas: [
            sections[2]?.split('\n')[0]?.trim(),
            sections[2]?.split('\n')[1]?.trim(),
            sections[2]?.split('\n')[2]?.trim()
          ].filter(Boolean).slice(0, 3),
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
    integrationIdeas: ['Integration opportunity identified'],
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
    // Only search if not provided
    commsData = await searchCommunications(
      brand.brand_name || brand.name,
      partnershipData,
      isLite
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
    integrationIdeas: insights.integrationIdeas || [],
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
