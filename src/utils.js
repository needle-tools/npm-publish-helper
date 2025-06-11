import { execSync } from 'child_process';
import { appendFileSync } from 'fs';
import { sendMessageToWebhook, sendMessageToWebhookWithError } from './webhooks.js';

/**
 * Executes a command synchronously and returns the output.
 * If the command fails, it returns the error instead of throwing it.
 * @param {string} cmd - The command to execute.
 * @param {import('child_process').ExecSyncOptionsWithBufferEncoding | import("child_process").ExecOptionsWithStringEncoding} [execOptions] - Optional options for execSync.
 * @param {{logError?:boolean}} [options] - Additional options
 * @return {{success: false, error:string|Error, output:string } | {success: true, output:string}} - The output of the command as a string, or an Error object if the command fails.
 */
export function tryExecSync(cmd, execOptions, options = {}) {
    try {
        const res = execSync(cmd, execOptions).toString().trim();
        return { success: true, output: res };
    } catch (error) {
        const oneLineError = error.message.split('\n')[0];
        if (options?.logError !== false) console.error(`Command failed: ${cmd}\n— Error: "${oneLineError}"`);
        return { success: false, output: error.message, error: error, };
    }
}

/**
 * Obfuscates a token by replacing the middle characters with asterisks.
 * @param {string | null | undefined} token - The token to obfuscate.
 */
export function obfuscateToken(token) {
    if (!token) return '';
    return `${token.slice(0, 2)}${"*".repeat(Math.min(4, token.length - 4))}${token.slice(-2)}`;
}


/**
 * Creates code blocks from a given text, splitting it into multiple blocks if it exceeds the specified maximum length.
 * @param {string | object} text - The text to split into code blocks.
 * @param {number} [maxLengthPerBlock=1500] - The maximum length of each code block.
 * @return {string[]} - An array of code blocks, each formatted as a Markdown code block.
 */
export function createCodeBlocks(text, maxLengthPerBlock = 1500) {
    /** @type {string[]} */
    const blocks = new Array();
    let currentBlock = '';

    if (typeof text !== 'string') {
        text = text.toString();
    }

    text.split('\n').forEach(line => {
        if (currentBlock.length + line.length + 1 > maxLengthPerBlock) {
            blocks.push(`\`\`\`${currentBlock.replaceAll("`", "'")}\`\`\``);
            currentBlock = line;
        } else {
            currentBlock += (currentBlock ? '\n' : '') + line;
        }
    });

    if (currentBlock) {
        blocks.push(`\`\`\`${currentBlock.replaceAll("`", "'")}\`\`\``);
    }

    return blocks;
}





/**
 * Writes output variables for CI environments like GitHub Actions.
 * @param {string} key - The key for the output variable.
 * @param {string | boolean | number} value - The value for the output variable.
 * @param {{logger:import('@caporal/core').Logger}} [options] - Additional options, such as whether the package needs to be published.
 */
export function tryWriteOutputForCI(key, value, options) {
    // is github CI?
    if (process.env.GITHUB_ACTIONS) {
        if (process.env.GITHUB_OUTPUT) {
            appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
        }
        else {
            options?.logger.warn(`GITHUB_OUTPUT environment variable is not set. Cannot set output variables.`);
        }
    }
    else {
        // Unknown CI environment...
    }
}



/**
 * Invokes a repository dispatch event in another repository to trigger a workflow.
 * @param {import('../types').RepositoryDispatchOptions} options
 * @returns {{success: boolean, error?: string | Error}}
 */
export function invokeRepositoryDispatch(options) {

    const { logger, repository, accessToken, ref, workflow, inputs } = options;

    // https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28#create-a-workflow-dispatch-event

    const url = `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`;
    const body = JSON.stringify({
        ref: ref || 'main', // Default to 'main' branch if not specified
        inputs: {
            ...inputs, // Spread any additional inputs provided
        }
    });
    const cmd = `curl -L -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer ${accessToken}" -H "X-GitHub-Api-Version: 2022-11-28" ${url} -H "Content-Type: application/json" -d "${body.replaceAll('"', '\\"')}"`;

    logger.debug(`
---
Invoking repository dispatch with command:
${cmd.replaceAll(/Authorization.+Bearer [^ ]+/g, `Authorization Bearer ${obfuscateToken(accessToken)}`)}
---
`);

    const res = tryExecSync(cmd,
        {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 10, // 10 MB
        }, { logError: false });
    if (!res.success) {
        if (options.webhookUrl) {
            sendMessageToWebhookWithError(options.webhookUrl, `**Failed to invoke repository dispatch**:`, res.error, { logger });
        }
        return { success: false, error: res.error };
    }

    logger.debug(`Repository dispatch invoked successfully for workflow: ${workflow} in repository: ${repository}`);
    if (options.webhookUrl) {
        const repositoryWorkflowUrl = `https://github.com/${repository}/actions/workflows/${workflow}`;
        sendMessageToWebhook(options.webhookUrl, `🤖 **Repository dispatch** invoked successfully for workflow: [${workflow}](<${repositoryWorkflowUrl}>) in repository: ${repository}`, { logger });
    }
    return { success: true };
}