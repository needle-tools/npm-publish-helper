import { execSync } from 'child_process';

/**
 * Get the list of files changed on the current branch since the last push.
 * @param {string} directory - The path to the git repository.
 */
export function getDiffSinceLastPush(directory) {

    const beforeSha = process.env.GITHUB_EVENT_BEFORE;
    const afterSha = process.env.GITHUB_SHA;

    console.log(`Using GITHUB_EVENT_BEFORE: ${beforeSha}`);

    if (beforeSha && afterSha && beforeSha !== '0000000000000000000000000000000000000000') {
        return getDiff(directory, beforeSha, afterSha);
    }

    let branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: directory }).toString().trim();
    if (!branch) {
        console.error(`Failed to get current branch in directory: ${directory}`);
        return null;
    }

    branch = `origin/${branch}`; // Ensure we are looking at the remote branch

    // Use reflog to find the last push to origin/branch
    const command = `git reflog show ${branch} --pretty=format:"%h %gs"`;
    const output = execSync(command, { cwd: directory })?.toString().trim();

    if (!output) {
        console.error(`No reflog entries found for branch ${branch}`);
        return null;
    }

    const lines = output.split('\n');
    let lastPushHash = null;

    // Look for "update by push" entry
    for (const line of lines) {
        if (line.includes('update by push')) {
            lastPushHash = line.split(' ')[0];
            break;
        }
    }

    if (!lastPushHash) {
        console.error(`No last push found for branch ${branch}\nReflog entries:\n${output}`);
        return null;
    }

    return getDiff(directory, lastPushHash, "HEAD");
}



/**
 * Get the diff between two commits or the current state and a specific commit.
 * @param {string} directory - The path to the git repository.
 * @param {string} start - The starting commit hash or branch.
 * @param {string} end - The ending commit hash or branch.
 */
function getDiff(directory, start, end) {
    // Get diff of files changed since the last push including changes
    const diffCommand = `git diff ${start}..${end}`;
    const diffOutput = execSync(diffCommand, { cwd: directory })?.toString().trim();

    if (!diffOutput) {
        return null;
    }

    return diffOutput;
}