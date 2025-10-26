/// lib/session.js
import { kv } from '@vercel/kv';

/**
 * Helper to validate cast data
 */
function isValidCast(value) {
  return value && typeof value === 'string' && value.trim().length > 0;
}

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
    
    // CRITICAL FIX: Check if this is a different project than what's currently in session
    // If so, we need to clear the old data completely first
    const existingSession = await loadSessionContext(sessionId);
    if (existingSession && existingSession.projectName !== projectContext.projectName) {
      console.log('[session] Project changed from', existingSession.projectName, 'to', projectContext.projectName, '- clearing old session');
      // Clear the old session data completely
      await kv.del(key);
      // Small delay to ensure deletion is processed
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Start with a full copy using spread to preserve ALL fields
    let cleanPartnershipData = null;
    if (projectContext.partnershipData) {
      const data = projectContext.partnershipData;
      
      // Start with a full copy using spread - this preserves everything
      cleanPartnershipData = { ...data };
      
      // --- Now, ensure critical fields & apply necessary normalizations ---
      
      // Ensure ID is present (already copied by spread)
      cleanPartnershipData.id = data.id;
      
      // Handle Title/Name variations
      cleanPartnershipData.title = data.partnership_name || data.title || data.name || 'Untitled Project';
      cleanPartnershipData.name = cleanPartnershipData.title;
      cleanPartnershipData.partnership_name = cleanPartnershipData.title;
      
      // Handle Cast variations with validation
      const mainCastValue = data.main_cast;
      const castValue = data.cast;
      const validMainCast = isValidCast(mainCastValue) ? mainCastValue : null;
      const validCast = isValidCast(castValue) ? castValue : null;
      const selectedCast = validMainCast || validCast;
      cleanPartnershipData.main_cast = selectedCast;
      cleanPartnershipData.cast = selectedCast;
      
      // Ensure other key normalized fields exist (most are covered by spread)
      cleanPartnershipData.distributor = data.distributor || data.studio || data.distribution_partner || null;
      cleanPartnershipData.location = data.shoot_location__city_ || data.storyline_location__city_ || data.plot_location || data.location || null;
      cleanPartnershipData.genre_production = data.genre_production || data.vibe || data.genre || null;
      cleanPartnershipData.vibe = cleanPartnershipData.genre_production;
      cleanPartnershipData.releaseDate = data.releaseDate || data.release__est__date || data.release_est_date || null;
      cleanPartnershipData.productionStartDate = data.productionStartDate || data.startDate || data.start_date || data.production_start_date || null;
      
      // Keep null/undefined fields - let consumers handle missing data
      // Don't delete them as they indicate data was checked
    }
    
    const sessionData = {
      projectName: projectContext.projectName,
      partnershipData: cleanPartnershipData,
      establishedAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      // Add a version flag to track session data structure
      version: 2
    };
    
    await kv.set(key, sessionData, { ex: SESSION_TTL });
    console.log('[session] Saved clean context for session:', sessionId, '- Project:', sessionData.projectName);
    
    // Debug log to verify cast data
    if (cleanPartnershipData?.main_cast) {
      console.log('[session] Cast saved for', projectContext.projectName, ':', cleanPartnershipData.main_cast.substring(0, 50) + '...');
    } else {
      console.log('[session] No cast data for project:', projectContext.projectName);
    }
    
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
    /^(?:generate|create|find|get|suggest|quick match|brand integration).*for\s+(.+)$/i,
    // Additional patterns for common variations
    /^brands?\s+for\s+[""']?([^""']+)[""']?/i,  // "Brands for Laura Louise"
    /^[""']?([^""']+)[""']?\s+brands?$/i,  // "Laura Louise brands"
    /^search\s+(?:brands?|companies)\s+for\s+(.+)$/i,  // "Search brands for X"
    // Panel-initiated patterns
    /^Quick Match for\s+(.+)$/i,  // Quick Match button
    /^Generate brand integration suggestions for\s+(.+)$/i  // Full Match button
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
  "location": "location or null",
  "isNewProject": true or false
}

Set isNewProject to true ONLY if the message is introducing a NEW project (contains synopsis, starring, production details).
Set isNewProject to false if it's just asking about brands or a follow-up question.
DO NOT extract cast information - we only use verified cast data from our database.`;
          
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json', 
              Authorization: `Bearer ${openAIApiKey}` 
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'Extract structured data from text. Return only valid JSON. NEVER extract cast information.' },
                { role: 'user', content: extractionPrompt }
              ],
              temperature: 0.1,
              max_tokens: 200
            })
          });
          
          if (response.ok) {
            const data = await response.json();
            const extracted = JSON.parse(data.choices?.[0]?.message?.content || '{}');
            // CRITICAL: Remove any cast field that might have been extracted
            delete extracted.cast;
            
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
