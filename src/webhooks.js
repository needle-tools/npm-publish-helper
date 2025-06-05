import fetch from 'node-fetch';
import { createCodeBlocks } from './utils.js';


/**
 * Sends a message to a webhook URL (Discord or Slack).
 * @param {string} webhookUrl - The webhook URL to send the message to.
 * @param {string} message - The message to send.
 * @param {string | Error} error - The error message
 * @param {{logger:import('@caporal/core').Logger}} options - Additional arguments
 * @return {Promise<void>} - A promise that resolves to an object indicating success or failure.
 */
export async function sendMessageToWebhookWithError(webhookUrl, message, error, options) {
    const blocks = createCodeBlocks(error, 1500);
    if (blocks.length >= 1) {
        message = `${message}\n${blocks[0]}`;
        await sendMessageToWebhook(webhookUrl, message, options);
        for (const block of blocks.slice(1)) {
            await sendMessageToWebhook(webhookUrl, block, options);
        }
    }
    else {
        await sendMessageToWebhook(webhookUrl, message, options);
    }
}

/**
 * Sends a message to a webhook URL (Discord or Slack).
 * @param {string} webhookUrl - The webhook URL to send the message to.
 * @param {string} message - The message to send.
 * @param {{logger:import('@caporal/core').Logger}} options - Additional arguments
 * @return {Promise<{ success: boolean } |  { success:false, status:number, error: string}>} - A promise that resolves to an object indicating success or failure.
 */
export function sendMessageToWebhook(webhookUrl, message, options) {

    // Discord
    if (webhookUrl.includes("discord.com/api/webhooks/")) {
        const payload = {
            content: message,
        };
        const res = fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        return handleResponse(res);
    }
    // Slack
    else if (webhookUrl.includes("hooks.slack.com/services/")) {
        const payload = {
            text: message,
        };
        const res = fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        return handleResponse(res);
    }
    // Microsoft Teams
    else if (webhookUrl.includes("teams.microsoft.com/l/")) {
        const payload = {
            text: message,
        };
        const res = fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        return handleResponse(res);
    }

    options?.logger.warn(`Unsupported webhook URL: ${webhookUrl}`);
    return Promise.resolve({ success: false, status: 500, error: 'Unsupported webhook URL' });


    /**
     * @param {Promise<import("node-fetch").Response>} res
     */
    function handleResponse(res) {
        return res
            // Check if the response is OK
            .then(response => {
                if (!response.ok) {
                    return { success: false, status: response.status, error: `Failed to send message: ${response.status} ${response.statusText}` };
                }
                return { success: true };
            })
            // Handle network errors
            .catch(error => {
                options?.logger.error(`Error sending message to webhook: ${error.message}`);
                return { success: false, status: 500, error: `Failed to send message: ${error.message}` };
            });
    }

}