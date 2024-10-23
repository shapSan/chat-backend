// api/chatWithOpenAI.js

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

module.exports = async (req, res) => {
    // Set CORS headers
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
            return res.status(400).json({ error: 'Missing userMessage or sessionId in request body.' });
        }

        const lowerMessage = userMessage.toLowerCase();

        // Handle time-related queries
        if (lowerMessage.includes('what time is it') || lowerMessage.includes('current time')) {
            if (!lowerMessage.includes('in')) {
                const currentTimePDT = getCurrentTimeInPDT();
                return res.json({ reply: `The current time in PDT is: ${currentTimePDT}` });
            }

            const match = lowerMessage.match(/in (\w+)/);
            if (match) {
                const location = match[1].toLowerCase();
                let timeZone;
                switch (location) {
                    case 'new york': timeZone = 'America/New_York'; break;
                    case 'tokyo': timeZone = 'Asia/Tokyo'; break;
                    case 'london': timeZone = 'Europe/London'; break;
                    case 'paris': timeZone = 'Europe/Paris'; break;
                    default:
                        return res.json({ reply: `Sorry, I don't know the time zone for ${location}. Please try another location.` });
                }
                const timeInLocation = getTimeInTimeZone(timeZone);
                return res.json({ reply: `The current time in ${location.charAt(0).toUpperCase() + location.slice(1)} is: ${timeInLocation}` });
            }
        }

        const airtableApiKey = process.env.AIRTABLE_API_KEY;
        const openAIApiKey = process.env.OPENAI_API_KEY;
        const airtableBaseId = process.env.AIRTABLE_BASE_
        const airtableBaseId = process.env.AIRTABLE_BASE_ID || 'appTYnw2qIaBIGRbR';

        if (!airtableApiKey || !openAIApiKey) {
            return res.status(500).json({ 
                error: 'Missing API keys. Please check your environment variables.' 
            });
        }

        const knowledgeBaseTableName = 'Chat-KnowledgeBase';
        const eagleViewChatTableName = 'EagleView_Chat';
        const knowledgeBaseUrl = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(knowledgeBaseTableName)}`;
        const eagleViewChatUrl = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(eagleViewChatTableName)}`;

        const headersAirtable = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${airtableApiKey}`
        };

        let systemMessageContent = "You are a friendly, professional, and cheeky assistant specializing in AI & Automation.";
        let conversationContext = '';

        // Fetch knowledge base
        try {
            const response = await fetch(knowledgeBaseUrl, { headers: headersAirtable });
            const knowledgeBaseData = await response.json();

            if (knowledgeBaseData.records?.length > 0) {
                const knowledgeEntries = knowledgeBaseData.records
                    .map(record => record.fields.Summary)
                    .join('\n\n');
                systemMessageContent += ` You have the following knowledge available to assist: "${knowledgeEntries}".`;
            }
        } catch (error) {
            console.error('Error fetching knowledge base:', error);
        }

        // Fetch conversation history
        let existingRecordId = null;
        try {
            const searchUrl = `${eagleViewChatUrl}?filterByFormula=SessionID="${sessionId}"`;
            const response = await fetch(searchUrl, { headers: headersAirtable });
            const result = await response.json();

            if (result.records?.length > 0) {
                conversationContext = result.records[0].fields.Conversation || '';
                existingRecordId = result.records[0].id;
                systemMessageContent += ` Here's the conversation so far: "${conversationContext}".`;
            }
        } catch (error) {
            console.error('Error fetching conversation history:', error);
        }

        // Add current time context
        const currentTimePDT = getCurrentTimeInPDT();
        systemMessageContent += ` The current time in PDT is ${currentTimePDT}. If the user asks about future or past times, calculate based on this time.`;

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
                const errorDetail = await openaiResponse.text();
                console.error('OpenAI API error:', errorDetail);
                throw new Error(`OpenAI API error: ${errorDetail}`);
            }

            const openaiData = await openaiResponse.json();
            const aiReply = openaiData.choices[0].message.content;

            // Update conversation in Airtable
            const updatedConversation = `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`;

            try {
                if (existingRecordId) {
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
                console.error('Error updating Airtable:', error);
            }

            return res.json({ reply: aiReply });

        } catch (error) {
            console.error('Error in OpenAI API call:', error);
            return res.status(500).json({ 
                error: 'Failed to communicate with OpenAI',
                details: error.message 
            });
        }

    } catch (error) {
        console.error('Error in chatWithOpenAI:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
};
