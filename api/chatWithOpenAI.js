require('dotenv').config(); // Load environment variables from .env file
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
    try {
        const { userMessage, sessionId } = req.body;

        const lowerMessage = userMessage.toLowerCase();

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
                    case 'new york':
                        timeZone = 'America/New_York';
                        break;
                    case 'tokyo':
                        timeZone = 'Asia/Tokyo';
                        break;
                    case 'london':
                        timeZone = 'Europe/London';
                        break;
                    case 'paris':
                        timeZone = 'Europe/Paris';
                        break;
                    default:
                        return res.json({ reply: `Sorry, I don't know the time zone for ${location}. Please try another location.` });
                }

                const timeInLocation = getTimeInTimeZone(timeZone);
                return res.json({ reply: `The current time in ${location.charAt(0).toUpperCase() + location.slice(1)} is: ${timeInLocation}` });
            }
        }

        const airtableApiKey = process.env.AIRTABLE_API_KEY;
        const openAIApiKey = process.env.OPENAI_API_KEY;

        const airtableBaseId = 'appTYnw2qIaBIGRbR'; 
        const knowledgeBaseTableName = 'Chat-KnowledgeBase'; 
        const eagleViewChatTableName = 'EagleView_Chat'; 
        const knowledgeBaseUrl = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(knowledgeBaseTableName)}`;
        const eagleViewChatUrl = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(eagleViewChatTableName)}`;

        const headersAirtable = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${airtableApiKey}`
        };

        let systemMessageContent = `You are a friendly, professional, and cheeky assistant specializing in AI & Automation.`;

        let conversationContext = ''; 

        try {
            const response = await fetch(`${knowledgeBaseUrl}`, { headers: headersAirtable });
            const knowledgeBaseData = await response.json();

            if (knowledgeBaseData.records && knowledgeBaseData.records.length > 0) {
                const knowledgeEntries = knowledgeBaseData.records.map(record => record.fields.Summary).join('\n\n');
                systemMessageContent += ` You have the following knowledge available to assist: "${knowledgeEntries}".`;
            }
        } catch (error) {
            console.error('Error fetching knowledge base:', error);
        }

        let existingRecordId = null;
        try {
            const searchUrl = `${eagleViewChatUrl}?filterByFormula=SessionID="${sessionId}"`;
            const response = await fetch(searchUrl, { headers: headersAirtable });
            const result = await response.json();

            if (result.records && result.records.length > 0) {
                conversationContext = result.records[0].fields.Conversation || '';
                existingRecordId = result.records[0].id;
                systemMessageContent += ` Here's the conversation so far: "${conversationContext}".`;
            }
        } catch (error) {
            console.error('Error fetching conversation history:', error);
        }

        const currentTimePDT = getCurrentTimeInPDT();
        systemMessageContent += ` The current time in PDT is ${currentTimePDT}. If the user asks about future or past times, calculate based on this time.`;

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
            throw new Error(`Failed to communicate with OpenAI: ${errorDetail}`);
        }

        const openaiData = await openaiResponse.json();
        const aiReply = openaiData.choices[0].message.content;

        const updatedConversation = `${conversationContext}\nUser: ${userMessage}\nAI: ${aiReply}`;

        const airtableUpdateUrl = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(eagleViewChatTableName)}`;

        try {
            if (existingRecordId) {
                const updateResponse = await fetch(`${airtableUpdateUrl}/${existingRecordId}`, {
                    method: 'PATCH',
                    headers: headersAirtable,
                    body: JSON.stringify({
                        fields: {
                            Conversation: updatedConversation
                        }
                    })
                });

                if (!updateResponse.ok) {
                    console.error(`Error updating Airtable conversation: ${await updateResponse.text()}`);
                }
            } else {
                const createResponse = await fetch(airtableUpdateUrl, {
                    method: 'POST',
                    headers: headersAirtable,
                    body: JSON.stringify({
                        fields: {
                            SessionID: sessionId,
                            Conversation: updatedConversation
                        }
                    })
                });

                if (!createResponse.ok) {
                    console.error(`Error creating new Airtable conversation: ${await createResponse.text()}`);
                }
            }
        } catch (error) {
            console.error('Error updating or creating Airtable record:', error);
        }

        return res.json({ reply: aiReply });

    } catch (error) {
        console.error('Error in chatWithOpenAI:', error);
        return res.status(500).json({ error: `Failed to communicate with OpenAI: ${error.message}` });
    }
};
