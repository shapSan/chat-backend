// api/mcp-search.js - MCP as a Vercel serverless function
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

// Your ACTUAL table configurations
const PROJECT_CONFIGS = {
  'HB-PitchAssist': {
    baseId: 'apphslK7rslGb7Z8K',
    searchMappings: {
      'meetings': {
        table: 'Meeting Steam',
        view: null,
        fields: ['Title', 'Date', 'Summary']
      },
      'emails': {
        table: 'Email Stream',
        view: null,
        fields: ['Summary', 'Date', 'From', 'Subject']
      },
      'brands': {
        table: 'Brands',
        view: null,
        fields: ['Brand Name', 'Last Modified', 'Brief Attachment', 'Category', 'Budget', 'Campaign Summary']
      },
      'productions': {
        table: 'Productions',
        view: null,
        fields: ['Production', 'Genre', 'Content Type', 'Budget', 'Script Attachment', 'Slate Attachment', 'Project Summary']
      }
    }
  }
};

export default async function handler(req, res) {
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

    console.log(`MCP Search: "${query}" for project ${projectId}`);

    // Determine search type
    const searchType = determineSearchType(query);
    const config = PROJECT_CONFIGS[projectId] || PROJECT_CONFIGS['HB-PitchAssist'];
    const searchConfig = config.searchMappings[searchType];

    if (!searchConfig) {
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

    // Fetch from Airtable
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Airtable error:', response.status, errorText);
      throw new Error(`Airtable API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Found ${data.records.length} records`);

    // Process results
    let processed;
    switch (searchType) {
      case 'meetings':
        processed = processMeetingData(data.records, query);
        break;
      case 'emails':
        processed = processEmailData(data.records, query);
        break;
      case 'brands':
        processed = processBrandData(data.records, query);
        break;
      case 'productions':
        processed = processProductionData(data.records, query);
        break;
      default:
        processed = genericProcessData(data.records, query);
    }

    return res.status(200).json({
      matches: processed.slice(0, limit),
      total: processed.length,
      searchType,
      tableUsed: searchConfig.table,
      viewUsed: searchConfig.view || 'full_table'
    });

  } catch (error) {
    console.error('MCP Search error:', error);
    return res.status(500).json({
      error: 'Search failed',
      details: error.message
    });
  }
}

// Determine search type
function determineSearchType(query) {
  const q = query.toLowerCase();
  
  if (q.includes('meeting') || q.includes('call') || q.includes('discussion')) {
    return 'meetings';
  }
  if (q.includes('email') || q.includes('message')) {
    return 'emails';
  }
  if (q.includes('brand') || q.includes('partner') || q.includes('sponsor') || q.includes('company')) {
    return 'brands';
  }
  if (q.includes('production') || q.includes('project') || q.includes('film') || q.includes('show')) {
    return 'productions';
  }
  
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
      relevance: calculateRelevance(fields, query),
      type: 'meeting'
    };
  }).sort((a, b) => b.relevance - a.relevance);
}

// Process email data
function processEmailData(records, query) {
  return records.map(record => {
    const fields = record.fields;
    return {
      id: record.id,
      subject: fields['Subject'] || 'No subject',
      from: fields['From'] || 'Unknown sender',
      date: fields['Date'] || 'No date',
      summary: truncate(fields['Summary'] || 'No summary', 150),
      relevance: calculateRelevance(fields, query),
      type: 'email'
    };
  }).sort((a, b) => b.relevance - a.relevance);
}

// Process brand data
function processBrandData(records, query) {
  return records.map(record => {
    const fields = record.fields;
    return {
      id: record.id,
      name: fields['Brand Name'] || 'Unknown Brand',
      category: fields['Category'] || 'Uncategorized',
      budget: fields['Budget'] ? `$${parseInt(fields['Budget']).toLocaleString()}` : 'Budget TBD',
      lastModified: fields['Last Modified'] || 'Unknown',
      hasBrief: fields['Brief Attachment'] ? true : false,
      campaignSummary: truncate(fields['Campaign Summary'] || '', 100),
      relevance: calculateRelevance(fields, query),
      type: 'brand'
    };
  }).sort((a, b) => b.relevance - a.relevance);
}

// Process production data
function processProductionData(records, query) {
  return records.map(record => {
    const fields = record.fields;
    return {
      id: record.id,
      name: fields['Production'] || 'Unnamed Production',
      genre: fields['Genre'] || 'Not specified',
      contentType: fields['Content Type'] || 'Unknown',
      budget: fields['Budget'] ? `$${parseInt(fields['Budget']).toLocaleString()}` : 'Budget TBD',
      hasScript: fields['Script Attachment'] ? true : false,
      hasSlate: fields['Slate Attachment'] ? true : false,
      summary: truncate(fields['Project Summary'] || 'No summary', 150),
      relevance: calculateRelevance(fields, query),
      type: 'production'
    };
  }).sort((a, b) => b.relevance - a.relevance);
}

// Generic processor
function genericProcessData(records, query) {
  return records.map(record => {
    const fields = record.fields;
    const firstField = Object.keys(fields)[0];
    return {
      id: record.id,
      name: fields[firstField] || 'Unknown',
      data: Object.entries(fields).slice(0, 3).map(([k, v]) => `${k}: ${truncate(String(v), 50)}`).join(', '),
      relevance: calculateRelevance(fields, query),
      type: 'generic'
    };
  }).sort((a, b) => b.relevance - a.relevance);
}

// Calculate relevance with smart scoring
function calculateRelevance(fields, query) {
  const queryWords = query.toLowerCase().split(' ');
  let score = 0;
  
  const searchableText = Object.values(fields)
    .filter(v => v && typeof v === 'string')
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
  
  if (fields['Brand Name']) {
    if (fields['Last Modified']) {
      const lastModified = new Date(fields['Last Modified']);
      const daysSince = (Date.now() - lastModified) / (1000 * 60 * 60 * 24);
      if (daysSince < 30) score += 20;
      if (daysSince < 7) score += 30;
    }
    
    if (fields['Budget'] && parseInt(fields['Budget']) > 100000) {
      score += 25;
    }
    
    if (queryLower.includes('horror') && fields['Category']?.toLowerCase().includes('horror')) {
      score += 50;
    }
    if (queryLower.includes('easy money') && fields['ApprovalTime'] < 7) {
      score += 40;
    }
  }
  
  if (fields['Production']) {
    if (queryLower.includes('horror') && fields['Genre']?.toLowerCase().includes('horror')) {
      score += 50;
    }
    if (fields['Last Modified']) {
      const lastModified = new Date(fields['Last Modified']);
      const daysSince = (Date.now() - lastModified) / (1000 * 60 * 60 * 24);
      if (daysSince < 14) score += 30;
    }
  }
  
  return score;
}

// Utility function
function truncate(text, maxLength = 200) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}
