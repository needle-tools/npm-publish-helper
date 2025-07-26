import { execSync } from 'child_process';
import { tryLoadGithubEventData } from './utils.github.js';
import { tryExecSync } from './utils.js';

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
 * Get the diff within a time range
 * @param {string} directory - The path to the git repository.
 * @param {{logger:import("@caporal/core").Logger, startTime:string, endTime:string, includeCommitInformation?:boolean}} options - Options for the diff.
 * 
 */
export function getDiffSince(directory, options) {

    const { logger,
        startTime: startTime,
        endTime: endTime } = options || {};

    if (!startTime || !endTime) {
        throw new Error('Both startTime and endTime must be provided');
    }
    else {
        logger.debug(`Getting diff from ${startTime} to ${endTime}`);
    }

    const branchName = "HEAD"; // Use HEAD to get the current branch
    const maxBufferSize = 1024 * 1024 * 10; // Increase buffer size to handle large diffs

    // Fetch the latest changes
    tryFetch(directory, 'origin', { logger });


    try {

        if (options.includeCommitInformation) {
            const cmd = `git log --since="${startTime}" --until="${endTime}" --pretty=format:"%h %an %ai %s" --date=short -p`;
            const logRes = tryExecSync(cmd, {
                encoding: 'utf8',
                cwd: directory,
                maxBuffer: maxBufferSize
            }, { logError: true, logger });
            if (!logRes.success) {
                logger.error(`Failed to get commit information: ${logRes.error}`);
                return null;
            }
            return logRes.output.trim();
        }


        // Get the first commit after start date
        const startCommitRes = tryExecSync(`git rev-list -n 1 --before="${startTime}" ${branchName}`, {
            encoding: 'utf8',
            cwd: directory
        }, { logError: true, logger });

        // Get the last commit before end date  
        const endCommitRes = tryExecSync(`git rev-list -n 1 --before="${endTime}" ${branchName}`, {
            encoding: 'utf8',
            cwd: directory
        }, { logError: true, logger });

        if (!startCommitRes.success || !endCommitRes.success) {
            return null;
        }

        const startCommit = startCommitRes.output.trim();
        const endCommit = endCommitRes.output.trim();

        // Now diff between these commits
        const diffRes = tryExecSync(`git diff ${startCommit}^..${endCommit}`, {
            encoding: 'utf8',
            cwd: directory,
            maxBuffer: maxBufferSize
        }, { logError: true, logger });

        if (!diffRes.success) {
            logger.error(`Failed to get diff: ${diffRes.error}`);
            return null;
        }
        const diffOutput = diffRes.output.trim();
        return diffOutput;

    } catch (error) {
        logger.error(error);
    }

    return null;
}


/**
 * Fetch more history if the repository is shallow or fetch latest changes.
 * @param {string} directory - The path to the git repository.
 * @param {string} originName - The name of the remote origin (default is 'origin').
 * @param { { logger: import("@caporal/core").Logger | null, maxDepth?:number }} options - Additional options.
 */
function tryFetch(directory, originName = 'origin', options) {
    const { logger, maxDepth = 100 } = options || {};

    try {
        // Check if repo is shallow first
        const isShallow = execSync('git rev-parse --is-shallow-repository', {
            cwd: directory,
            encoding: 'utf8'
        }).toString().trim();

        const currentBranchName = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: directory,
            encoding: 'utf8'
        }).toString().trim();

        if (isShallow === 'true') {
            logger?.info('Repository is shallow, fetching more history...');
            // Deepen by specific amount instead of full unshallow
            execSync(`git fetch --depth=${maxDepth} --no-tags ${originName} ${currentBranchName}`, {
                cwd: directory,
                stdio: 'pipe'
            });
        }
        else {
            logger?.info('Repository is complete, fetching latest changes...');

            // Check if we're in detached HEAD or if branch exists on remote
            if (currentBranchName === 'HEAD') {
                // Just fetch all refs
                execSync(`git fetch --no-tags ${originName}`, {
                    cwd: directory,
                    stdio: 'pipe'
                });
            } else {
                // Try to fetch the specific branch, fall back to fetching all
                try {
                    execSync(`git fetch --shallow-since="30 days ago" --no-tags ${originName} ${currentBranchName}`, {
                        cwd: directory,
                        stdio: 'pipe'
                    });
                } catch (branchError) {
                    logger?.debug(`Branch-specific fetch failed, fetching all: ${branchError.message}`);
                    execSync(`git fetch --shallow-since="30 days ago" --no-tags ${originName}`, {
                        cwd: directory,
                        stdio: 'pipe'
                    });
                }
            }
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