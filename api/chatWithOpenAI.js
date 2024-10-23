// api/chatWithOpenAI.js
import { NextResponse } from 'next/server';
require('dotenv').config();
const fetch = require('node-fetch');

function getCurrentTimeInPDT() {
    const timeZone = 'America/Los_Angeles';
    return new Intl.DateTimeFormat('en-US', { 
        timeZone, 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: 'numeric', 
        second: 'numeric', 
        timeZoneName: 'short' 
    }).format(new Date());
}

function getTimeInTimeZone(timeZone) {
    return new Intl.DateTimeFormat('en-US', { 
        timeZone, 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: 'numeric', 
        second: 'numeric', 
        timeZoneName: 'short' 
    }).format(new Date());
}

export default async function handler(req, res) {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { userMessage, sessionId } = req.body;
        
        if (!userMessage || !sessionId) {
            return res.status(400).json({ error: 'Missing userMessage or sessionId' });
        }

        // Handle time queries first
        const lowerMessage = userMessage.toLowerCase();
        if (lowerMessage.includes('what time is it') || lowerMessage.includes('current time')) {
            if (!lowerMessage.includes('in')) {
                const currentTimePDT = getCurrentTimeInPDT();
                return res.json({ reply: `The current time in PDT is: ${currentTimePDT}` });
            }
            // Rest of time handling code...
        }

        // Get API keys from environment variables
        const airtableApiKey = process.env.AIRTABLE_API_KEY;
        const openAIApiKey = process.env.OPENAI_API_KEY;
        const airtableBaseId = 'appTYnw2qIaBIGRbR';

        if (!airtableApiKey || !openAIApiKey) {
            console.error('Missing API keys:', { 
                hasAirtableKey: !!airtableApiKey, 
                hasOpenAIKey: !!openAIApiKey 
            });
            return res.status(500).json({ error: 'Server configuration error' });
        }

        // Set up Airtable endpoints
        const knowledgeBaseTableName = 'Chat-KnowledgeBase';
        const eagleViewChatTableName = 'EagleView_Chat';
        const knowledgeBaseUrl = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(knowledgeBaseTableName)}`;
        const eagleViewChatUrl = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(eagleViewChatTableName)}`;

        const headersAirtable = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${airtableApiKey}`
        };

        // Initialize system message
        let systemMessageContent = `You are a friendly, professional, and cheeky assistant specializing in AI & Automation.`;
        let conversationContext = '';

        // Fetch knowledge base from Airtable
        try {
            const kbResponse = await fetch(knowledgeBaseUrl, { headers: headersAirtable });
            if (!kbResponse.ok) throw new Error('Failed to fetch knowledge base');
            
            const knowledgeBaseData = await kbResponse.json();
            
            if (knowledgeBaseData.records && knowledgeBaseData.records.length > 0) {
                const knowledgeEntries = knowledgeBaseData.records
                    .map(record => record.fields.Summary)
                    .join('\n\n');
                systemMessageContent += ` You have the following knowledge available to assist: "${knowledgeEntries}".`;
            }
        } catch (error) {
            console.error('Error fetching knowledge base:', error);
        }

        // Fetch conversation history from Airtable
        let existingRecordId = null;
        try {
            const searchUrl = `${eagleViewChatUrl}?filterByFormula=SessionID="${sessionId}"`;
            const historyResponse = await fetch(searchUrl, { headers: headersAirtable });
            if (!historyResponse.ok) throw new Error('Failed to fetch conversation history');
            
            const result = await historyResponse.json();
            
            if (result.records && result.records.length > 0) {
                conversationContext = result.records[0].fields.Conversation || '';
                existingRecordId = result.records[0].id;
                systemMessageContent += ` Here's the conversation so far: "${conversationContext}".`;
            }
        } catch (error) {
            console.error('Error fetching conversation history:', error);
        }

        // Add current time to context
        const currentTimePDT = getCurrentTimeInPDT();
        systemMessageContent += ` The current time in PDT is ${currentTimePDT}.`;

        // Call OpenAI API
        try {
            const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openAIApiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4',
                    messages: [
                        { role: 'system', content: systemMessageContent },
                        { role: 'user', content: userMessage }
                    ],
                    max_tokens: 500
                })
            });

            if (!openaiResponse.ok) {
                const errorText = await openaiResponse.text();
                throw new Error(`OpenAI API error: ${errorText}`);
            }

            const openaiData = await openaiResponse.json();
            const aiReply = openaiData.choices[0].message.content;

            // Update conversation in Airtable
            const updatedConversation = `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`;

            try {
                if (existingRecordId) {
                    // Update existing conversation
                    await fetch(`${eagleViewChatUrl}/${existingRecordId}`, {
                        method: 'PATCH',
                        headers: headersAirtable,
                        body: JSON.stringify({
                            fields: {
                                Conversation: updatedConversation
                            }
                        })
                    });
                } else {
                    // Create new conversation record
                    await fetch(eagleViewChatUrl, {
                        method: 'POST',
                        headers: headersAirtable,
                        body: JSON.stringify({
                            fields: {
                                SessionID: sessionId,
                                Conversation: updatedConversation
                            }
                        })
                    });
                }
            } catch (error) {
                console.error('Error updating Airtable conversation:', error);
            }

            return res.json({ reply: aiReply });

        } catch (error) {
            console.error('Error in OpenAI communication:', error);
            return res.status(500).json({ 
                error: 'Failed to communicate with OpenAI',
                details: error.message 
            });
        }

    } catch (error) {
        console.error('Error in handler:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
}
