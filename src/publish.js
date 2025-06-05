import { execSync } from 'child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { sendMessageToWebhook, sendMessageToWebhookWithError } from './webhooks.js';
import { createCodeBlocks, obfuscateToken, tryExecSync, tryWriteOutputForCI } from './utils.js';


/**
 * @param {import('../types').PublishOptions} args
 */
export async function publish(args) {

    const logger = args.logger;
    const webhook = args.webhookUrl;
    const packageDirectory = resolve(args.packageDirectory || process.cwd());
    const packageJsonPath = `${packageDirectory}/package.json`;
    const dryRun = args.dryRun || false;

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

    processPackageJson(packageDirectory, packageJson, { logger });

    if (webhook) {
        let msg = `📦 **Publish package** \`${packageJson.name}\`\n`;
        msg += "```\n";
        msg += `Repository: ${repoUrl}\n`;
        msg += `Short SHA: ${shortSha}${args.useTagInVersion ? ' (version+hash)' : ''}\n`;
        msg += `Committer : ${commitAuthorWithEmail}\n`;
        msg += `Commit: ${commitMessage.substring(0, 500)}\n`;
        msg += `Build time: ${buildTime}\n`;
        msg += `Registry: ${args.registry}\n`;
        msg += `Token: ${obfuscateToken(args.accessToken)}\n`;
        msg += `Tag: ${args.tag || '-'}${args.useTagInVersion ? ' (version+tag)' : ''}${args.createGitTag ? ' (creating git tag)' : ''}\n`;
        msg += "```";
        await sendMessageToWebhook(webhook, msg, { logger });
    }

    tryWriteOutputForCI("build-time", buildTime, { logger });

    // Update package version
    {
        const currentVersion = packageJson.version;
        let isPrerelease = packageJson.version.includes('-');
        // Replace the pre-release tag if it exists
        if (isPrerelease) {
            const dashIndex = packageJson.version.indexOf('-');
            packageJson.version = packageJson.version.substring(0, dashIndex)
        }
        let nextVersion = `${packageJson.version}`;
        if (args.useTagInVersion && args.tag && args.tag !== "latest") {
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
            logger.info(`Updating package version to ${nextVersion} with command: ${cmd}`);
            execSync(cmd, { cwd: packageDirectory });
        }
        // ensure the version is set correctly (it might have been modified in the meantime)
        packageJson.version = nextVersion;
        logger.info(`Updated package version to ${packageJson.version}`);
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
                    await sendMessageToWebhookWithError(webhook, `❌ **Failed to publish package** \`${packageJson.name}@${packageJson.version}\`:`, res.error, { logger });
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
                    await sendMessageToWebhookWithError(webhook, `❌ **Failed to set tag** \`${args.tag}\` for package \`${packageJson.name}@${packageJson.version}\`:`, res.error, { logger });
                }
            }
        }
    }



    // Restore original package.json
    logger.info(`♻ Restoring original package.json at ${packageJsonPath}`);
    writeFileSync(packageJsonPath, _originalPackageJson, 'utf-8');

    if (args.createGitTag) {

        let tagName = packageJson.version;
        // if (args.tag) {
        //     tagName = `${args.tag}/${tagName}`;
        // }
        tagName = "release/" + tagName; // prefix with 'release/' to avoid conflicts with other tags
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
                await sendMessageToWebhook(webhook, `✅ **Created git tag** \`${packageJson.version}\` for package \`${packageJson.name}\``, { logger });
            }
        }
        else {
            const isTagPointingToThisCommit = res.output.includes(`${tagName} -> ${tagName} (already exists)`);
            if (isTagPointingToThisCommit && res.output?.includes("Updates were rejected because the tag already exists in the remote.")) {
                logger.info(`💡 Git tag ${packageJson.version} already exists, skipping creation.\n\`\`\`\n${res.error || res.output}\n\`\`\``);
                if (webhook) {
                    await sendMessageToWebhook(webhook, `💡 **Git tag already exists** \`${packageJson.version}\` for package \`${packageJson.name}\``, { logger });
                }
            }
            else {
                logger.error(`❌ Failed to create git tag: ${res.error}`);
                if (webhook) {
                    await sendMessageToWebhookWithError(webhook, `❌ **Failed to create git tag** \`${packageJson.version}\`:`, res.error, { logger });
                }
            }
        }
    }

    
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
