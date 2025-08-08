import fetch from 'node-fetch';

export const firefliesApiKey = process.env.FIREFLIES_API_KEY || 'e88b1a60-3390-4dca-9605-20e533727717';

const firefliesAPI = {
  baseUrl: 'https://api.fireflies.ai/graphql',
  
  async searchTranscripts(filters = {}) {
    try {
      console.log('[DEBUG firefliesAPI.searchTranscripts] Searching with filters:', filters);
      
      // Build the GraphQL query dynamically based on filters
      let queryParams = [];
      let variables = {};
      
      // Only add keyword if it's not empty
      if (filters.keyword && filters.keyword.trim() !== '') {
        queryParams.push('keyword: $keyword');
        variables.keyword = filters.keyword.trim();
      }
      
      // Add limit
      queryParams.push('limit: $limit');
      variables.limit = filters.limit || 10;
      
      // Add fromDate if provided
      if (filters.fromDate) {
        queryParams.push('fromDate: $fromDate');
        variables.fromDate = filters.fromDate;
      }
      
      // Build the query string
      const paramString = queryParams.length > 0 ? `(${queryParams.join(', ')})` : '';
      
      const graphqlQuery = `
        query SearchTranscripts${variables.keyword !== undefined ? '($keyword: String, $limit: Int, $fromDate: DateTime)' : '($limit: Int, $fromDate: DateTime)'} {
          transcripts${paramString} {
            id
            title
            date
            dateString
            duration
            organizer_email
            participants
            transcript_url
            summary {
              keywords
              action_items
              overview
              topics_discussed
            }
          }
        }
      `;
      
      console.log('[DEBUG firefliesAPI.searchTranscripts] GraphQL Query:', graphqlQuery);
      console.log('[DEBUG firefliesAPI.searchTranscripts] Variables:', variables);
      
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firefliesApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: graphqlQuery,
          variables: variables
        })
      });
      
      if (!response.ok) {
        console.error('[DEBUG firefliesAPI.searchTranscripts] Response not OK:', response.status);
        const errorBody = await response.text();
        console.error('[DEBUG firefliesAPI.searchTranscripts] Error body:', errorBody);
        return [];
      }
      
      const data = await response.json();
      console.log('[DEBUG firefliesAPI.searchTranscripts] Response data:', data);
      
      if (data.errors) {
        console.error('[DEBUG firefliesAPI.searchTranscripts] GraphQL errors:', data.errors);
        
        // If keyword search failed, try without keyword
        if (data.errors.some(e => e.code === 'invalid_arguments') && filters.keyword) {
          console.log('[DEBUG firefliesAPI.searchTranscripts] Retrying without keyword...');
          return this.searchTranscripts({ ...filters, keyword: undefined });
        }
        
        return [];
      }
      
      const transcripts = data.data?.transcripts || [];
      console.log(`[DEBUG firefliesAPI.searchTranscripts] Found ${transcripts.length} transcripts`);
      
      return transcripts;
    } catch (error) {
      console.error('[DEBUG firefliesAPI.searchTranscripts] Exception:', error);
      return [];
    }
  },
  
  async getTranscript(transcriptId) {
    try {
      const graphqlQuery = `
        query GetTranscript($transcriptId: String!) {
          transcript(id: $transcriptId) {
            id
            title
            date
            dateString
            duration
            host_email
            organizer_email
            participants
            meeting_attendees {
              email
            }
            transcript_url
            audio_url
            video_url
            summary {
              keywords
              action_items
              outline
              shorthand_bullet
              overview
              bullet_gist
              gist
              short_summary
              short_overview
              meeting_type
              topics_discussed
              transcript_chapters
            }
            sentences {
              index
              speaker_name
              text
              start_time
            }
          }
        }
      `;
      
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firefliesApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: graphqlQuery,
          variables: { transcriptId }
        })
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Fireflies API error: ${response.status}`);
      }
      
      const data = await response.json();
      return data.data?.transcript || null;
    } catch (error) {
      return null;
    }
  },
  
  async testConnection() {
    try {
      console.log('[DEBUG firefliesAPI.testConnection] Testing with API key:', firefliesApiKey ? 'Present' : 'Missing');
      
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firefliesApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `query { user { email name } }`
        })
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        console.error('[DEBUG firefliesAPI.testConnection] Failed with status:', response.status);
        console.error('[DEBUG firefliesAPI.testConnection] Error body:', errorBody);
        return false;
      }
      
      const data = await response.json();
      console.log('[DEBUG firefliesAPI.testConnection] Success! User:', data.data?.user?.email);
      return true;
    } catch (error) {
      console.error('[DEBUG firefliesAPI.testConnection] Exception:', error);
      return false;
    }
  }
};

export default firefliesAPI;
