import { execSync } from 'child_process';

/**
 * Executes a command synchronously and returns the output.
 * If the command fails, it returns the error instead of throwing it.
 * @param {string} cmd - The command to execute.
 * @param {import('child_process').ExecSyncOptionsWithBufferEncoding} [options] - Optional options for execSync.
 * @return {{success: false, error:string|Error, output:string } | {success: true, output:string}} - The output of the command as a string, or an Error object if the command fails.
 */
export function tryExecSync(cmd, options) {
    try {
        const res = execSync(cmd, options).toString().trim();
        return { success: true, output: res };
    } catch (error) {
        const oneLineError = error.message.split('\n')[0];
        console.error(`Command failed: ${cmd}\n— Error: "${oneLineError}"`);
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