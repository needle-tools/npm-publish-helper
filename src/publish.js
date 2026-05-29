import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { sendMessageToWebhook, sendMessageToWebhookWithCodeblock } from './webhooks.js';
import { obfuscateToken, tryExecSync, tryWriteOutputForCI } from './utils.js';
import { getDiffSinceLastPush } from './utils.git.js';
import { runLLM } from './utils.llm.js';
import { tryLoadGithubEventData } from './utils.github.js';
import { updateNpmdef } from './npmdef.js';
import { build, compile } from './compile.js';
import { getVersionName } from './version-names.js';
import { exchangeOidcForNpmToken } from './utils.oidc.js';


/**
 * @param {import('../types').PublishOptions} args
 */
export async function publish(args) {

    const logger = args.logger;
    const webhook = args.webhookUrl;
    const packageDirectory = resolve(args.packageDirectory || process.cwd());
    const packageJsonPath = `${packageDirectory}/package.json`;
    const dryRun = args.dryRun || false;
    const event_data = tryLoadGithubEventData({ logger });

    const packageExists = existsSync(packageJsonPath);
    if (!packageExists) {
        throw new Error(`No package.json found at ${packageJsonPath}`);
    }
    logger.info(`Publishing package at ${packageDirectory}`);

    const _originalPackageJson = readFileSync(packageJsonPath, 'utf-8');

    if (args.overrideName || args.overrideVersion) {
        logger.info(`Overriding package name and/or version in ${packageJsonPath}`);
        const json = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        if (args.overrideName) {
            json.name = args.overrideName;
            logger.info(`Overriding package name to ${json.name}`);
        }
        if (args.overrideVersion) {
            json.version = args.overrideVersion;
            logger.info(`Overriding package version to ${json.version}`);
        }
        writeFileSync(packageJsonPath, JSON.stringify(json, null, 2));
    }


    /** @type {import('../types').PackageJson} */
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const buildTime = new Date().toISOString();
    const shortSha = tryExecSync('git rev-parse --short HEAD', { cwd: packageDirectory }).output;
    const repoUrl = tryExecSync('git config --get remote.origin.url', { cwd: packageDirectory }).output;
    const commitMessage = tryExecSync('git log -1 --pretty=%B', { cwd: packageDirectory }).output.trim();
    const commitAuthorWithEmail = tryExecSync('git log -1 --pretty="%an <%ae>"', { cwd: packageDirectory }).output.trim();
    const registryName = new URL(args.registry || 'https://registry.npmjs.org/').hostname.replace('www.', '');


    logger.info(`Package: ${packageJson.name}@${packageJson.version}`);
    logger.info(`Build time: ${buildTime}`);
    logger.info(`Short SHA: ${shortSha}`);
    if (args.useOidc) {
        logger.info(`Authentication: OIDC (Trusted Publishing)`);
    } else {
        logger.info(`Authentication: Token`);
        logger.info(`Token: '${obfuscateToken(args.accessToken)}'`);
    }
    logger.info(`Repository: ${repoUrl}`);
    logger.info(`Last commit message: ${commitMessage}`);
    logger.info(`Last commit author: ${commitAuthorWithEmail}`);
    logger.info(`Registry: ${args.registry || 'https://registry.npmjs.org/'}`);

    if (!args.useOidc && !args.accessToken?.length) {
        logger.warn(`No access token provided and OIDC not enabled. Publishing to registry ${args.registry} may fail.`);
    }
    if (args.useOidc) {
        // Check npm version for OIDC support (requires 11.5+)
        const npmVersionResult = tryExecSync('npm --version', { cwd: packageDirectory });
        if (npmVersionResult.success) {
            const npmVersion = npmVersionResult.output.trim();
            const [major, minor] = npmVersion.split('.').map(Number);
            if (major < 11 || (major === 11 && minor < 5)) {
                const errorMsg = `OIDC requires npm 11.5+, but found ${npmVersion}. Use Node.js 24+ or run 'npm install -g npm@latest'`;
                logger.error(`❌ ${errorMsg}`);
                if (webhook) {
                    await sendMessageToWebhook(webhook, `❌ **OIDC failed**: ${errorMsg}`, { logger });
                }
                throw new Error(errorMsg);
            }
        }
    }

    // Normalize args.tag into an array of tags. Accepts string, string[], or null/undefined.
    // Each tag is sanitized: if it contains slashes (e.g. a github ref_name like "cli/latest")
    // we keep the last non-empty segment.
    /** @type {string[]} */
    const tags = (() => {
        if (args.tag == null) return [];
        const raw = Array.isArray(args.tag) ? args.tag : [args.tag];
        const out = [];
        for (const t of raw) {
            if (typeof t !== 'string' || t.length === 0) continue;
            if (t.includes('/')) {
                logger.warn(`Tag '${t}' contains slashes - using last part as tag.`);
                const parts = t.split('/');
                let picked = null;
                for (let i = parts.length - 1; i >= 0; i--) {
                    if (parts[i].length > 0) { picked = parts[i]; break; }
                }
                if (!picked) throw new Error(`Tag '${t}' is not valid`);
                out.push(picked);
            } else {
                out.push(t);
            }
        }
        // Deduplicate while preserving order
        return Array.from(new Set(out));
    })();
    // Keep args.tag as the primary tag (string | null) so downstream code & webhooks remain backwards-compatible.
    args.tag = tags[0] ?? null;
    const additionalTags = tags.slice(1);


    /** @type {string | null} */
    let llm_summary = null;
    try {
        if (args.llm?.apiKey) {
            logger.info(`Using LLM for summarization with API key: ${obfuscateToken(args.llm.apiKey)}`);
            const commits = getDiffSinceLastPush(packageDirectory, { logger });
            logger.info(`COMMITS:\n${commits}`);
            if (commits) {
                const res = await runLLM("commit", commits, { api_key: args.llm.apiKey, logger });
                if (res.success) {
                    logger.info(`Commit summary:\n---\n${res.summary}\n---\n`);
                    llm_summary = res.summary;
                }
                else {
                    logger.error(`Failed to summarize commits: ${res.error} (Status: ${res.status})`);
                }
            }
        }
        else {
            logger.warn(`No LLM API key provided, skipping commit summarization.`);
        }
    }
    catch (err) {
        logger.error(`Failed to get changes since last push: ${err.message}`);
    }

    processPackageJson(packageDirectory, packageJson, { logger });

    // For OIDC: ensure repository field exists (required for provenance)
    if (args.useOidc && repoUrl) {
        const repoMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
        if (repoMatch && !packageJson.repository?.url) {
            const repoUrlNormalized = `https://github.com/${repoMatch[1]}/${repoMatch[2]}.git`;
            logger.info(`Adding repository field for OIDC provenance: ${repoUrlNormalized}`);
            packageJson.repository = {
                type: 'git',
                url: repoUrlNormalized
            };
            writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8');
        }
    }

    if (webhook) {
        const commitMessageOneLiner = commitMessage?.trim().replaceAll("\n", " ");
        const commitUrl = event_data?.compare || `${repoUrl}/commit/${shortSha}`;
        // Build job URL from GitHub Actions environment variables
        const jobUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
            ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
            : null;
        let msg = `🐱‍💻 **Publish package** \`${packageJson.name}\` – [commit](<${commitUrl}>)${jobUrl ? ` | [job](<${jobUrl}>)` : ''}\n`;
        msg += "```\n";
        msg += `Repository: ${repoUrl}\n`;
        msg += `Short SHA: ${shortSha}${args.useTagInVersion ? ' (version+hash)' : ''}\n`;
        msg += `Committer : ${commitAuthorWithEmail}\n`;
        msg += `Commit: "${commitMessageOneLiner?.length > 254 ? (commitMessageOneLiner.substring(0, 254) + "...") : commitMessageOneLiner}"\n`.replaceAll("`", "'");
        msg += `Commit URL: ${repoUrl}/commit/${shortSha}\n`;
        msg += `Build time: ${buildTime}\n`;
        msg += `Registry: ${args.registry}\n`;
        msg += `Auth: ${args.useOidc ? 'OIDC (Trusted Publishing)' : obfuscateToken(args.accessToken)}\n`;
        const tagsLabel = tags.length > 0 ? tags.join(', ') : '-';
        msg += `Tag: ${tagsLabel}${args.useTagInVersion ? ' (version+tag)' : ''}${args.createGitTag ? ' (creating git tag)' : ''}\n`;
        msg += "```";
        await sendMessageToWebhook(webhook, msg, { logger });
        if (llm_summary) {
            msg = `📝 **Changes summary** for \`${packageJson.name}\`:\n\`\`\`\n${llm_summary}\n\`\`\``;
            await sendMessageToWebhook(webhook, msg, { logger });
        }
    }
    else {
        logger.info(`No webhook URL provided, skipping webhook notifications.`);
    }

    tryWriteOutputForCI("build-time", buildTime, { logger });

    // Update package version
    {
        const currentVersion = packageJson.version;

        let nextVersion = currentVersion;
        if (args.useTagInVersion && args.tag && args.tag !== "latest") {
            // First remove the existing tag the pre-release tag if it exists
            const dashIndex = nextVersion.indexOf('-');
            if (dashIndex > 0) nextVersion = nextVersion.substring(0, dashIndex);
            // Then append the new tag
            logger.info(`Adding tag '${args.tag}' to version.`);
            nextVersion += `-${args.tag}`;
        }
        if (args.useTimeInVersion) {
            const epochSeconds = Math.floor(Date.now() / 1000);
            logger.info(`Adding epoch timestamp '${epochSeconds}' to version.`);
            if (nextVersion.includes('-')) {
                nextVersion += `.${epochSeconds}`;
            }
            else {
                nextVersion += `-${epochSeconds}`;
            }
        }
        if (args.useNameInVersion && shortSha) {
            const name = getVersionName(shortSha);
            logger.info(`Adding name '${name}' to version (derived from hash '${shortSha}').`);
            if (nextVersion.includes('-')) {
                nextVersion += `.${name}`;
            }
            else {
                nextVersion += `-${name}`;
            }
        }
        if (args.useHashInVersion && shortSha) {
            if (nextVersion.includes('-')) {
                nextVersion += `.${shortSha}`;
            }
            else {
                nextVersion += `-${shortSha}`;
            }
        }
        else {
            logger.info(`Skipping commit hash in version as useCommitHash is false or shortSha is not available.`);
        }
        if (currentVersion !== nextVersion) {
            // the package version can only be updated if it's different
            const cmd = `npm version ${nextVersion} --no-git-tag-version`;
            logger.info(`Updating package version to \"${nextVersion}\" with command \"${cmd}\"`);
            const res = tryExecSync(cmd, { cwd: packageDirectory });
            if (!res.success) {
                logger.error(`Failed to update package version: ${res.error}`);
                if (webhook) {
                    await sendMessageToWebhookWithCodeblock(webhook, `❌ **Failed to update package version** \`${packageJson.name}\`:`, res.error, { logger });
                }
                throw new Error(`Failed to update package version: ${res.error}`);
            }
        }
        // ensure the version is set correctly (it might have been modified in the meantime)
        packageJson.version = nextVersion;
        logger.info(`Updated package version to ${packageJson.version}`);
    }

    if (args.updateNpmdef) {
        await updateNpmdef({ logger });
    }
    if (args.compileTsc) {
        await compile({ logger })
    }
    if (args.compileDist) {
        await build({ logger });
    }


    // Default env
    const env = {
        ...process.env,
        NPM_CONFIG_REGISTRY: (args.registry || 'https://registry.npmjs.org/'),
    }

    // For OIDC: completely unset token variables so npm falls back to OIDC
    // An empty string is still a value - npm will try to use it instead of OIDC
    if (args.useOidc) {
        delete env.NPM_TOKEN;
        delete env.NODE_AUTH_TOKEN;
        delete env.NPM_CONFIG__AUTH;
        delete env.NPM_CONFIG_TOKEN;
    } else {
        env.NPM_TOKEN = args.accessToken || undefined;
    }


    // set config
    if (!args.useOidc) {
        // Traditional token authentication
        let registryUrlWithoutScheme = (args.registry || 'https://registry.npmjs.org/').replace(/https?:\/\//, '');
        if (!registryUrlWithoutScheme.endsWith('/')) registryUrlWithoutScheme += '/';

        const configCmd = `npm config set //${registryUrlWithoutScheme}:_authToken ${env.NPM_TOKEN}`;
        logger.info(`Setting npm config to registry: npm config set //${registryUrlWithoutScheme}:_authToken ${obfuscateToken(env.NPM_TOKEN)}`);
        execSync(configCmd, {
            cwd: packageDirectory,
            env
        });
    } else {
        // OIDC mode
        logger.info(`Using OIDC authentication`);

        // Warn if OIDC environment is not detected
        if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
            logger.warn(`⚠ OIDC environment not detected. Ensure workflow has 'id-token: write' permission.`);
        }
    }

    const htmlUrl = args.registry?.includes("npmjs") ? `https://www.npmjs.com/package/${packageJson.name}/v/${packageJson.version}` : (args.registry + `/${packageJson.name}`);
    const htmlUrlMarkdown = `[${registryName}/${packageJson.name}@${packageJson.version}](<${htmlUrl}>)`;

    // publish package
    let packageVersionPublished = null;
    let needsPublish = true;
    let tagSetDuringPublish = false; // Track if tag was set during npm publish
    try {
        {
            try {
                const cmd = `npm view ${packageJson.name}@${packageJson.version} version`;
                logger.info(`Checking if package is already published (${cmd})`);
                packageVersionPublished = execSync(cmd, {
                    cwd: packageDirectory,
                    stdio: 'pipe',
                    env: env
                }).toString().trim();
            }
            catch (error) {
                logger.warn(`Package version not found ${packageJson.name}@${packageJson.version}: ${error.message}`);
            }

            needsPublish = !packageVersionPublished || packageVersionPublished !== packageJson.version;
            if (!needsPublish) {
                logger.info(`💡 Package ${packageJson.name}@${packageJson.version} already published.`);
                if (webhook) {
                    await sendMessageToWebhook(webhook, `💡 **Package already published** \`${packageJson.name}@${packageJson.version}\`\n→ ${htmlUrlMarkdown}`, { logger });
                }
            }
            else {
                logger.info(`Package view result ${packageVersionPublished}`);


                const registryUrl = args.registry || 'https://registry.npmjs.org/';
                let cmd = `npm publish --access public --registry ${registryUrl}`

                // Handle provenance flag
                // Provenance only works with public repositories
                const isPrivateRepo = process.env.GITHUB_REPOSITORY_VISIBILITY === 'private';
                if (args.provenance === true || (args.useOidc && args.provenance !== false)) {
                    if (isPrivateRepo) {
                        logger.warn(`⚠ Provenance is not supported for private repositories. Skipping --provenance flag.`);
                    } else {
                        // Enable provenance to generate signed attestations linking the package to its source repo and build
                        cmd += ' --provenance';
                    }
                }
                if (dryRun) {
                    cmd += ' --dry-run';
                    logger.info(`Dry run mode enabled, not actually publishing package.`);
                }

                // Handle --tag flag for npm publish
                // Using --tag during publish works with both OIDC and token authentication
                const isPrereleaseVersion = packageJson.version.includes('-');
                if (args.tag) {
                    // User explicitly provided a tag - use it for publishing
                    logger.info(`Using tag '${args.tag}' for publishing.`);
                    cmd += ` --tag ${args.tag}`;
                } else if ((isPrereleaseVersion && args.setLatestTag == undefined) || args.setLatestTag === false) {
                    // Pre-release version without explicit tag - use 'dev' to avoid setting as 'latest'
                    const prereleaseTag = 'dev';
                    logger.info(`Package version is a pre-release version, using tag '${prereleaseTag}' for publishing.`);
                    cmd += ` --tag ${prereleaseTag}`;
                }

                const publishVersionString = packageJson.version;
                logger.info(`Publishing package ${packageJson.name}@${publishVersionString}: '${cmd}'`);
                // For OIDC: don't pass custom env - let npm inherit the full parent environment
                // This ensures all OIDC-related env vars are available to npm
                const execOptions = {
                    cwd: packageDirectory,
                    stdio: 'inherit',
                };
                if (!args.useOidc) {
                    execOptions.env = env;
                }
                const res = tryExecSync(cmd, execOptions);
                // If multiple workflows run at the same time it's possible that the package view command doenst find the package yet but the publish command fails with 403 and a message that the package already exists.
                if (!res.success
                    && (
                        res.output?.toString()?.includes(`You cannot publish over the previously published versions: ${publishVersionString}`) ||
                        res.output?.toString()?.includes(`Failed to save packument. A common cause is if you try to publish a new package before the previous package has been fully processed`)
                    )) {
                    logger.info(`💡 Package ${packageJson.name}@${publishVersionString} already exists, skipping publish.`);
                }
                else if (res.success) {
                    logger.info(`📦 Package ${packageJson.name}@${publishVersionString} published successfully: ${htmlUrl}`);
                    // Mark that tag was set during publish if --tag was used
                    if (args.tag && cmd.includes(`--tag ${args.tag}`)) {
                        tagSetDuringPublish = true;
                    }
                    if (webhook) {
                        await sendMessageToWebhook(webhook, `📦 **Package published successfully** \`${packageJson.name}@${publishVersionString}\`\n→ ${htmlUrlMarkdown}`, { logger });
                    }
                }
                else {
                    logger.error(`❌ Failed to publish package ${packageJson.name}@${packageJson.version}\n${res.error}`);

                    if (args.useOidc) {
                        const errorStr = res.error?.toString() || res.output?.toString() || '';
                        if (errorStr.includes('repository.url') || errorStr.includes('repository information')) {
                            logger.error(`\nOIDC: package.json needs a 'repository' field matching the GitHub repo`);
                        } else {
                            logger.error(`\nOIDC: Check trusted publisher config at https://www.npmjs.com/package/${packageJson.name}/access`);
                        }
                    }

                    if (webhook) {
                        let errorMsg = `❌ **Failed to publish package** \`${packageJson.name}@${packageJson.version}\`:`;
                        if (args.useOidc) {
                            // Extract org/repo from git remote URL
                            const repoMatch = repoUrl?.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
                            const workflowFile = process.env.GITHUB_WORKFLOW_REF?.split('@')[0]?.split('/').pop() || 'unknown';
                            errorMsg += `\n⚠️ OIDC failed. Configure [trusted publisher](<https://www.npmjs.com/package/${packageJson.name}/access>):`;
                            if (repoMatch) {
                                errorMsg += `\n• Owner: \`${repoMatch[1]}\``;
                                errorMsg += `\n• Repository: \`${repoMatch[2]}\``;
                            }
                            errorMsg += `\n• Workflow: \`${workflowFile}\``;
                        }
                        await sendMessageToWebhookWithCodeblock(webhook, errorMsg, res.error, { logger });
                    }
                    throw new Error(`Failed to publish package ${packageJson.name}@${packageJson.version}: ${res.error}`);
                }
            }
        }



        // set tag(s)
        // The primary tag (args.tag) may already have been applied via `npm publish --tag` above.
        // Any additional tags (and the primary one if publish didn't apply it) are set via `npm dist-tag add`.
        {
            if (dryRun) {
                if (tags.length > 0) logger.info(`Dry run mode enabled, not actually setting tag(s).`);
            }
            else {
                /** @type {string[]} */
                const tagsToApply = [];
                if (args.tag && !tagSetDuringPublish) tagsToApply.push(args.tag);
                for (const t of additionalTags) tagsToApply.push(t);

                // If the primary tag was already set during publish, still surface the success message.
                if (args.tag && tagSetDuringPublish) {
                    logger.info(`✅ Tag '${args.tag}' was already set during publish for ${packageJson.name}@${packageJson.version}`);
                    if (webhook) {
                        await sendMessageToWebhook(webhook, `✅ **Set ${registryName} tag** \`${args.tag}\` for package \`${packageJson.name}@${packageJson.version}\``, { logger });
                    }
                }

                if (tagsToApply.length > 0) {
                    /** @type {NodeJS.ProcessEnv} */
                    let distTagEnv = env;
                    if (args.useOidc) {
                        // Workaround for npm/cli#8547: `npm dist-tag add` does not support OIDC yet.
                        // Exchange the GitHub OIDC token once and reuse it for all dist-tag operations.
                        const exchange = await exchangeOidcForNpmToken({
                            packageName: packageJson.name,
                            registry: args.registry,
                            logger,
                        });
                        if (!exchange.success) {
                            logger.error(`Failed to obtain npm token via OIDC exchange for dist-tag: ${exchange.error}`);
                            if (webhook) {
                                await sendMessageToWebhookWithCodeblock(webhook, `❌ **Failed OIDC token exchange for dist-tag** on \`${packageJson.name}@${packageJson.version}\`:`, exchange.error, { logger });
                            }
                            throw new Error(`OIDC token exchange failed: ${exchange.error}`);
                        }
                        let registryUrlWithoutScheme = (args.registry || 'https://registry.npmjs.org/').replace(/https?:\/\//, '');
                        if (!registryUrlWithoutScheme.endsWith('/')) registryUrlWithoutScheme += '/';
                        // Inject the exchanged token via every channel npm might consult.
                        // - NODE_AUTH_TOKEN: substituted into the .npmrc that actions/setup-node@v4 writes
                        //   (`//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`). Without overriding this,
                        //   npm sees setup-node's placeholder ("XXXXX-XXXXX-XXXXX-XXXXX") and returns E401.
                        // - npm_config_*: direct config override for environments that don't use that .npmrc.
                        distTagEnv = {
                            ...env,
                            NODE_AUTH_TOKEN: exchange.token,
                            NPM_TOKEN: exchange.token,
                            [`npm_config_//${registryUrlWithoutScheme}:_authToken`]: exchange.token,
                        };
                    }

                    for (const tag of tagsToApply) {
                        const cmd = `npm dist-tag add ${packageJson.name}@${packageJson.version} ${tag} --loglevel verbose`;
                        logger.info(`Setting tag '${tag}' for package ${packageJson.name}@${packageJson.version} (${cmd})`);
                        const res = tryExecSync(cmd, { cwd: packageDirectory, env: distTagEnv });
                        if (res.success) {
                            logger.info(`Successfully set tag '${tag}' for package ${packageJson.name}@${packageJson.version}`);
                            if (webhook) {
                                await sendMessageToWebhook(webhook, `✅ **Set ${registryName} tag** \`${tag}\` for package \`${packageJson.name}@${packageJson.version}\``, { logger });
                            }
                        }
                        else {
                            logger.error(`Failed to set tag '${tag}' for package ${packageJson.name}@${packageJson.version}:${res.error}`);
                            if (webhook) {
                                await sendMessageToWebhookWithCodeblock(webhook, `❌ **Failed to set tag** \`${tag}\` for package \`${packageJson.name}@${packageJson.version}\`:`, res.error, { logger });
                            }
                        }
                    }
                }
            }
        }


        if (args.createGitTag) {

            let tagName = packageJson.version;

            if (args.createGitTagPrefix?.length) {
                if (!args.createGitTagPrefix?.endsWith("/") && !args.createGitTagPrefix?.endsWith("-")) {
                    logger.warn(`Git tag prefix '${args.createGitTagPrefix}' does not end with a slash or dash. Appending '/' to the prefix.`);
                    args.createGitTagPrefix += '/'; // ensure the prefix ends with a slash
                }
                tagName = `${args.createGitTagPrefix}${tagName}`; // use the prefix provided by the user
            }
            else {
                tagName = `release/${tagName}`; // default prefix if no prefix is provided
            }

            let cmd = `git tag -a ${tagName} -m "Published ${packageJson.version}" && git push origin ${tagName}`;

            // set username and email for git
            const gitUserName = process.env.GITHUB_ACTOR || process.env.GIT_USER_NAME || 'Needle Npm Publish';
            const gitUserEmail = process.env.GIT_USER_EMAIL || 'hi+git@needle.tools';
            cmd = `git config user.name "${gitUserName}" && git config user.email "${gitUserEmail}" && ${cmd}`;

            logger.info(`Creating git tag with command: ${cmd}`);
            const res = tryExecSync(cmd, {
                cwd: packageDirectory,
                env: env
            });
            if (res.success) {
                logger.info(`✅ Successfully created git tag: ${packageJson.version}`);
                if (webhook) {
                    await sendMessageToWebhook(webhook, `✅ **Created git tag** \`${tagName}\` for package \`${packageJson.name}\``, { logger });
                }
            }
            else {
                const isTagPointingToThisCommit = res.output.includes(`${tagName} -> ${tagName} (already exists)`);
                if (isTagPointingToThisCommit && res.output?.includes("Updates were rejected because the tag already exists in the remote.")) {
                    logger.info(`💡 Git tag ${packageJson.version} already exists, skipping creation.\n\`\`\`\n${res.error || res.output}\n\`\`\``);
                    if (webhook) {
                        await sendMessageToWebhook(webhook, `💡 **Git tag already exists** \`${tagName}\` for package \`${packageJson.name}\``, { logger });
                    }
                }
                else {
                    logger.error(`❌ Failed to create git tag: ${res.error}`);
                    const errorStr = res.error?.toString() || res.output?.toString() || '';
                    let errorMsg = `❌ **Failed to create git tag** \`${tagName}\`:`;
                    if (errorStr.includes('Permission') || errorStr.includes('denied') || errorStr.includes('403')) {
                        errorMsg += `\n⚠️ Add \`contents: write\` permission to your workflow`;
                    }
                    if (webhook) {
                        await sendMessageToWebhookWithCodeblock(webhook, errorMsg, res.error, { logger });
                    }
                }
            }
        }

        logger.info(`✅ Publish process completed for package ${packageJson.name}@${packageJson.version}`);
    }
    finally {
        // Restore original package.json
        logger.info(`♻ Restoring original package.json at ${packageJsonPath}`);
        writeFileSync(packageJsonPath, _originalPackageJson, 'utf-8');


        // Write outputs for CI
        tryWriteOutputForCI("package-version", packageJson.version, { logger });
        tryWriteOutputForCI("package-name", packageJson.name, { logger });
        tryWriteOutputForCI("package-published", needsPublish, { logger });
    }
}



/**
 * Processes the package.json file to replace local dependencies with their current versions.
 * @param {string} packageJsonDirectory - The directory where the package.json file is located.
 * @param {import('../types').PackageJson} packageJson - The package.json object to process.
 * @param {{logger:import('@caporal/core').Logger}} args
 */
function processPackageJson(packageJsonDirectory, packageJson, args) {

    let modified = false;

    if (packageJson.dependencies) {
        replaceLocalPathWithVersion(packageJson.dependencies);
    }
    if (packageJson.devDependencies) {
        replaceLocalPathWithVersion(packageJson.devDependencies);
    }
    if (packageJson.peerDependencies) {
        replaceLocalPathWithVersion(packageJson.peerDependencies);
    }
    if (packageJson.optionalDependencies) {
        replaceLocalPathWithVersion(packageJson.optionalDependencies);
    }

    if (modified) {
        args.logger.info(`[${packageJson.name}]: Modified package.json to replace local paths with versions.`);
        writeFileSync(resolve(packageJsonDirectory, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf-8');
    }

    /**
     * @param {Record<string, string>} object
     */
    function replaceLocalPathWithVersion(object) {
        for (const [key, value] of Object.entries(object)) {
            if (value.startsWith('file:')) {
                const localpath = value.substring("file:".length).trim();
                const localPackageJsonPath = resolve(packageJsonDirectory, localpath, 'package.json');
                if (!existsSync(localPackageJsonPath)) {
                    args.logger.warn(`[${packageJson.name}]: Dependency '${key}' is a local path '${localpath}' but no package.json found at ${localPackageJsonPath}. Keeping as is.`);
                    continue;
                }
                const localPackageJson = JSON.parse(readFileSync(localPackageJsonPath, 'utf-8'));
                if (localPackageJson.version) {
                    modified = true;
                    args.logger.info(`[${packageJson.name}]: Replacing dependency '${key}' with version '${localPackageJson.version}' (from ${localPackageJsonPath})`);
                    object[key] = localPackageJson.version;
                } else {
                    args.logger.warn(`[${packageJson.name}]: Dependency '${key}' is a local path but has no version in ${localPackageJsonPath}. Keeping as is.`);
                }

            }
        }
    }
}
