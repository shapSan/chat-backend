// lib/config.js
import dotenv from 'dotenv';

dotenv.config();

// Vercel API route config (moved from original file)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

// API keys / credentials
export const airtableApiKey = process.env.AIRTABLE_API_KEY;
export const openAIApiKey = process.env.OPENAI_API_KEY;
export const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
export const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
export const runwayApiKey = process.env.RUNWAY_API_KEY;
export const googleGeminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;
export const msftTenantId = process.env.MICROSOFT_TENANT_ID;
export const msftClientId = process.env.MICROSOFT_CLIENT_ID;
export const msftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;

// Recommendation feature flags
export const RECS_FIX_MERGE = process.env.RECS_FIX_MERGE !== 'false';
export const RECS_COOLDOWN = process.env.RECS_COOLDOWN !== 'false';
export const RECS_DIVERSIFY = process.env.RECS_DIVERSIFY !== 'false';
export const RECS_JITTER_TARGET = process.env.RECS_JITTER_TARGET !== 'false';
export const RECS_DISCOVER_RATIO = process.env.RECS_DISCOVER_RATIO || '50,30,20';

// Centralized model configuration
export const MODELS = {
  openai: {
    chat: 'gpt-4o',
    chatMini: 'gpt-4o-mini',
    chatLegacy: 'gpt-3.5-turbo',
    image: 'gpt-image-1',
    realtime: 'gpt-4o-realtime-preview-2024-10-01'
  },
  anthropic: {
    claude: 'claude-3-5-sonnet-20241022'
  },
  elevenlabs: {
    voice: 'eleven_monolingual_v1'
  },
  runway: {
    default: 'gen3_alpha_turbo',
    turbo: 'gen4_turbo'
  }
};

// Project presets
export const PROJECT_CONFIGS = {
  default: {
    baseId: 'appTYnw2qIaBIGRbR',
    chatTable: 'EagleView_Chat',
    knowledgeTable: 'Chat-KnowledgeBase',
    voiceId: '21m00Tcm4TlvDq8ikWAM',
    voiceSettings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.5,
      use_speaker_boost: true
    }
  },
  'HB-PitchAssist': {
    baseId: 'apphslK7rslGb7Z8K',
    chatTable: 'Chat-Conversations',
    knowledgeTable: 'Chat-KnowledgeBase',
    voiceId: 'GFj1cj74yBDgwZqlLwgS',
    voiceSettings: {
      stability: 0.34,
      similarity_boost: 0.8,
      style: 0.5,
      use_speaker_boost: true
    }
  }
};

// Helper to fetch a project config safely
export function getProjectConfig(projectId) {
  const cfg = PROJECT_CONFIGS[projectId] || PROJECT_CONFIGS.default;
  return cfg;
}
