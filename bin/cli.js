#!/usr/bin/env node

import caporal from '@caporal/core';
import { updateNpmdef } from "../src/npmdef.js";
import { build, compile } from '../src/compile.js';
import { publish } from '../src/publish.js';
import { sendMessageToWebhook } from '../src/webhooks.js';


export const program = caporal.program;
program.description('Needle Publish Helper');


program.command("send-webhook-message", "Send a message to a webhook")
    .argument("<webhook>", "Webhook URL", { validator: program.STRING })
    .argument("<message>", "Message to send", { validator: program.STRING })
    .action(async ({ logger, args }) => {
        const webhookUrl = args.webhook.toString();
        const message = args.message.toString();
        await sendMessageToWebhook(webhookUrl, message, {
            logger
        })
    });


program.command('update-npmdef', 'Update npmdef files')
    .action(async () => {
        await updateNpmdef();
    });

program.command('compile-library', 'Compile library')
    .option('--library <library>', 'Library name', { required: false, validator: program.STRING })
    .action(async ({ logger, options }) => {
        await build({
            name: options.library?.toString(),
            logger
        });
    });

program.command('prepare-publish', 'Compile and update')
    .configure({ visible: false, strictOptions: false })
    .option('--library <library>', 'Library name', { required: false, validator: program.STRING })
    .action(async ({ logger, args, options }) => {
        await updateNpmdef();
        await build({
            name: options.library?.toString(),
            logger
        });
        await compile({ logger });
    });



program.command('publish', 'Publish npm package')
    .argument('<directory>', 'Directory to publish', { validator: program.STRING })
    .option("--registry <registry>", "NPM registry to use", { required: false, validator: program.STRING })
    .option("--tag <tag>", "NPM tag to create/update", { required: false, validator: program.STRING })
    // .option("--set-latest-tag", "Update the 'latest' tag to the new version (default: undefined). If this option is not defined then the latest tag will only be automatically updated for stable versions (aka non pre-release versions)", { required: false, validator: program.BOOLEAN, default: false })
    .option("--version+hash", "Include hash in version (default: false)", { required: false, validator: program.BOOLEAN, default: undefined })
    .option("--version+tag", "Include tag in version (default: false)", { required: false, validator: program.BOOLEAN, default: false })
    .option("--create-tag", "Create a git tag. Default: null. Can be set to e.g. '--create-tag release/'", { required: false, validator: program.STRING })
    .option("--webhook <webhook>", "Webhook URL to send notifications", { required: false, validator: program.STRING })
    .option("--access-token <access-token>", "NPM access token", { required: false, validator: program.STRING })
    .option("--dry-run", "Dry run mode, do not publish", { required: false, validator: program.BOOLEAN, default: false })
    .option("--override-name <name>", "Override package name", { required: false, validator: program.STRING })
    .option("--override-version <version>", "Override package version", { required: false, validator: program.STRING })
    // .option("--exec-before", "Allow running a command before publishing (e.g. 'npm run ...')", { required: false, validator: program.STRING })
    .action(async ({ logger, args, options }) => {
        const directory = (args.directory || process.cwd()).toString();
        const registry = (options.registry || 'https://registry.npmjs.org/').toString();
        const tag = options.tag?.toString() || null;
        if (options.createTag === "true") {
            options.createTag = '';
        }
        await publish({
            logger: logger,
            packageDirectory: directory,
            registry: registry,
            accessToken: options.accessToken?.toString() || null,
            useHashInVersion: options.versionHash === true, // default to false
            useTagInVersion: options.versionTag === true, // default to false
            createGitTag: options.createTag !== undefined, // default to false
            createGitTagPrefix: options.createTag !== undefined ? options.createTag.toString() : null,
            dryRun: options.dryRun === true,
            tag: tag,
            setLatestTag: undefined, //options.setLatestTag === undefined ? undefined : options.setLatestTag === true,
            webhookUrl: options.webhook?.toString() || null,
            overrideName: options.overrideName?.toString() || null,
            overrideVersion: options.overrideVersion?.toString() || null,
        });
    });



program.run();