import { execSync } from 'child_process';
import { appendFileSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { sendMessageToWebhook } from './webhooks.js';
import { tryExecSync } from './utils.js';


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
    const shortSha = tryExecSync('git rev-parse --short HEAD', { cwd: packageDirectory });
    const repoUrl = tryExecSync('git config --get remote.origin.url', { cwd: packageDirectory });

    logger.info(`Package: ${packageJson.name}@${packageJson.version}`);
    logger.info(`Build time: ${buildTime}`);
    logger.info(`Short SHA: ${shortSha}`);

    if (webhook) {
        await sendMessageToWebhook(webhook, `📦 Publishing package ${packageJson.name}@${packageJson.version} to registry ${args.registry} with tag ${args.tag || '-'}\nBuild time: ${buildTime}\nShort SHA: ${shortSha}\nRepository: ${repoUrl}`);
    }

    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `build-time=${buildTime}\n`);
    }

    switch (args.tag) {
        case "stable":
            break;
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
                const cmd = `npm version ${nextVersion} --no-git-tag-version`;
                logger.info(`Setting version to ${nextVersion} with command: ${cmd}`);
                execSync(cmd, { cwd: packageDirectory });
                packageJson.version = nextVersion;
            }
            break;
    }

    logger.info(`Publishing package ${packageJson.name}@${packageJson.version} to registry ${args.registry} with tag ${args.tag || 'latest'}`);
    let packageVersionPublished = null;
    try {
        const cmd = `npm view ${packageJson.name}@${packageJson.version} version --registry ${args.registry}`;
        logger.info(`Checking if package is already published (${cmd})`);
        packageVersionPublished = execSync(cmd, {
            cwd: packageDirectory,
            stdio: 'pipe'
        }).toString().trim();
    }
    catch (error) {
        logger.warn(`Package version not found ${packageJson.name}@${packageJson.version}: ${error.message}`);
    }

    const needsPublish = !packageVersionPublished || packageVersionPublished !== packageJson.version;
    if (!needsPublish) {
        logger.info(`Package ${packageJson.name}@${packageJson.version} already published.`);
    }
    else {
        const cmd = `npm publish --registry ${args.registry}`;
        logger.info(`Publishing package ${packageJson.name}@${packageJson.version} (${cmd})`);
        execSync(cmd, { cwd: packageDirectory });
        logger.info(`Package ${packageJson.name}@${packageJson.version} published successfully.`);
        if (webhook) {
            await sendMessageToWebhook(webhook, `📦 Package ${packageJson.name}@${packageJson.version} published successfully to registry ${args.registry} with tag ${args.tag || '-'}`);
        }
    }

    // set tag
    if (args.tag) {
        const cmd = `npm dist-tag add ${packageJson.name}@${packageJson.version} ${args.tag} --registry ${args.registry}`;
        logger.info(`Setting tag ${args.tag} for package ${packageJson.name}@${packageJson.version} (${cmd})`);
        execSync(cmd, { cwd: packageDirectory });
        logger.info(`Tag ${args.tag} set for package ${packageJson.name}@${packageJson.version}.`);
    }

    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `package-version=${packageJson.version}\n`);
        appendFileSync(process.env.GITHUB_OUTPUT, `package-name=${packageJson.name}\n`);
        appendFileSync(process.env.GITHUB_OUTPUT, `package-published=${needsPublish}\n`);
    }
}
