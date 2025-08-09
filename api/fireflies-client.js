// api/fireflies-client.js
import fetch from 'node-fetch';

export const firefliesApiKey = process.env.FIREFLIES_API_KEY || '';

const firefliesAPI = {
  baseUrl: 'https://api.fireflies.ai/graphql',

  /**
   * Search transcripts with optional keyword and fromDate.
   * - Always normalizes keyword to a string (prevents `.trim` crash).
   * - Keeps your dynamic GraphQL param building.
   */
  async searchTranscripts(filters = {}) {
    try {
      console.log('[DEBUG firefliesAPI.searchTranscripts] Searching with filters:', filters);

      // --- Normalize inputs (critical fix) ---
      const kw = (filters.keyword ?? '').toString().trim();
      const hasKeyword = kw.length > 0;

      // Build variables
      const variables = {
        limit: Number.isInteger(filters.limit) ? filters.limit : 10,
      };
      if (filters.fromDate) variables.fromDate = filters.fromDate;
      if (hasKeyword) variables.keyword = kw;

      // Build param string for the field
      const fieldParams = [];
      if (hasKeyword) fieldParams.push('keyword: $keyword');
      fieldParams.push('limit: $limit');
      if (filters.fromDate) fieldParams.push('fromDate: $fromDate');
      const paramString = fieldParams.length ? `(${fieldParams.join(', ')})` : '';

      // Build variable definitions for the operation
      const varDefs = [];
      if (hasKeyword) varDefs.push('$keyword: String');
      varDefs.push('$limit: Int');
      if (filters.fromDate) varDefs.push('$fromDate: DateTime');
      const varDefString = varDefs.length ? `(${varDefs.join(', ')})` : '';

      const graphqlQuery = `
        query SearchTranscripts${varDefString} {
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
          Authorization: `Bearer ${firefliesApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: graphqlQuery, variables }),
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

        // If invalid arg due to keyword, retry without keyword once
        const invalidArgs = data.errors.some(
          (e) =>
            (e.extensions && e.extensions.code === 'GRAPHQL_VALIDATION_FAILED') ||
            (e.code && String(e.code).toLowerCase().includes('invalid'))
        );
        if (invalidArgs && hasKeyword) {
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

  /**
   * Get a single transcript by ID.
   */
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
            meeting_attendees { email }
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
          Authorization: `Bearer ${firefliesApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: graphqlQuery,
          variables: { transcriptId },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('[DEBUG firefliesAPI.getTranscript] Error:', response.status, errorBody);
        return null;
      }

      const data = await response.json();
      return data.data?.transcript || null;
    } catch (error) {
      console.error('[DEBUG firefliesAPI.getTranscript] Exception:', error);
      return null;
    }
  },

  /**
   * Simple connectivity test.
   */
  async testConnection() {
    try {
      console.log(
        '[DEBUG firefliesAPI.testConnection] Testing with API key:',
        firefliesApiKey ? 'Present' : 'Missing'
      );

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${firefliesApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: `query { user { email name } }` }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('[DEBUG firefliesAPI.testConnection] Failed:', response.status, errorBody);
        return false;
      }

      const data = await response.json();
      console.log('[DEBUG firefliesAPI.testConnection] Success! User:', data.data?.user?.email);
      return true;
    } catch (error) {
      console.error('[DEBUG firefliesAPI.testConnection] Exception:', error);
      return false;
    }
  },
};

export default firefliesAPI;
