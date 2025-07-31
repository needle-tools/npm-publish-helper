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
    logger.info(`Token: '${obfuscateToken(args.accessToken)}'`);
    logger.info(`Repository: ${repoUrl}`);
    logger.info(`Last commit message: ${commitMessage}`);
    logger.info(`Last commit author: ${commitAuthorWithEmail}`);
    logger.info(`Registry: ${args.registry || 'https://registry.npmjs.org/'}`);

    if (!args.accessToken?.length) {
        logger.warn(`No access token provided. Publishing to registry ${args.registry} may fail.`);
    }

    // Remove slahes from the end of the tag (this may happen if the tag is provided by github ref_name
    if (args.tag?.includes("/")) {
        logger.warn(`Tag '${args.tag}' contains slashes - using last part as tag.`);
        const parts = args.tag.split('/');
        let found = false;
        for (let i = parts.length - 1; i >= 0; i--) {
            if (parts[i].length > 0) {
                found = true;
                args.tag = parts[i];
                break;
            }
        }
        if (!found) {
            throw new Error(`Tag '${args.tag}' is not valid`);
        }
    }


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

    if (webhook) {
        const commitMessageOneLiner = commitMessage?.trim().replaceAll("\n", " ");
        const commitUrl = event_data?.compare || `${repoUrl}/commit/${shortSha}`;
        let msg = `🐱‍💻 **Publish package** \`${packageJson.name}\` – [commit](<${commitUrl}>)\n`;
        msg += "```\n";
        msg += `Repository: ${repoUrl}\n`;
        msg += `Short SHA: ${shortSha}${args.useTagInVersion ? ' (version+hash)' : ''}\n`;
        msg += `Committer : ${commitAuthorWithEmail}\n`;
        msg += `Commit: "${commitMessageOneLiner?.length > 254 ? (commitMessageOneLiner.substring(0, 254) + "...") : commitMessageOneLiner}"\n`.replaceAll("`", "'");
        msg += `Commit URL: ${repoUrl}/commit/${shortSha}\n`;
        msg += `Build time: ${buildTime}\n`;
        msg += `Registry: ${args.registry}\n`;
        msg += `Token: ${obfuscateToken(args.accessToken)}\n`;
        msg += `Tag: ${args.tag || '-'}${args.useTagInVersion ? ' (version+tag)' : ''}${args.createGitTag ? ' (creating git tag)' : ''}\n`;
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
        NPM_TOKEN: args.accessToken || undefined,
        NPM_CONFIG_REGISTRY: (args.registry || 'https://registry.npmjs.org/'),
    }


    // set config
    {
        const registryUrlWithoutScheme = (args.registry || 'https://registry.npmjs.org/').replace(/https?:\/\//, '');
        const configCmd = `npm config set //${registryUrlWithoutScheme}:_authToken ${env.NPM_TOKEN}`;
        logger.info(`Setting npm config to registry //${registryUrlWithoutScheme}`);
        execSync(configCmd, {
            cwd: packageDirectory,
            env
        });
    }

    const htmlUrl = args.registry?.includes("npmjs") ? `https://www.npmjs.com/package/${packageJson.name}/v/${packageJson.version}` : (args.registry + `/${packageJson.name}`);
    const htmlUrlMarkdown = `[${registryName}/${packageJson.name}@${packageJson.version}](<${htmlUrl}>)`;

    // publish package
    let packageVersionPublished = null;
    let needsPublish = true;
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


            let cmd = `npm publish --access public`
            if (dryRun) {
                cmd += ' --dry-run';
                logger.info(`Dry run mode enabled, not actually publishing package.`);
            }

            // If the package is a pre-release version, we can use a tag to publish it because we don't want npm to automatically set the tag to 'latest'.
            const isPrereleaseVersion = packageJson.version.includes('-');
            if ((isPrereleaseVersion && args.setLatestTag == undefined) || args.setLatestTag === false) {
                const prereleaseTag = args.tag || 'dev';
                logger.info(`Package version is a pre-release version, using tag '${prereleaseTag}' for publishing.`);
                cmd += ` --tag ${prereleaseTag}`;
            }

            const publishVersionString = packageJson.version;
            logger.info(`Publishing package ${packageJson.name}@${publishVersionString}: '${cmd}'`);
            const res = tryExecSync(cmd, {
                cwd: packageDirectory,
                env: env
            });
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
                if (webhook) {
                    await sendMessageToWebhook(webhook, `📦 **Package published successfully** \`${packageJson.name}@${publishVersionString}\`\n→ ${htmlUrlMarkdown}`, { logger });
                }
            }
            else {
                logger.error(`❌ Failed to publish package ${packageJson.name}@${packageJson.version}\n${res.error}`);
                if (webhook) {
                    await sendMessageToWebhookWithCodeblock(webhook, `❌ **Failed to publish package** \`${packageJson.name}@${packageJson.version}\`:`, res.error, { logger });
                }
                throw new Error(`Failed to publish package ${packageJson.name}@${packageJson.version}: ${res.error}`);
            }
        }
    }



    // set tag
    {
        if (dryRun) {
            logger.info(`Dry run mode enabled, not actually setting tag.`);
        }
        else if (args.tag) {
            const cmd = `npm dist-tag add ${packageJson.name}@${packageJson.version} ${args.tag}`;
            logger.info(`Setting tag '${args.tag}' for package ${packageJson.name}@${packageJson.version} (${cmd})`);
            const res = tryExecSync(cmd, {
                cwd: packageDirectory,
                env: env
            });
            if (res.success) {
                logger.info(`Successfully set tag '${args.tag}' for package ${packageJson.name}@${packageJson.version}`);
                if (webhook) {
                    await sendMessageToWebhook(webhook, `✅ **Set ${registryName} tag** \`${args.tag}\` for package \`${packageJson.name}@${packageJson.version}\``, { logger });
                }
            }
            else {
                logger.error(`Failed to set tag '${args.tag}' for package ${packageJson.name}@${packageJson.version}:${res.error}`);
                if (webhook) {
                    await sendMessageToWebhookWithCodeblock(webhook, `❌ **Failed to set tag** \`${args.tag}\` for package \`${packageJson.name}@${packageJson.version}\`:`, res.error, { logger });
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
                if (webhook) {
                    await sendMessageToWebhookWithCodeblock(webhook, `❌ **Failed to create git tag** \`${tagName}\`:`, res.error, { logger });
                }
            }
        }
    }


    // Restore original package.json
    logger.info(`♻ Restoring original package.json at ${packageJsonPath}`);
    writeFileSync(packageJsonPath, _originalPackageJson, 'utf-8');


    // Write outputs for CI
    tryWriteOutputForCI("package-version", packageJson.version, { logger });
    tryWriteOutputForCI("package-name", packageJson.name, { logger });
    tryWriteOutputForCI("package-published", needsPublish, { logger });


    logger.info(`✅ Publish process completed for package ${packageJson.name}@${packageJson.version}`);
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
