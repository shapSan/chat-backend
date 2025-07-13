// mcp-server.js - Corrected for your actual table names
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

// Your ACTUAL table names from Airtable
const PROJECT_CONFIGS = {
  'HB-PitchAssist': {
    baseId: 'apphslK7rslGb7Z8K',
    
    // Map query types to your ACTUAL tables
    searchMappings: {
      // Meeting data
      'meetings': {
        table: 'Meeting Steam', // The actual table name
        view: null, // null means read from table, not a specific view
        fields: ['Title', 'Date', 'Summary']
      },
      
      // Email data
      'emails': {
        table: 'Email Stream', // The actual table name
        view: null,
        fields: ['Summary', 'Date', 'From', 'Subject']
      },
      
      // Brand data
      'brands': {
        table: 'Brands', // The actual table name
        view: null,
        fields: ['Brand Name', 'Last Modified', 'Brief Attachment', 'Category', 'Budget', 'Campaign Summary']
      },
      
      // Production/Project data
      'productions': {
        table: 'Productions', // The actual table name
        view: null,
        fields: ['Production', 'Genre', 'Content Type', 'Budget', 'Script Attachment', 'Slate Attachment', 'Project Summary']
      }
    }
  }
};

const server = new Server({
  name: 'airtable-mcp',
  version: '1.0.0',
});

// Define the search tool
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'smart_search',
    description: 'Search across Airtable data with intelligent filtering',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'User search query' },
        projectId: { type: 'string', default: 'HB-PitchAssist' },
        limit: { type: 'number', default: 10 }
      },
      required: ['query']
    }
  }]
}));

// Handle search requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'smart_search') {
    const { query, projectId = 'HB-PitchAssist', limit = 10 } = request.params.arguments;
    
    console.log(`MCP Search: "${query}" for project ${projectId}`);
    
    // Determine what type of data to search for
    const searchType = determineSearchType(query);
    const config = PROJECT_CONFIGS[projectId];
    const searchConfig = config.searchMappings[searchType];
    
    if (!searchConfig) {
      console.log(`No mapping found for search type: ${searchType}`);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'No matching data type found',
            searchType,
            query
          })
        }]
      };
    }
    
    // Build Airtable API URL
    let url = `https://api.airtable.com/v0/${config.baseId}/${encodeURIComponent(searchConfig.table)}`;
    
    // Add parameters
    const params = [`maxRecords=${limit}`];
    
    // Add view if specified (for future use)
    if (searchConfig.view) {
      params.push(`view=${encodeURIComponent(searchConfig.view)}`);
    }
    
    // Add field filtering to reduce payload
    if (searchConfig.fields && searchConfig.fields.length > 0) {
      searchConfig.fields.forEach(field => {
        params.push(`fields[]=${encodeURIComponent(field)}`);
      });
    }
    
    url += '?' + params.join('&');
    
    try {
      console.log(`Fetching from table: ${searchConfig.table}`);
      
      const response = await fetch(url, {
        headers: { 
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Airtable API error ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      console.log(`Found ${data.records.length} records`);
      
      // Process results based on table type
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
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            matches: processed.slice(0, limit),
            total: processed.length,
            searchType,
            tableUsed: searchConfig.table,
            viewUsed: searchConfig.view || 'full_table'
          })
        }]
      };
      
    } catch (error) {
      console.error('MCP Search error:', error);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Search failed',
            details: error.message
          })
        }]
      };
    }
  }
});

// Determine what the user is searching for
function determineSearchType(query) {
  const q = query.toLowerCase();
  
  // Check for specific keywords
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
  
  // Default to brands for general searches
  return 'brands';
}

// Process meeting data from Meeting Steam
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

// Process email data from Email Stream
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

// Process production/project data
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

// Process prompt data
function processPromptData(records, query) {
  return records.map(record => {
    const fields = record.fields;
    return {
      id: record.id,
      name: fields['Name'] || 'Unnamed Prompt',
      summary: truncate(fields['Summary'] || '', 150),
      test: fields['Test'] || '',
      relevance: calculateRelevance(fields, query),
      type: 'prompt'
    };
  }).sort((a, b) => b.relevance - a.relevance);
}

// Generic data processor
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

// Calculate relevance score with smarter logic
function calculateRelevance(fields, query) {
  const queryWords = query.toLowerCase().split(' ');
  let score = 0;
  
  // Create searchable text from all fields
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
  
  // Boost score for specific criteria
  const queryLower = query.toLowerCase();
  
  // For brand searches
  if (fields['Brand Name']) {
    // Boost if brand is recently active
    if (fields['Last Modified']) {
      const lastModified = new Date(fields['Last Modified']);
      const daysSince = (Date.now() - lastModified) / (1000 * 60 * 60 * 24);
      if (daysSince < 30) score += 20; // Active in last 30 days
      if (daysSince < 7) score += 30;  // Active in last week
    }
    
    // Boost for high budget
    if (fields['Budget'] && parseInt(fields['Budget']) > 100000) {
      score += 25;
    }
    
    // Boost if query mentions specific needs
    if (queryLower.includes('horror') && fields['Category']?.toLowerCase().includes('horror')) {
      score += 50;
    }
    if (queryLower.includes('easy money') && fields['ApprovalTime'] < 7) {
      score += 40;
    }
  }
  
  // For production searches
  if (fields['Production']) {
    // Boost for matching genre
    if (queryLower.includes('horror') && fields['Genre']?.toLowerCase().includes('horror')) {
      score += 50;
    }
    // Boost for recent productions
    if (fields['Last Modified']) {
      const lastModified = new Date(fields['Last Modified']);
      const daysSince = (Date.now() - lastModified) / (1000 * 60 * 60 * 24);
      if (daysSince < 14) score += 30;
    }
  }
  
  return score;
}

// Utility function to truncate text
function truncate(text, maxLength = 200) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}

// Start the server
const transport = new StdioServerTransport();
server.connect(transport);
console.log('MCP Server started - Ready to search your Airtable tables');
