/// lib/session.js
import { kv } from '@vercel/kv';

/**
 * Session management for maintaining project context across requests
 * Using Vercel KV as the single source of truth for session state
 */

const SESSION_TTL = 60 * 60 * 24; // 24 hours in seconds

/**
 * Get the KV key for a session
 */
function sessionKey(sessionId) {
  return `session:${sessionId}`;
}

/**
 * Load session context from KV
 * Returns null if no session exists
 */
export async function loadSessionContext(sessionId) {
  if (!sessionId) {
    console.warn('[session] No sessionId provided to loadSessionContext');
    return null;
  }
  
  try {
    const key = sessionKey(sessionId);
    const sessionData = await kv.get(key);
    
    if (sessionData) {
      console.log('[session] Loaded context for session:', sessionId, '- Project:', sessionData.projectName);
      return sessionData;
    }
    
    console.log('[session] No existing context for session:', sessionId);
    return null;
  } catch (error) {
    console.error('[session] Error loading session context:', error);
    return null;
  }
}

/**
 * Save session context to KV
 * This establishes or updates the project context for a session
 */
export async function saveSessionContext(sessionId, projectContext) {
  if (!sessionId) {
    console.warn('[session] No sessionId provided to saveSessionContext');
    return false;
  }
  
  if (!projectContext || !projectContext.projectName) {
    console.warn('[session] Invalid project context provided to saveSessionContext');
    return false;
  }
  
  try {
    const key = sessionKey(sessionId);
    const sessionData = {
      projectName: projectContext.projectName,
      partnershipData: projectContext.partnershipData,
      establishedAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString()
    };
    
    await kv.set(key, sessionData, { ex: SESSION_TTL });
    console.log('[session] Saved context for session:', sessionId, '- Project:', sessionData.projectName);
    return true;
  } catch (error) {
    console.error('[session] Error saving session context:', error);
    return false;
  }
}

/**
 * Update last accessed timestamp for session (extends TTL)
 */
export async function touchSession(sessionId) {
  if (!sessionId) return;
  
  try {
    const sessionData = await loadSessionContext(sessionId);
    if (sessionData) {
      sessionData.lastAccessedAt = new Date().toISOString();
      await kv.set(sessionKey(sessionId), sessionData, { ex: SESSION_TTL });
    }
  } catch (error) {
    console.error('[session] Error touching session:', error);
  }
}

/**
 * Detect if the user's message signals a new project
 * Returns null if this is a follow-up, or extracted project info if it's new
 */
export async function detectNewProject(userMessage, openAIApiKey) {
  // Strong signals that this is a NEW project
  const newProjectSignals = [
    /synopsis:\s*[""']?(.+?)[""']?$/i,
    /starring:\s*(.+?)(?:\n|$)/i,
    /production:\s*[""']?(.+?)[""']?$/i,
    /find brands for\s+[""']([^""']+)[""']/i,
    /project:\s*[""']?(.+?)[""']?$/i,
    // 👇 FIX: Better detection for new project initiation patterns
    /^(?:generate|create|find|get|suggest|quick match|brand integration).*for\s+(.+)$/i
  ];
  
  // Check for explicit new project signals
  for (const pattern of newProjectSignals) {
    if (pattern.test(userMessage)) {
      console.log('[session] Detected NEW project signal in message');
      
      // Extract project details using AI
      if (openAIApiKey) {
        try {
          const extractionPrompt = `Extract the project/production name and key details from this text. Return ONLY valid JSON.

Text: "${userMessage.substring(0, 1000)}"

Return format:
{
  "title": "extracted title or null",
  "synopsis": "plot/description or null",
  "genre": "genre or null",
  "cast": "cast names or null",
  "location": "location or null",
  "isNewProject": true or false
}

Set isNewProject to true ONLY if the message is introducing a NEW project (contains synopsis, starring, production details).
Set isNewProject to false if it's just asking about brands or a follow-up question.`;
          
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json', 
              Authorization: `Bearer ${openAIApiKey}` 
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'Extract structured data from text. Return only valid JSON.' },
                { role: 'user', content: extractionPrompt }
              ],
              temperature: 0.1,
              max_tokens: 200
            })
          });
          
          if (response.ok) {
            const data = await response.json();
            const extracted = JSON.parse(data.choices?.[0]?.message?.content || '{}');
            
            if (extracted.isNewProject && extracted.title) {
              console.log('[session] AI confirmed new project:', extracted.title);
              return extracted;
            }
          }
        } catch (e) {
          console.log('[session] AI extraction failed:', e.message);
        }
      }
      
      // Fallback: return basic info if AI fails
      return { 
        title: 'New Project',
        isNewProject: true 
      };
    }
  }
  
  // Follow-up signals (definitely NOT a new project)
  const followUpPatterns = [
    /^(how about|what about|also|and|more|try|show me|get me|find me)/i,
    /more brands/i,
    /additional brands/i,
    /other brands/i,
    /tech company|food brand|fashion brand/i
  ];
  
  if (followUpPatterns.some(pattern => pattern.test(userMessage.trim()))) {
    console.log('[session] Detected follow-up message (not a new project)');
    return null;
  }
  
  // Ambiguous - default to follow-up (safer)
  console.log('[session] Ambiguous message - treating as follow-up');
  return null;
}

/**
 * Clear session context (for explicit user reset)
 */
export async function clearSession(sessionId) {
  if (!sessionId) return;
  
  try {
    await kv.del(sessionKey(sessionId));
    console.log('[session] Cleared context for session:', sessionId);
  } catch (error) {
    console.error('[session] Error clearing session:', error);
  }
}
