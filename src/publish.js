import { execSync } from 'child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { sendMessageToWebhook } from './webhooks.js';
import { obfuscateToken, tryExecSync } from './utils.js';


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
    logger.info(`Publishing package in ${packageDirectory} (exists: ${packageExists})`);
    if (!packageExists) {
        throw new Error(`No package.json found at ${packageJsonPath}`);
    }

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

    logger.info(`Package: ${packageJson.name}@${packageJson.version}`);
    logger.info(`Build time: ${buildTime}`);
    logger.info(`Short SHA: ${shortSha}`);
    logger.info(`Token: '${obfuscateToken(args.accessToken)}'`);

    if (!args.accessToken?.length) {
        logger.warn(`No access token provided. Publishing to registry ${args.registry} may fail.`);
    }

    if (webhook) {
        let msg = `📦 **Publish package** \`${packageJson.name}\`\n`;
        msg += "```\n";
        msg += `Build time: ${buildTime}\n`;
        msg += `Short SHA: ${shortSha}\n`;
        msg += `Repository: ${repoUrl}\n`;
        msg += `Registry: ${args.registry}\n`;
        msg += `Token: ${obfuscateToken(args.accessToken)}\n`;
        msg += "```";
        await sendMessageToWebhook(webhook, msg);
    }

    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `build-time=${buildTime}\n`);
    }


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

    const htmlUrl = args.registry?.includes("npmjs") ? `https://www.npmjs.com/package/${packageJson.name}` : (args.registry + `/${packageJson.name}`);

    // publish package
    let packageVersionPublished = null;
    let needsPublish = false;
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
                await sendMessageToWebhook(webhook, `💡 **Package already published** \`${packageJson.name}@${packageJson.version}\` at [${htmlUrl}](<${htmlUrl}>)`);
            }
        }
        else {
            let cmd = `npm publish --access public`
            if (dryRun) {
                cmd += ' --dry-run';
                logger.info(`Dry run mode enabled, not actually publishing package.`);
            }
            logger.info(`Publishing package ${packageJson.name}@${packageJson.version}: '${cmd}'`);
            const res = tryExecSync(cmd, {
                cwd: packageDirectory,
                env: env
            });
            if (res.success) {
                logger.info(`📦 Package ${packageJson.name}@${packageJson.version} published successfully: ${htmlUrl}`);
                if (webhook) {
                    await sendMessageToWebhook(webhook, `📦 **Package published successfully** \`${packageJson.name}@${packageJson.version}\` to [${htmlUrl}](<${htmlUrl}>)`);
                }
            }
            else {
                logger.error(`❌ Failed to publish package ${packageJson.name}@${packageJson.version}: ${res}`);
                if (webhook) {
                    await sendMessageToWebhook(webhook, `❌ **Failed to publish package** \`${packageJson.name}@${packageJson.version}\`: ${res.error}`);
                }
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
                    await sendMessageToWebhook(webhook, `✅ **Set tag** \`${args.tag}\` for package \`${packageJson.name}@${packageJson.version}\``);
                }
            }
            else {
                logger.error(`Failed to set tag '${args.tag}' for package ${packageJson.name}@${packageJson.version}: ${res.error}`);
                if (webhook) {
                    await sendMessageToWebhook(webhook, `❌ **Failed to set tag** \`${args.tag}\` for package \`${packageJson.name}@${packageJson.version}\`: ${res.error}`);
                }
            }
        }
    }



    // Restore original package.json
    logger.info(`♻ Restoring original package.json at ${packageJsonPath}`);
    writeFileSync(packageJsonPath, _originalPackageJson, 'utf-8');


    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `package-version=${packageJson.version}\n`);
        appendFileSync(process.env.GITHUB_OUTPUT, `package-name=${packageJson.name}\n`);
        appendFileSync(process.env.GITHUB_OUTPUT, `package-published=${needsPublish}\n`);
    }
}
