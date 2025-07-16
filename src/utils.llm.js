

/**
 * @typedef {"changelog" | "commit"} SummarizationType
 * @typedef { { success: true, summary:string } | { success: false, error: string } } Output
 */

/**
 * @param {SummarizationType} type - The type of summarization to perform.
 * @param {string} text - The text to summarize.
 * @returns {Promise<Output>} - The result of the summarization.
 */
export async function trySummarize(type, text) {
    const api_key = process.env.LLM_API_KEY;
    if (!api_key) {
        return { success: false, error: "No LLM API key provided" };
    }

    const prompt = getPrompt(type);
    if (!prompt) {
        return { success: false, error: `No prompt defined for summarization type: ${type}` };
    }

    if (api_key.startsWith("sk-")) {
        return await summarizeDeepSeek(api_key, prompt, text);
    }

    return { success: false, error: "LLM API not supported yet" };
}


/**
 * Get a prompt for the specified summarization type.
 * @param {SummarizationType} type - The type of summarization to perform.
 */
function getPrompt(type) {
    switch (type) {
        case "changelog":
            return "Generate a concise changelog summary from the provided text. Only include the most important changes and improvements.";
        case "commit":
            return "Generate a concise commit message from the provided text. Focus on the key changes and improvements made.";
        default:
            return null;
    }
}


/**
 * Summarize text using DeepSeek LLM.
 * @param {string} api_key - The API key for DeepSeek.
 * @param {string} prompt - The prompt to use for summarization.
 * @param {string} text - The text to summarize.
 * @returns {Promise<Output>} - The result of the summarization.
 */
async function summarizeDeepSeek(api_key, prompt, text) {
    try {
        const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${api_key}`
            },
            body: JSON.stringify({
                model: "deepseek-chat-3.5-turbo",
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: text }
                ],
                max_tokens: 500,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            return { success: false, error: `API Error: ${errorText}` };
        }

        const data = await response.json();
        return { success: true, summary: data.choices[0].message.content.trim() };
    } catch (error) {
        return { success: false, error: `Fetch Error: ${error.message}` };
    }
}