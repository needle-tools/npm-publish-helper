import { execSync } from 'child_process';
import { appendFileSync, existsSync, readFileSync } from 'fs';
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

    const packageExists = existsSync(packageJsonPath);
    logger.info(`Publishing package in ${packageDirectory} (exists: ${packageExists})`);
    if (!packageExists) {
        throw new Error(`No package.json found at ${packageJsonPath}`);
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
        await sendMessageToWebhook(webhook, `📦 Publishing package ${packageJson.name}@${packageJson.version} to registry ${args.registry} with tag ${args.tag || '-'}\nBuild time: ${buildTime}\nShort SHA: ${shortSha}\nRepository: ${repoUrl}`);
    }

    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `build-time=${buildTime}\n`);
    }

    switch (args.tag) {
        case "latest":
            // don't change the version, just ensure it's set to latest
            break;
        default:
        case "next":
        case "canary":
        case "beta":
        case "alpha":
            const currentVersion = packageJson.version;
            let isPrerelease = packageJson.version.includes('-');
            // Replace the pre-release tag if it exists
            if (isPrerelease) {
                const dashIndex = packageJson.version.indexOf('-');
                packageJson.version = packageJson.version.substring(0, dashIndex)
            }
            let nextVersion = `${packageJson.version}-${args.tag}`;
            if (shortSha) {
                nextVersion += `.${shortSha}`;
            }
            if (currentVersion !== nextVersion) {
                // the package version can only be updated if it's different
                const cmd = `npm version ${nextVersion} --no-git-tag-version`;
                logger.info(`Updating package version to ${nextVersion} with command: ${cmd}`);
                execSync(cmd, { cwd: packageDirectory });
            }
            // ensure the version is set correctly (it might have been modified in the meantime)
            packageJson.version = nextVersion;
            break;
    }

    const env = {
        ...process.env,
        NPM_TOKEN: args.accessToken || undefined,
        NPM_CONFIG_REGISTRY: (args.registry || 'https://registry.npmjs.org/'),
    }

    // set config
    const registryUrlWithoutScheme = (args.registry || 'https://registry.npmjs.org/').replace(/https?:\/\//, '');
    const configCmd = `npm config set //${registryUrlWithoutScheme}:_authToken ${env.NPM_TOKEN}`;
    logger.info(`Setting npm config to registry //${registryUrlWithoutScheme}`);
    execSync(configCmd, {
        cwd: packageDirectory,
        env
    });


    let packageVersionPublished = null;
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

    const needsPublish = !packageVersionPublished || packageVersionPublished !== packageJson.version;


    if (!needsPublish) {
        logger.info(`💡 Package ${packageJson.name}@${packageJson.version} already published.`);
    }
    else {
        const cmd = `npm publish --access public`;
        logger.info(`Publishing package ${packageJson.name}@${packageJson.version}: '${cmd}'`);
        const res = tryExecSync(cmd, {
            cwd: packageDirectory,
            env: env
        });
        if (res.success) {
            logger.info(`📦 Package ${packageJson.name}@${packageJson.version} published successfully.`);
            if (webhook) {
                await sendMessageToWebhook(webhook, `📦 Package ${packageJson.name}@${packageJson.version} published successfully to registry ${args.registry} with tag ${args.tag || '-'}`);
            }
        }
        else {
            logger.error(`❌ Failed to publish package ${packageJson.name}@${packageJson.version}: ${res}`);
            if (webhook) {
                await sendMessageToWebhook(webhook, `❌ Failed to publish package ${packageJson.name}@${packageJson.version} to registry ${args.registry} with tag ${args.tag || '-'}`);
            }
        }
    }

    // set tag
    if (args.tag) {
        const cmd = `npm dist-tag add ${packageJson.name}@${packageJson.version} ${args.tag}`;
        logger.info(`Setting tag '${args.tag}' for package ${packageJson.name}@${packageJson.version} (${cmd})`);
        const res = tryExecSync(cmd, {
            cwd: packageDirectory,
            env: env
        });
        if (res.success) {
            logger.info(`Successfully set tag '${args.tag}' for package ${packageJson.name}@${packageJson.version}`);
        }
        else {
            logger.error(`Failed to set tag '${args.tag}' for package ${packageJson.name}@${packageJson.version}: ${res.error}`);
        }
    }

    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `package-version=${packageJson.version}\n`);
        appendFileSync(process.env.GITHUB_OUTPUT, `package-name=${packageJson.name}\n`);
        appendFileSync(process.env.GITHUB_OUTPUT, `package-published=${needsPublish}\n`);
    }
}
