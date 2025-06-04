import { execSync } from 'child_process';

/**
 * Executes a command synchronously and returns the output.
 * If the command fails, it returns the error instead of throwing it.
 * @param {string} cmd - The command to execute.
 * @param {import('child_process').ExecSyncOptionsWithBufferEncoding} [options] - Optional options for execSync.
 * @return {false | string} - The output of the command as a string, or an Error object if the command fails.
 */
export function tryExecSync(cmd, options) {
    try {
        return execSync(cmd, options).toString().trim();
    } catch (error) {
        const oneLineError = error.message.split('\n')[0];
        console.error(`Command failed: ${cmd}\n— Error: "${oneLineError}"`);
        return false;
    }
}

/**
 * Obfuscates a token by replacing the middle characters with asterisks.
 * @param {string | null | undefined} token - The token to obfuscate.
 */
export function obfuscateToken(token) {
    if (!token) return '';
    return `${token.slice(0, 2)}***${token.slice(-2)}`;
}