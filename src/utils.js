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