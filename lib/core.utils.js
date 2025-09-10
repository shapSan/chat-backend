// lib/core.utils.js (extracted exported helpers)
import { kv } from '@vercel/kv';

// Stable key derivation (unchanged)
export const progKey = (sessionId, runId) =>
  runId ? `progress:${sessionId}:${runId}` : `mcp:${sessionId}`;

// Shape-agnostic read -> returns { meta, steps[] }
async function readProgressState(key, defaults) {
  const state = await kv.get(key);
  if (state == null) return { meta: { startedAt: Date.now(), ...defaults }, steps: [] };

  // Old format A: plain array of steps
  if (Array.isArray(state)) return { meta: { startedAt: Date.now(), ...defaults }, steps: state };

  // Old/New format B: { meta, steps }
  if (state && Array.isArray(state.steps)) {
    return { meta: { ...(state.meta || {}), ...defaults }, steps: state.steps };
  }

  // Fallback: unknown type -> wrap as steps
  return { meta: { startedAt: Date.now(), ...defaults }, steps: [state] };
}

async function writeProgressState(key, meta, steps, ttlSec = 60 * 60 * 24) {
  // Include runId at the root level for backward compatibility
  const payload = { meta, steps, runId: meta.runId || null };
  await kv.set(key, payload, { ex: ttlSec });

  // Optional: publish incremental updates if Pub/Sub is enabled
  try {
    await kv.publish?.(`${key}:events`, JSON.stringify(steps[steps.length - 1]));
  } catch {}
}

export async function updateAirtableConversation(
  sessionId,
  projectId,
  chatUrl,
  headersAirtable,
  updatedConversation,
  existingRecordId,
  projectName = null
) {
  try {
    let conversationToSave = updatedConversation;
    
    // Add project marker if we have a project name
    if (projectName) {
      // Add marker for easier extraction later
      conversationToSave = `[PRODUCTION:${projectName}]\n${conversationToSave}`;
    }
    
    if (conversationToSave.length > 10000) {
      conversationToSave = '...' + conversationToSave.slice(-10000);
    }
    const recordData = {
      fields: {
        SessionID: sessionId,
        ProjectID: projectId || 'default',
        Conversation: conversationToSave,
      },
    };
    if (existingRecordId) {
      await fetch(`${chatUrl}/${existingRecordId}`, {
        method: 'PATCH',
        headers: headersAirtable,
        body: JSON.stringify({ fields: recordData.fields }),
      });
    } else {
      await fetch(chatUrl, {
        method: 'POST',
        headers: headersAirtable,
        body: JSON.stringify(recordData),
      });
    }
  } catch (error) {
    console.error('[updateAirtableConversation] error:', error?.message);
  }
}

export function extractLastProduction(conversation) {
  if (!conversation) return null;
  const patterns = [
    /Synopsis:([\s\S]+?)(?=\nUser:|\nAI:|$)/gi,
    /Production:([\s\S]+?)(?=\nUser:|\nAI:|$)/gi,
    /(?:movie|film|show|series|production)[\s\S]{0,500}?(?:starring|featuring|about|follows)[\s\S]+?(?=\nUser:|\nAI:|$)/gi,
  ];
  let lastProduction = null;
  for (const pattern of patterns) {
    const matches = conversation.match(pattern);
    if (matches && matches.length > 0) {
      lastProduction = matches[matches.length - 1];
      break;
    }
  }
  if (lastProduction) {
    lastProduction = lastProduction.replace(/^(Synopsis:|Production:)\s*/i, '').trim();
  }
  return lastProduction;
}

export function extractGenreFromSynopsis(synopsis) {
  if (!synopsis) return null;
  const genrePatterns = {
    action: /\b(action|fight|chase|explosion|battle|war|combat|hero|villain)\b/i,
    comedy: /\b(comedy|funny|humor|hilarious|laugh|sitcom|comedic)\b/i,
    drama: /\b(drama|emotional|family|relationship|struggle|journey)\b/i,
    horror: /\b(horror|scary|terror|thriller|suspense|supernatural)\b/i,
    documentary: /\b(documentary|docu|non-fiction|true story|real|factual)\b/i,
    sports: /\b(sports|athletic|fitness|game|match|competition|championship)\b/i,
    scifi: /\b(sci-fi|science fiction|future|space|alien|technology|dystopian)\b/i,
    romance: /\b(romance|love|romantic|relationship|dating)\b/i,
    crime: /\b(crime|detective|investigation|murder|police|criminal)\b/i,
  };
  for (const [genre, pattern] of Object.entries(genrePatterns)) {
    if (pattern.test(synopsis)) return genre;
  }
  return 'general';
}

export async function getConversationHistory(sessionId, projectId, chatUrl, headersAirtable) {
  try {
    const searchUrl = `${chatUrl}?filterByFormula=AND(SessionID="${sessionId}",ProjectID="${
      projectId || 'default'
    }")`;
    const historyResponse = await fetch(searchUrl, { headers: headersAirtable });
    if (historyResponse.ok) {
      const result = await historyResponse.json();
      if (result.records.length > 0) {
        return result.records[0].fields.Conversation || '';
      }
    }
  } catch (error) {
    console.error('Error fetching conversation history:', error);
  }
  return '';
}

export function shouldUseSearch(userMessage) {
  const searchKeywords = [
    'brand',
    'production',
    'show',
    'movie',
    'series',
    'find',
    'search',
    'recommend',
    'suggestion',
    'partner',
  ];
  const messageLower = userMessage.toLowerCase();
  return searchKeywords.some((k) => messageLower.includes(k));
}

/** Progress tracking functions with backward compatibility */
export async function progressInit(sessionId, runId, meta = {}) {
  const key = progKey(sessionId, runId);
  const state = await readProgressState(key, { sessionId, runId });
  const nextMeta = { ...state.meta, ...meta, sessionId, runId, startedAt: state.meta.startedAt || Date.now() };
  await writeProgressState(key, nextMeta, [], 60 * 60 * 24);
}

export async function progressPush(sessionId, runId, step) {
  console.log('[progressPush] Called with sessionId:', sessionId, 'runId:', runId, 'step:', step);
  const key = progKey(sessionId, runId);
  console.log('[progressPush] Using key:', key);
  const state = await readProgressState(key, { sessionId, runId });
  const payload = { ts: Date.now(), ...step };
  const nextSteps = state.steps.concat(payload);
  console.log('[progressPush] Writing', nextSteps.length, 'steps to KV');
  await writeProgressState(key, state.meta, nextSteps, 60 * 60 * 24);
}

export async function progressDone(sessionId, runId, meta = {}) {
  const key = progKey(sessionId, runId);
  const state = await readProgressState(key, { sessionId, runId });
  const doneStep = { ts: Date.now(), type: 'done' };
  const nextSteps = state.steps.concat(doneStep);
  const nextMeta = { ...state.meta, ...meta, finishedAt: Date.now() };
  await writeProgressState(key, nextMeta, nextSteps, 60 * 60 * 24);
}

/**
 * Robustly parse JSON from LLM output:
 * - supports raw JSON
 * - supports ```json ... ``` fenced blocks
 * - trims junk before/after outer braces
 * - returns null on failure
 */
export function extractJson(input) {
  if (!input) return null;
  if (typeof input === 'object') return input;

  let text = String(input).trim();

  // 1) Code fence: ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch {}
  }

  // 2) Outer-most braces heuristic
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    const slice = text.slice(first, last + 1);
    try { return JSON.parse(slice); } catch {}
  }

  // 3) Direct parse
  try { return JSON.parse(text); } catch {}
  return null;
}
