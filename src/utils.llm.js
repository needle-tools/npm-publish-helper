

/**
 * @typedef {"changelog" | "commit" | "podcast"} SummarizationType
 * @typedef { { success: true, summary:string } | { success: false, error: string, status: number } } Output
 */


/**
 * @param {SummarizationType | {prompt:string}} typeOrPrompt - The type of summarization to perform.
 * @param {string} text - The text to summarize.
 * @param { { api_key?: string, logger:import("@caporal/core").Logger } } options - Additional options, including the LLM API key.
 * @returns {Promise<Output>} - The result of the summarization.
 */
export async function runLLM(typeOrPrompt, text, options) {
    const api_key = options?.api_key || process.env.LLM_API_KEY;
    if (!api_key) {
        return { success: false, error: "No LLM API key provided", status: 400 };
    }

    const prompt = typeof typeOrPrompt === "object" ? typeOrPrompt.prompt : getPrompt(typeOrPrompt);
    if (!prompt) {
        return { success: false, error: `No prompt defined for summarization type: ${typeOrPrompt}`, status: 400 };
    }

    if (api_key.startsWith("sk-ant-")) {
        options.logger.info(`Using Claude LLM for summarization (Length: ${text.length.toLocaleString()})`);
        return await runClaude(api_key, prompt, text);
    }
    else if (api_key.startsWith("sk-or")) {
        // TODO OpenAI
    }
    else if (api_key.startsWith("sk-")) {
        options.logger.info(`Using DeepSeek LLM for summarization (Length: ${text.length.toLocaleString()})`);
        return await runDeepSeek(api_key, prompt, text);
    }

    return { success: false, error: "Unknown LLM API key format", status: 501 };
}


/**
 * Get a prompt for the specified summarization type.
 * @param {SummarizationType} type - The type of summarization to perform.
 */
function getPrompt(type) {
    switch (type) {
        case "changelog":
            return `Generate a concise changelog summary from the provided text. 
Only include the most important changes and improvements.
Use prefixes like 'Added:', 'Fixed:', 'Changed:' to categorize changes, ordered by type (e.g., 'Added: New feature X', 'Fixed: Bug in feature Y'). 
Use bullet points for multiple changes if necessary and if appropriate code snippets or examples of how to use new or updated features.
No whitespace at the start of the line.
Example format:
- New feature X that improves user experience
- Bug in feature Y that caused crashes when xyz happened 
`;
        case "commit":
            return `Generate a concise commit message from the provided text - summarize the changes made in a clear and informative way. 
Use the commit description to explain the purpose and impact of the changes. 
Use bullet points for multiple changes if necessary put multiple changes in one bullet point if they're essentially the same. 
No whitespace at the start of the line, no newlines, no markdown formatting.
Example format:
- New feature X that improves user experience
- Bug in feature Y that caused crashes when xyz happened
`;
        case "podcast":
            return `Generate a concise summary of the provided text as if it were a podcast episode transcript.
Focus on the key points and insights discussed, making it engaging and easy to understand for listeners.`;

        default:
            throw new Error(`Unknown summarization type: ${type}`);
    }
}


/**
 * Summarize text using DeepSeek LLM.
 * @param {string} api_key - The API key for DeepSeek.
 * @param {string} prompt - The prompt to use for summarization.
 * @param {string} text - The text to summarize.
 * @returns {Promise<Output>} - The result of the summarization.
 */
async function runDeepSeek(api_key, prompt, text) {
    try {

        const maxLength = 100_000;
        if (text.length > maxLength) {
            let summary = "";
            for (let i = 0; i < text.length; i += maxLength) {
                const slice = text.slice(i, i + maxLength);
                const res = await runDeepSeek(api_key, prompt, slice);
                if (!res.success) {
                    return res; // Return error if summarization fails
                }
                summary += res.summary + "\n\n";
                if (i > 10) {
                    summary += "[truncated]"; // Indicate that there are more changes
                    break; // Avoid too many API calls
                }
            }
            return { success: true, summary: summary };
        }

        const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${api_key}`
            },
            body: JSON.stringify({
                model: "deepseek-chat",
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
            return { success: false, error: `API Error: ${errorText}`, status: response.status };
        }

        const data = await response.json();
        return { success: true, summary: data.choices[0].message.content.trim() };
    } catch (error) {
        return { success: false, error: `Fetch Error: ${error.message}`, status: 500 };
    }
}


/**
 * Summarize text using Claude LLM.
 * @param {string} api_key - The API key for Claude.
 * @param {string} prompt - The prompt to use for summarization.
 * @param {string} text - The text to summarize.
 * @param {string} [model="claude-opus-4-20250514"] - The model to use for summarization.
 * @returns {Promise<Output>} - The result of the summarization.
 */
async function runClaude(api_key, prompt, text, model = "claude-opus-4-20250514") {
    try {
        const response = await fetch("https://api.claude.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${api_key}`
            },
            body: JSON.stringify({
                model: model,
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
            return { success: false, error: `API Error: ${errorText}`, status: response.status };
        }

        const data = await response.json();
        return { success: true, summary: data.choices[0].message.content.trim() };
    } catch (error) {
        return { success: false, error: `Fetch Error: ${error.message}`, status: 500 };
    }
}