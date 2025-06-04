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
        console.error(`Command failed: ${cmd} \nError: ${error.message.substring(0, 100)}`);
        return false;
    }
}