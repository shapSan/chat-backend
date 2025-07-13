// api/mcp-search.js - MCP as a Vercel serverless function
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

// Your ACTUAL table configurations - ONLY Brands and Meeting Steam
const PROJECT_CONFIGS = {
  'HB-PitchAssist': {
    baseId: 'apphslK7rslGb7Z8K',
    searchMappings: {
      'meetings': {
        table: 'Meeting Steam',
        view: 'ALL Meetings',
        fields: ['Title', 'Date', 'Summary', 'Link']
      },
      'brands': {
        table: 'Brands',
        view: null,
        fields: ['Brand Name', 'Last Modified', 'Category', 'Budget', 'Campaign Summary']
      }
    }
  }
};

export default async function handler(req, res) {
  console.log('🎯 MCP Search endpoint hit!');
  console.log('📦 Request body:', req.body);
  
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { query, projectId = 'HB-PitchAssist', limit = 10 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Check if API key exists
    if (!AIRTABLE_API_KEY) {
      console.error('❌ Airtable API key not configured');
      return res.status(500).json({ 
        error: 'Airtable not configured',
        details: 'Please set AIRTABLE_API_KEY in environment variables'
      });
    }

    console.log(`MCP Search: "${query}" for project ${projectId}`);

    // Determine search type - simplified to only brands and meetings
    const searchType = determineSearchType(query);
    const config = PROJECT_CONFIGS[projectId] || PROJECT_CONFIGS['HB-PitchAssist'];
    const searchConfig = config.searchMappings[searchType];

    if (!searchConfig) {
      console.log('No matching search config for type:', searchType);
      return res.status(200).json({
        matches: [],
        total: 0,
        searchType,
        error: 'No matching data type found'
      });
    }

    // Build Airtable URL
    let url = `https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent(searchConfig.table)}`;
    const params = [`maxRecords=${limit}`];

    if (searchConfig.view) {
      params.push(`view=${encodeURIComponent(searchConfig.view)}`);
    }

    if (searchConfig.fields && searchConfig.fields.length > 0) {
      searchConfig.fields.forEach(field => {
        params.push(`fields[]=${encodeURIComponent(field)}`);
      });
    }

    url += '?' + params.join('&');

    console.log('🔗 Fetching from Airtable URL:', url);
    console.log('🔑 Using API key:', AIRTABLE_API_KEY ? 'Yes (hidden)' : 'No');

    // Fetch from Airtable
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Airtable error:', response.status, errorText);
      
      if (response.status === 403) {
        // Try to parse error for more details
        try {
          const errorJson = JSON.parse(errorText);
          console.error('Airtable 403 details:', errorJson);
        } catch (e) {
          // Not JSON, just log text
        }
        
        return res.status(403).json({ 
          error: 'Airtable access denied',
          details: 'Check that your API key has access to the base and table',
          baseId: config.baseId,
          table: searchConfig.table,
          matches: [],
          total: 0
        });
      }
      
      throw new Error(`Airtable API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`✅ Found ${data.records.length} records`);
    console.log('📊 Airtable returned', data.records.length, 'records');
    if (data.records.length > 0) {
      console.log('First record fields:', data.records[0].fields);
    }

    // Process results - only brands and meetings
    let processed;
    switch (searchType) {
      case 'meetings':
        processed = processMeetingData(data.records, query);
        break;
      case 'brands':
        processed = processBrandData(data.records, query);
        break;
      default:
        processed = processBrandData(data.records, query); // Default to brands
    }

    return res.status(200).json({
      matches: processed.slice(0, limit),
      total: processed.length,
      searchType,
      tableUsed: searchConfig.table,
      viewUsed: searchConfig.view || 'full_table'
    });

  } catch (error) {
    console.error('❌ MCP Search error:', error);
    return res.status(500).json({
      error: 'Search failed',
      details: error.message,
      matches: [],
      total: 0
    });
  }
}

// Determine search type - simplified to only brands and meetings
function determineSearchType(query) {
  const q = query.toLowerCase();
  
  if (q.includes('meeting') || q.includes('call') || q.includes('discussion')) {
    return 'meetings';
  }
  
  // Default to brands for everything else
  return 'brands';
}

// Process meeting data
function processMeetingData(records, query) {
  return records.map(record => {
    const fields = record.fields;
    return {
      id: record.id,
      title: fields['Title'] || 'Untitled Meeting',
      date: fields['Date'] || 'No date',
      summary: truncate(fields['Summary'] || 'No summary available', 150),
      link: fields['Link'] || null,  // Added link field
      relevance: calculateRelevance(fields, query),
      type: 'meeting'
    };
  }).sort((a, b) => b.relevance - a.relevance);
}

// Process brand data - handling proper field types
function processBrandData(records, query) {
  return records.map(record => {
    const fields = record.fields;
    
    // Handle Budget field - it's a number field in Airtable
    let budgetDisplay = 'Budget TBD';
    if (fields['Budget'] !== undefined && fields['Budget'] !== null) {
      budgetDisplay = `$${fields['Budget'].toLocaleString()}`;
    }
    
    // Handle Category field - it's a multiselect (array)
    let categoryDisplay = 'Uncategorized';
    if (fields['Category'] && Array.isArray(fields['Category'])) {
      categoryDisplay = fields['Category'].join(', ');
    }
    
    return {
      id: record.id,
      name: fields['Brand Name'] || 'Unknown Brand',  // Single line text
      category: categoryDisplay,  // Multiselect -> joined string
      budget: budgetDisplay,  // Number -> formatted string
      lastModified: fields['Last Modified'] || 'Unknown',  // Date field
      campaignSummary: truncate(fields['Campaign Summary'] || '', 100),  // Long text
      relevance: calculateRelevance(fields, query),
      type: 'brand'
    };
  }).sort((a, b) => b.relevance - a.relevance);
}

// Calculate relevance with smart scoring - simplified for brands and meetings
function calculateRelevance(fields, query) {
  const queryWords = query.toLowerCase().split(' ');
  let score = 0;
  
  // Calculate relevance with smart scoring - simplified for brands and meetings
  const searchableText = Object.entries(fields)
    .filter(([key, value]) => value !== null && value !== undefined)
    .map(([key, value]) => {
      // Handle different field types
      if (Array.isArray(value)) {
        return value.join(' '); // Multiselect fields
      } else if (typeof value === 'number') {
        return value.toString(); // Number fields
      } else if (typeof value === 'string') {
        return value; // String fields
      }
      return ''; // Other types
    })
    .join(' ')
    .toLowerCase();
  
  // Basic keyword matching
  queryWords.forEach(word => {
    if (searchableText.includes(word)) {
      score += 10;
    }
  });
  
  // Boost for specific criteria
  const queryLower = query.toLowerCase();
  
  // Brand-specific scoring
  if (fields['Brand Name']) {
    if (fields['Last Modified']) {
      const lastModified = new Date(fields['Last Modified']);
      const daysSince = (Date.now() - lastModified) / (1000 * 60 * 60 * 24);
      if (daysSince < 30) score += 20;
      if (daysSince < 7) score += 30;
    }
    
    if (fields['Budget'] && fields['Budget'] > 100000) {
      score += 25;
    }
    
    if (queryLower.includes('horror') && fields['Category'] && Array.isArray(fields['Category'])) {
      if (fields['Category'].some(cat => cat.toLowerCase().includes('horror'))) {
        score += 50;
      }
    }
  }
  
  // Meeting-specific scoring
  if (fields['Title']) {
    if (fields['Date']) {
      const meetingDate = new Date(fields['Date']);
      const daysSince = (Date.now() - meetingDate) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) score += 30;
      if (daysSince < 30) score += 20;
    }
  }
  
  return score;
}

// Utility function - Fixed to handle non-string values
function truncate(text, maxLength = 200) {
  // Convert to string first, handle null/undefined
  const str = text ? String(text) : '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength).trim() + '...';
}
