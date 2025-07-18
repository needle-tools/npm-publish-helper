import { execSync } from 'child_process';
import { tryLoadGithubEventData } from './utils.github.js';

/**
 * Get the list of files changed on the current branch since the last push.
 * @param {string} directory - The path to the git repository.
 * @param {{ logger:import("@caporal/core").Logger }} options
 */
export function getDiffSinceLastPush(directory, options) {

    const { logger } = options || {};

    const originName = "origin";

    // First fetch changes
    tryFetch(directory, originName, { logger });

    const event_data = tryLoadGithubEventData({ logger });
    logger.debug(event_data);

    // Use GitHub event context to get the base commit
    const baseRef = process.env.GITHUB_BASE_REF || 'HEAD~1';
    const headRef = process.env.GITHUB_HEAD_REF || 'HEAD';
    // If it's a pull request, use the base branch
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
        logger.info(`Get diff for pull request: ${baseRef} → ${headRef}`);
        return getDiff(directory, `${originName}/${baseRef}`, headRef);
    }

    // If not a pull request, use the GITHUB_EVENT_BEFORE and GITHUB_SHA environment variables
    const beforeSha = event_data?.before || process.env.GITHUB_EVENT_BEFORE;
    const afterSha = event_data?.after || process.env.GITHUB_SHA;
    if (beforeSha && afterSha && beforeSha !== '0000000000000000000000000000000000000000') {
        logger.info(`Get diff: ${beforeSha} → ${afterSha}`);
        return getDiff(directory, beforeSha, afterSha);
    }


    // If no specific refs are provided, get the current branch
    let branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: directory }).toString().trim();
    if (!branch) {
        logger.error(`Failed to get current branch in directory: ${directory}`);
        return null;
    }

    branch = `${originName}/${branch}`; // Ensure we are looking at the remote branch

    // Use reflog to find the last push to origin/branch
    const command = `git reflog show ${branch} --pretty=format:"%h %gs"`;
    const output = execSync(command, { cwd: directory })?.toString().trim();

    if (!output) {
        logger.error(`No reflog entries found for branch ${branch}`);
        // Final fallback: compare with previous commit
        logger.debug('Falling back to HEAD~1..HEAD');
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
        logger.error(`No last push found for branch ${branch}\nReflog entries:\n${output}`);
        // Final fallback: compare with previous commit
        logger.debug('Falling back to HEAD~1..HEAD');
        return getDiff(directory, "HEAD~1", "HEAD");
    }

    return getDiff(directory, lastPushHash, "HEAD");
}


/**
 * Fetch more history if the repository is shallow or fetch latest changes.
 * @param {string} directory - The path to the git repository.
 * @param {string} originName - The name of the remote origin (default is 'origin').
 * @param { { logger: import("@caporal/core").Logger }} options - Additional options.
 */
function tryFetch(directory, originName = 'origin', options) {
    const { logger } = options || {};

    try {
        // Check if repo is shallow first
        const isShallow = execSync('git rev-parse --is-shallow-repository', {
            cwd: directory,
            encoding: 'utf8'
        }).toString().trim();

        if (isShallow === 'true') {
            logger?.debug('Repository is shallow, fetching more history...');
            execSync(`git fetch --unshallow --no-tags ${originName}`, {
                cwd: directory,
                stdio: 'pipe' // Suppress output unless there's an error
            });
        } else {
            logger?.debug('Repository is complete, fetching latest changes...');
            execSync(`git fetch --no-tags ${originName}`, {
                cwd: directory,
                stdio: 'pipe'
            });
        }

        logger?.debug('Fetch completed successfully');
        return true;
    } catch (error) {
        logger?.warn(`Failed to fetch: ${error.message}`);
        return false;
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
    const diffCommand = `git diff ${start}...${end}`;
    const diffOutput = execSync(diffCommand, { cwd: directory })?.toString().trim();

    if (!diffOutput) {
        return null;
    }

    return diffOutput;
}