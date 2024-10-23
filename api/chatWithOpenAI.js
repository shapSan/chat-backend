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

        if (!userMessage || !sessionId) {
            return res.status(400).json({ error: 'Missing userMessage or sessionId in request body.' });
        }

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

        if (!airtableApiKey || !openAIApiKey) {
            return res.status(500).json({ error: 'Missing API keys. Please check your environment variables.' });
        }

        // The rest of your original code remains the same...

    } catch (error) {
        console.error('Error in chatWithOpenAI:', error);
        return res.status(500).json({ error: `Failed to communicate with OpenAI: ${error.message}` });
    }
};
