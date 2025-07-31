#!/usr/bin/env node

import caporal from '@caporal/core';
import { updateNpmdef } from "../src/npmdef.js";
import { build, compile } from '../src/compile.js';
import { sendMessageToWebhook, sendMessageToWebhookWithCodeblock } from '../src/webhooks.js';
import { runLLM } from '../src/utils.llm.js';


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
    .action(async ({ logger }) => {
        await updateNpmdef({ logger });
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
        logger.info('Preparing package to publish...');
        await updateNpmdef({ logger });
        await compile({ logger });
        await build({
            name: options.library?.toString(),
            logger
        });
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
    .option("--llm-api-key <api-key>", "LLM API key for summarization", { required: false, validator: program.STRING })
    .option("--prepare-package", "Prepare the package for publishing (compile, update npmdef, build dist)", { required: false, validator: program.BOOLEAN, default: false })
    .action(async ({ logger, args, options }) => {
        const { publish } = await import('../src/publish.js');
        const directory = (args.directory || process.cwd()).toString();
        const registry = (options.registry || 'https://registry.npmjs.org/').toString();
        const tag = options.tag?.toString() || null;
        if (options.createTag === "true") {
            options.createTag = '';
        }
        const preparePackage = options.preparePackage === true;
        await publish({
            logger: logger,
            packageDirectory: directory,

            updateNpmdef: preparePackage,
            compileTsc: preparePackage,
            compileDist: preparePackage,

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
            llm: {
                apiKey: options.llmApiKey?.toString() || null
            }
        });
    });


program.command("repository-dispatch", "Invoke a repository dispatch event to trigger a workflow")
    .option("--access-token <access-token>", "Access token to use for the dispatch event.\nA fine-grained access token to give access to the repositories you want to invoke the workflow for.\nPermissions required: Actions=read/write, Contents=read/write", { required: true, validator: program.STRING })
    .option("--repository <repository>", "Repository to invoke the dispatch event in", { required: true, validator: program.STRING })
    .option("--workflow <workflow>", "Workflow filename or id to invoke", { required: true, validator: program.STRING })
    .option("--ref <ref>", "Git reference (branch, tag, etc.) to use for the dispatch event", { required: false, validator: program.STRING, default: 'main' })
    .option("--webhook <webhook>", "Webhook URL to send notifications", { required: false, validator: program.STRING })
    .option("--inputs <inputs>", "Inputs to pass to the workflow (JSON string)", { required: false, validator: program.STRING, default: '{}' })
    .action(async ({ logger, options }) => {
        const { invokeRepositoryDispatch } = await import('../src/utils.js');
        const res = await invokeRepositoryDispatch({
            accessToken: options.accessToken.toString(),
            repository: options.repository.toString(),
            ref: options.ref?.toString(),
            workflow: options.workflow.toString(),
            logger,
            inputs: options.inputs ? JSON.parse(options.inputs.toString()) : {},
            webhookUrl: options.webhook?.toString() || null
        });
        if (!res.success) {
            logger.error(`Failed to invoke repository dispatch: ${res.error}`);
        } else {
            logger.info(`Repository dispatch invoked successfully for workflow: ${options.workflow}`);
        }
    });


program.command('diff', 'Get git changes')
    .configure({ visible: false, strictOptions: false })
    .argument('<directory>', 'Directory to publish', { validator: program.STRING })
    .option('--debug', 'Enable debug logging', { required: false, validator: program.BOOLEAN, default: false })
    .option('--start-time <start_time>', 'Start time for the diff (ISO format)', { required: false, validator: program.STRING, default: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() })
    .option('--end-time <end_time>', 'End time for the diff (ISO format)', { required: false, validator: program.STRING, default: new Date().toISOString() })
    .option('--llm-api-key <llm_api_key>', 'LLM API key for summarization', { required: false, validator: program.STRING })
    .option('--webhook <webhook>', 'Webhook URL to send notifications', { required: false, validator: program.STRING })
    .action(async ({ logger, args, options }) => {
        logger.silent = !options.debug; // Set logger silent mode based on debug option
        if (options.debug) logger.level = "debug";
        const { getDiffSince } = await import('../src/utils.git.js');
        const directory = args.directory.toString();
        const startTime = options.startTime.toString();
        const endTime = options.endTime.toString();
        const llm_api_key = options.llmApiKey?.toString() || null;
        const diff = await getDiffSince(directory, {
            logger,
            startTime: startTime,
            endTime: endTime,
            includeCommitInformation: true,
        });
        if (diff === null) {
            logger.error('No changes found or an error occurred while fetching the diff.');
            if (options.webhook) {
                await sendMessageToWebhook(options.webhook.toString(), "No changes found or an error occurred while fetching the diff.", { logger });
            }
            return;
        }
        if (llm_api_key) {
            if (options.debug) {
                console.log(diff);
                await sendMessageToWebhookWithCodeblock(options.webhook?.toString(), "Diff", diff, { logger });
            }
            const summary = await runLLM({
                prompt: "Summarize the changes made to the repository in prose. Group similar changes together. Don't make lists. Don't include any description of your own. Include code snippets and examples. Include author names.",
            }, diff, {
                api_key: llm_api_key,
                logger: logger
            });
            if (summary.success) {
                console.log(summary.summary);
                if (options.webhook) {
                    await sendMessageToWebhook(options.webhook.toString(), summary.summary, {
                        logger
                    });
                }
            } else {
                logger.error(`Failed to summarize the diff: ${summary.error}`);
                if (options.webhook) {
                    await sendMessageToWebhookWithCodeblock(options.webhook.toString(), `Diff LLM summary failed`, summary.error, {
                        logger
                    });
                }
                process.exit(1);
            }
        }
        else {
            console.log(diff);
        }
        process.exit(0);
    });


program.run();