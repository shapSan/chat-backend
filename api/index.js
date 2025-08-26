// api/index.js
import fetch from 'node-fetch';
import WebSocket from 'ws';
import { kv } from '@vercel/kv';
import { put } from '@vercel/blob';

import {
  config as apiRouteConfig,
  airtableApiKey,
  openAIApiKey,
  googleGeminiApiKey,
  runwayApiKey,
  MODELS,
  getProjectConfig,
} from '../lib/config.js';
export { apiRouteConfig as config }; // re-export API route config

import {
  o365API,
  getTextResponseFromOpenAI,
  getTextResponseFromClaude,
  generateOpenAIImage,
  generateElevenLabsAudio,
  generateRunwayVideo,
  generateVeo3Video,
} from '../lib/services.js';

import {
  handleClaudeSearch,
  progressInit,
  progressPush,
  progressDone,
  extractLastProduction,
  updateAirtableConversation,
  getCurrentTimeInPDT,
  progKey,
} from '../lib/core.js';

export default async function handler(req, res) {
  // CORS - Properly handle credentials
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    // Same-origin or CLI calls
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'false');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /progress
  if (req.method === 'GET' && req.query.progress === 'true') {
    res.setHeader('Cache-Control', 'no-store');
    const { sessionId, runId } = req.query;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    const key = progKey(sessionId, runId);
    const s = (await kv.get(key)) || { steps: [], done: false, runId: runId || null };
    if (runId && s.runId !== runId) return res.status(200).json({ steps: [], done: false, runId });
    return res.status(200).json(s);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST', 'GET', 'OPTIONS']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Common + progress setup
    let { userMessage, sessionId, audioData, projectId, knownProjectName, runId: clientRunId } = req.body;
    const runId = clientRunId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    res.setHeader('x-run-id', runId);
    res.setHeader('Cache-Control', 'no-store');

    if (userMessage && userMessage.length > 5000) userMessage = userMessage.slice(0, 5000) + '…';
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
    if (!userMessage && !audioData && !req.body.pushDraft && !req.body.generateImage && !req.body.generateAudio && !req.body.generateVideo) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await progressInit(sessionId, runId);
    await progressPush(sessionId, runId, { type: 'info', text: '🔎 Routing request...', runId });

    // Airtable endpoints used by several branches
    const { baseId, chatTable, knowledgeTable } = getProjectConfig(projectId);
    const knowledgeBaseUrl = `https://api.airtable.com/v0/${baseId}/${knowledgeTable}`;
    const chatUrl = `https://api.airtable.com/v0/${baseId}/${chatTable}`;
    const headersAirtable = { 'Content-Type': 'application/json', Authorization: `Bearer ${airtableApiKey}` };

    // Helper: load KB + conversation context once if we need it
    const loadContext = async () => {
      let kb = '';
      try {
        const kbResp = await fetch(knowledgeBaseUrl, { headers: headersAirtable });
        if (kbResp.ok) {
          const data = await kbResp.json();
          kb = data.records
            .map((r) => r.fields?.Summary)
            .filter(Boolean)
            .join('\n\n');
        }
      } catch {}
      let conversationContext = '';
      let existingRecordId = null;
      try {
        const searchUrl = `${chatUrl}?filterByFormula=AND(SessionID="${sessionId}",ProjectID="${projectId || 'default'}")`;
        const historyResponse = await fetch(searchUrl, { headers: headersAirtable });
        if (historyResponse.ok) {
          const result = await historyResponse.json();
          if (result.records.length > 0) {
            conversationContext = result.records[0].fields.Conversation || '';
            existingRecordId = result.records[0].id;
            if (conversationContext.length > 3000) conversationContext = conversationContext.slice(-3000);
          }
        }
      } catch {}
      return { kb, conversationContext, existingRecordId };
    };

    /* =========================
     * PUSH DRAFT
     * ======================= */
    if (req.body.pushDraft === true) {
      const { productionData, brands } = req.body;
      if (!productionData || !brands || brands.length === 0) {
        return res.status(400).json({ error: 'Missing required fields', details: 'productionData and brands array are required' });
      }

      if (!openAIApiKey) {
        return res.status(500).json({ error: 'Push feature not configured', details: 'Missing OpenAI credentials' });
      }

      try {
        const emailPrompt = `You are Shap, a brand partnership executive at Hollywood Branded. Write a PERSONAL, conversational email to yourself (as a draft) summarizing brand recommendations for a production.

Production Details:
- Title: ${productionData.knownProjectName || 'Untitled Production'}
- Vibe/Genre: ${productionData.vibe || 'Not specified'}
- Cast: ${productionData.cast || 'TBD'}
- Location: ${productionData.location || 'TBD'}
- Notes: ${productionData.notes || 'None'}

Selected Brands for Consideration (${brands.length} total):
${brands
  .map(
    (brand, i) => `
${i + 1}. ${brand.name}
    - Why it works: ${brand.whyItWorks || brand.reason || 'It aligns with the project goals.'}
    - Integration Idea: ${brand.integrationIdeas?.[0] || brand.integrationIdea || 'Strategic product placement.'}
    - HB Insights: ${brand.hbInsights || 'This brand shows strong potential for partnership.'}
    ${brand.tags ? `- Tags: ${Array.isArray(brand.tags) ? brand.tags.join(', ') : brand.tags}` : ''}`
  )
  .join('\n')}

Write a draft email to yourself that:
1. Opens with a brief, personal reminder about this production (1-2 sentences)
2. Lists the brands with quick notes on why each could work
3. Includes any action items or next steps
4. Keeps a casual, note-to-self tone (this is YOUR draft folder)
5. Signs off as "- Shap" or similar

Format as HTML with simple formatting (use <br> for line breaks, <b> for emphasis, <ul>/<li> for lists).
Keep it under 300 words.

CRITICAL: Your entire response must be raw, valid HTML. Do NOT wrap it in markdown code fences (```) under any circumstances.`;

        const emailBody = await getTextResponseFromOpenAI(
          emailPrompt,
          sessionId,
          'You are Shap, writing a draft email to yourself about brand partnerships. Keep it personal and conversational.'
        );

        const subject = `Brand Recs: ${productionData.knownProjectName || 'Untitled Production'} (${brands.length} brands)`;
        const draft = await o365API.createDraft(subject, emailBody, 'shap@hollywoodbranded.com', {
          senderEmail: 'shap@hollywoodbranded.com',
          isHtml: true,
        });

        await progressDone(sessionId, runId);
        return res.status(200).json({
          success: true,
          draftId: draft.id,
          webLink: draft.webLink,
          webLinks: [draft.webLink],
          message: 'Draft created successfully in Outlook',
        });
      } catch (e) {
        await progressDone(sessionId, runId);
        return res.status(500).json({ error: 'Failed to create draft', details: e.message });
      }
    }

    /* =========================
     * GENERATE AUDIO
     * ======================= */
    if (req.body.generateAudio === true) {
      const { prompt } = req.body;
      if (!prompt) return res.status(400).json({ error: 'Missing required fields', details: 'prompt is required' });
      const { voiceId, voiceSettings } = getProjectConfig(projectId);
      try {
        const result = await generateElevenLabsAudio({ prompt, voiceId, voiceSettings, sessionId });
        await progressDone(sessionId, runId);
        return res.status(200).json(result);
      } catch (e) {
        await progressDone(sessionId, runId);
        return res.status(500).json({ error: 'Failed to generate audio', details: e.message });
      }
    }

    /* =========================
     * GENERATE IMAGE
     * ======================= */
    if (req.body.generateImage === true) {
      const { prompt, dimensions } = req.body;
      if (!prompt) return res.status(400).json({ error: 'Missing required fields', details: 'prompt is required' });

      try {
        const { conversationContext } = await loadContext();
        const lastProductionContext = extractLastProduction(conversationContext);
        const enhancedPrompt = lastProductionContext ? `Continue working on this production: ${lastProductionContext}\n\n${prompt}` : prompt;

        const result = await generateOpenAIImage({ prompt, sessionId, enhancedPrompt, dimensions });
        await progressDone(sessionId, runId);
        return res.status(200).json(result);
      } catch (e) {
        await progressDone(sessionId, runId);
        return res.status(500).json({ error: 'Failed to generate image', details: e.message });
      }
    }

    /* =========================
     * GENERATE VIDEO
     * ======================= */
    if (req.body.generateVideo === true) {
      const { promptText, promptImage, model, ratio, duration, videoModel } = req.body;
      if (!promptText) return res.status(400).json({ error: 'Missing required fields', details: 'promptText is required' });

      try {
        const { conversationContext } = await loadContext();
        const lastProductionContext = extractLastProduction(conversationContext);
        const enhancedPromptText = lastProductionContext
          ? `Continue working on this production: ${lastProductionContext}\n\n${promptText}`
          : promptText;

        let result;
        if (videoModel === 'veo3') {
          if (!googleGeminiApiKey) {
            return res
              .status(500)
              .json({ error: 'Veo3 video generation service not configured', details: 'Please configure GOOGLE_GEMINI_API_KEY' });
          }
          let ar = '16:9';
          if (ratio === '1104:832') ar = '4:3';
          else if (ratio === '832:1104') ar = '9:16';
          else if (ratio === '1920:1080') ar = '16:9';

          result = await generateVeo3Video({ promptText: enhancedPromptText, aspectRatio: ar, duration });
        } else {
          if (!runwayApiKey) {
            return res
              .status(500)
              .json({ error: 'Runway video generation service not configured', details: 'Please configure RUNWAY_API_KEY' });
          }
          if (promptImage && !promptImage.startsWith('http') && !promptImage.startsWith('data:')) {
            return res.status(400).json({ error: 'Invalid image format', details: 'promptImage must be a valid URL or base64 data URL' });
          }
          let imageToUse = promptImage;
          if (!imageToUse || imageToUse.includes('dummyimage.com')) {
            imageToUse =
              'https://images.unsplash.com/photo-1497215842964-222b430dc094?w=1280&h=720&fit=crop';
          }
          result = await generateRunwayVideo({
            promptText: enhancedPromptText,
            promptImage: imageToUse,
            model: model || MODELS.runway.turbo,
            ratio: ratio || '1104:832',
            duration: duration || 5,
          });
        }

        // Upload generated video to blob storage
        const tempFetch = await fetch(result.url);
        if (!tempFetch.ok) throw new Error(`Failed to fetch video from temporary URL: ${tempFetch.status}`);
        const videoBuffer = await tempFetch.buffer();

        const filename = `${sessionId || 'unknown-session'}/video-generated-${Date.now()}.mp4`;
        const { url: permanentUrl } = await put(filename, videoBuffer, { access: 'public', contentType: 'video/mp4' });

        await progressDone(sessionId, runId);
        return res.status(200).json({
          success: true,
          videoUrl: permanentUrl,
          taskId: result.taskId,
          model: videoModel || 'runway',
          metadata: result.metadata,
          storage: 'blob',
        });
      } catch (e) {
        await progressDone(sessionId, runId);
        return res.status(500).json({ error: 'Failed to generate video', details: e.message });
      }
    }

    /* =========================
     * AUDIO (Realtime WebSocket) — stays here
     * ======================= */
    if (audioData) {
      try {
        const { kb: knowledgeBaseInstructions, conversationContext, existingRecordId } = await loadContext();

        const audioBuffer = Buffer.from(audioData, 'base64');
        const openaiWsUrl = `wss://api.openai.com/v1/realtime?model=${MODELS.openai.realtime}`;

        const openaiWs = new WebSocket(openaiWsUrl, {
          headers: {
            Authorization: `Bearer ${openAIApiKey}`,
            'OpenAI-Beta': 'realtime=v1',
          },
        });

        let systemMessageContent = knowledgeBaseInstructions || 'You are a helpful assistant specialized in AI & Automation.';
        if (conversationContext) systemMessageContent += `\n\nConversation history: ${conversationContext}`;
        systemMessageContent += `\n\nCurrent time in PDT: ${getCurrentTimeInPDT()}.`;
        if (projectId && projectId !== 'default') systemMessageContent += ` You are assisting with the ${projectId} project.`;

        openaiWs.on('open', () => {
          openaiWs.send(JSON.stringify({ type: 'session.update', session: { instructions: systemMessageContent } }));
          openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: audioBuffer.toString('base64') }));
          openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
          openaiWs.send(JSON.stringify({ type: 'response.create', response: { modalities: ['text'], instructions: 'Please respond to the user.' } }));
        });

        openaiWs.on('message', async (message) => {
          const event = JSON.parse(message);
          if (event.type === 'conversation.item.created' && event.item.role === 'assistant') {
            const aiReply = event.item.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
            if (aiReply) {
              updateAirtableConversation(
                sessionId,
                projectId,
                chatUrl,
                headersAirtable,
                `${conversationContext}\nUser: [Voice Message]\nAI: ${aiReply}`,
                existingRecordId
              ).catch(() => {});
              await progressDone(sessionId, runId);
              res.json({ reply: aiReply, mcpThinking: null, usedMCP: false });
            } else {
              await progressDone(sessionId, runId);
              res.status(500).json({ error: 'No valid reply received from OpenAI.' });
            }
            openaiWs.close();
          }
        });

        openaiWs.on('error', async () => {
          await progressDone(sessionId, runId);
          res.status(500).json({ error: 'Failed to communicate with OpenAI' });
        });

        openaiWs.on('close', async () => {
          await progressDone(sessionId, runId);
        });
        return; // keep connection flow
      } catch (error) {
        await progressDone(sessionId, runId);
        return res.status(500).json({ error: 'Error processing audio data.', details: error.message });
      }
    }

    /* =========================
     * TEXT USER MESSAGE
     * ======================= */
    if (userMessage) {
      try {
        const mcpStartTime = Date.now();
        let mcpSteps = [];
        let usedMCP = false;
        let structuredData = null;

        const { kb: knowledgeBaseInstructions, conversationContext, existingRecordId } = await loadContext();
        const lastProductionContext = extractLastProduction(conversationContext);

        const claudeResult = await handleClaudeSearch(
          userMessage,
          projectId,
          conversationContext,
          lastProductionContext,
          knownProjectName,
          runId,
          (step) => progressPush(sessionId, runId, step)
        );

        let aiReply = '';
        if (claudeResult) {
          usedMCP = true;
          mcpSteps = (claudeResult.mcpThinking || []).map((step) => ({ ...step, timestamp: Date.now() - mcpStartTime }));
          structuredData = claudeResult.organizedData;

          let systemMessageContent =
            knowledgeBaseInstructions || `You are an expert assistant specialized in brand integration for Hollywood entertainment.`;

          if (structuredData.dataType === 'BRAND_ACTIVITY') {
            const total = structuredData.communications?.length || 0;
            const meetings = structuredData.communications?.filter((c) => c.type === 'meeting').length || 0;
            const emails = structuredData.communications?.filter((c) => c.type === 'email').length || 0;

            systemMessageContent += `
You have retrieved activity data for a brand. Format your response EXACTLY as follows:

**ABSOLUTE REQUIREMENT: Display ALL ${total} items from the communications array**

The data contains:
- ${meetings} meetings
- ${emails} emails
- Total: ${total} items

Formatting:
1) Start with "Based on the search results, here's the activity summary for [Brand Name]:"
2) List ALL ${total} items in order, numbered 1..${total}
3) Meetings: "[MEETING url='url_if_exists'] Title - Date" or "[MEETING] Title - Date"
   Emails: "[EMAIL] Subject - Date"
4) Include bullet points for details under each item.`;

            systemMessageContent += `\n\n\`\`\`json\n${JSON.stringify(structuredData, null, 2)}\n\`\`\``;
          } else {
            systemMessageContent += `
A search has been performed and the structured results are below in JSON. Synthesize into a helpful summary. If empty, say you couldn't find matches. Make links clickable in markdown.
\`\`\`json
${JSON.stringify(structuredData, null, 2)}
\`\`\`
`;
          }

          aiReply = await getTextResponseFromClaude(userMessage, sessionId, systemMessageContent);
        } else {
          // no tool path → general chat
          let systemMessageContent =
            knowledgeBaseInstructions || 'You are a helpful assistant specialized in brand integration into Hollywood entertainment.';
          if (conversationContext) systemMessageContent += `\n\nConversation history: ${conversationContext}`;
          aiReply = await getTextResponseFromClaude(userMessage, sessionId, systemMessageContent);
        }

        if (!aiReply) {
          await progressDone(sessionId, runId);
          return res.status(500).json({ error: 'No text reply received.' });
        }

        updateAirtableConversation(
          sessionId,
          projectId,
          chatUrl,
          headersAirtable,
          `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`,
          existingRecordId
        ).catch(() => {});

        await progressDone(sessionId, runId);
        return res.json({
          runId,
          reply: aiReply,
          structuredData,
          mcpSteps,
          usedMCP,
          breakdown: claudeResult?.breakdown || null,
          activityMetadata:
            structuredData?.dataType === 'BRAND_ACTIVITY'
              ? {
                  totalCommunications: structuredData.communications?.length || 0,
                  meetingCount: structuredData.communications?.filter((c) => c.type === 'meeting').length || 0,
                  emailCount: structuredData.communications?.filter((c) => c.type === 'email').length || 0,
                  communications: structuredData.communications,
                }
              : null,
        });
      } catch (error) {
        await progressDone(sessionId, runId);
        return res.status(500).json({
          error: 'Internal server error',
          details: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        });
      }
    }

    // Fallback (shouldn't reach here)
    await progressDone(sessionId, runId);
    return res.status(400).json({ error: 'Bad Request' });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
