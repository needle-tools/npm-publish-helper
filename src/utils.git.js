import { execSync } from 'child_process';

/**
 * Get the list of files changed on the current branch since the last push.
 * @param {string} directory - The path to the git repository.
 */
export function getDiffSinceLastPush(directory) {

    const originName = "origin";

    // Use GitHub event context to get the base commit
    const baseRef = process.env.GITHUB_BASE_REF || 'HEAD~1';
    const headRef = process.env.GITHUB_HEAD_REF || 'HEAD';
    // If it's a pull request, use the base branch
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
        console.log(`Using base ref: ${baseRef} and head ref: ${headRef}`);
        return getDiff(directory, `${originName}/${baseRef}`, headRef);
    }

    // If not a pull request, use the GITHUB_EVENT_BEFORE and GITHUB_SHA environment variables
    const beforeSha = process.env.GITHUB_EVENT_BEFORE;
    const afterSha = process.env.GITHUB_SHA;
    console.log(`Using GITHUB_EVENT_BEFORE: ${beforeSha}`);
    if (beforeSha && afterSha && beforeSha !== '0000000000000000000000000000000000000000') {
        return getDiff(directory, beforeSha, afterSha);
    }


    // First fetch changes
    tryFetch(directory, originName);

    // If no specific refs are provided, get the current branch
    let branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: directory }).toString().trim();
    if (!branch) {
        console.error(`Failed to get current branch in directory: ${directory}`);
        return null;
    }

    branch = `${originName}/${branch}`; // Ensure we are looking at the remote branch

    // Use reflog to find the last push to origin/branch
    const command = `git reflog show ${branch} --pretty=format:"%h %gs"`;
    const output = execSync(command, { cwd: directory })?.toString().trim();

    if (!output) {
        console.error(`No reflog entries found for branch ${branch}`);
        // Final fallback: compare with previous commit
        console.log('Falling back to HEAD~1..HEAD');
        return getDiff(directory, "HEAD~1", "HEAD");
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
        // Final fallback: compare with previous commit
        console.log('Falling back to HEAD~1..HEAD');
        return getDiff(directory, "HEAD~1", "HEAD");
    }

    return getDiff(directory, lastPushHash, "HEAD");
}


function tryFetch(directory, originName) {
    // Try to fetch more history if needed (handle both shallow and complete repos)
    try {
        // Check if repo is shallow first
        const isShallow = execSync('git rev-parse --is-shallow-repository', { cwd: directory }).toString().trim();

        if (isShallow === 'true') {
            console.log('Repository is shallow, fetching more history...');
            execSync(`git fetch --unshallow --no-tags ${originName}`, { cwd: directory });
        } else {
            console.log('Repository is complete, fetching latest changes...');
            execSync(`git fetch --no-tags ${originName}`, { cwd: directory });
        }
    } catch (error) {
        console.warn(`Failed to fetch: ${error.message}`);
    }
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