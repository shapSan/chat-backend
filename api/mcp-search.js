// api/mcp-search.js
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const airtableApiKey = process.env.AIRTABLE_API_KEY;

export default async function handler(req, res) {
  console.log('🎯 MCP Search endpoint hit!'); // ADD THIS
  console.log('📦 Request body:', req.body); // ADD THIS
  
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { query, projectId = 'HB-PitchAssist', limit = 10 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Missing query parameter' });
    }

    // For HB-PitchAssist, we'll search the Brand Directory
    const baseId = 'apphslK7rslGb7Z8K'; // HB-PitchAssist base
    const tableId = 'tblBrandDirectory'; // Assuming this is your brand directory table
    
    // Build Airtable search URL
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}`;
    
    console.log('🔗 Fetching from Airtable URL:', url); // ADD THIS

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${airtableApiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Airtable API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('📊 Airtable returned', data.records.length, 'records'); // ADD THIS
    if (data.records.length > 0) {
      console.log('First record fields:', data.records[0].fields); // ADD THIS
    }

    // Process and score results based on query
    const scoredResults = data.records
      .map(record => {
        const fields = record.fields;
        const brandName = fields.BrandName || '';
        const description = fields.Description || '';
        const integrationDetails = fields.IntegrationDetails || '';
        const tags = fields.Tags || [];
        
        // Simple scoring based on query match
        let score = 0;
        const queryLower = query.toLowerCase();
        
        if (brandName.toLowerCase().includes(queryLower)) score += 50;
        if (description.toLowerCase().includes(queryLower)) score += 30;
        if (integrationDetails.toLowerCase().includes(queryLower)) score += 20;
        if (tags.some(tag => tag.toLowerCase().includes(queryLower))) score += 10;
        
        return {
          brand: brandName,
          type: fields.Type || 'Unknown',
          score: score,
          details: description.slice(0, 100) + '...',
          integrationInfo: integrationDetails,
          tags: tags
        };
      })
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return res.status(200).json({
      success: true,
      results: scoredResults,
      total: scoredResults.length
    });

  } catch (error) {
    console.error('MCP Search error:', error);
    return res.status(500).json({ 
      error: 'Search failed', 
      details: error.message 
    });
  }
}
