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
        const { userMessage, sessionId, useHeyGenVoice } = req.body;
        
        if (!userMessage || !sessionId) {
            return res.status(400).json({ error: 'Missing userMessage or sessionId' });
        }

        // Fetch environment variables
        const airtableApiKey = process.env.AIRTABLE_API_KEY;
        const openAIApiKey = process.env.OPENAI_API_KEY;
        const heygenApiKey = process.env.HEYGEN_API_KEY; // <-- Ensure this is set in your environment variables

        if (!airtableApiKey || !openAIApiKey || !heygenApiKey) {
            console.error('Missing API keys:', { 
                hasAirtableKey: !!airtableApiKey, 
                hasOpenAIKey: !!openAIApiKey,
                hasHeyGenKey: !!heygenApiKey 
            });
            return res.status(500).json({ error: 'Server configuration error' });
        }

        // Initialize system message and context for OpenAI
        let systemMessageContent = `You are a friendly, professional, and cheeky assistant specializing in AI & Automation.`;
        let conversationContext = '';
        let existingRecordId = null;

        // Fetch knowledge base from Airtable
        const knowledgeBaseTableName = 'Chat-KnowledgeBase';
        const airtableBaseId = 'appTYnw2qIaBIGRbR';
        const knowledgeBaseUrl = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(knowledgeBaseTableName)}`;
        const headersAirtable = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${airtableApiKey}`
        };

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
        const eagleViewChatTableName = 'EagleView_Chat';
        const eagleViewChatUrl = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(eagleViewChatTableName)}`;
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
        let aiReply;
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
            aiReply = openaiData.choices[0].message.content;
        } catch (error) {
            console.error('Error in OpenAI communication:', error);
            return res.status(500).json({ 
                error: 'Failed to communicate with OpenAI',
                details: error.message 
            });
        }

        // **Generate Voice Response Using HeyGen API**
        let heygenResponseUrl = null;
        if (useHeyGenVoice) {
            try {
                const heygenResponse = await fetch('https://api.heygen.com/v1/tts', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Key': heygenApiKey, // Updated header for HeyGen API
                    },
                    body: JSON.stringify({
                        text: aiReply,
                        voice_id: "en_us_001", // Replace with your desired voice ID
                    }),
                });

                if (!heygenResponse.ok) {
                    const errorText = await heygenResponse.text();
                    throw new Error(`HeyGen API error: ${errorText}`);
                }

                const heygenData = await heygenResponse.json();
                heygenResponseUrl = heygenData.data.url; // URL of the generated voice audio
            } catch (error) {
                console.error("Error with HeyGen API:", error);
            }
        }

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

        return res.json({ reply: aiReply, voiceUrl: heygenResponseUrl });
    } catch (error) {
        console.error('Error in handler:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
}
