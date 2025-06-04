#!/usr/bin/env node

import caporal from '@caporal/core';

import { updateNpmdef } from "./src/npmdef.js";
import { build, compile } from './src/compile.js';
import { publish } from './src/publish.js';


export const program = caporal.program;
program.description('Npm Publish Helper');

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

program.defaultCommand = program.command('default', 'Compile and update')
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
    .option("--commit-hash", "Use commit hash in version (default: false)", { required: false, validator: program.BOOLEAN, default: false })
    .option("--tag <tag>", "NPM tag to use", { required: false, validator: program.STRING })
    .option("--use-tag-in-version", "Include tag in version (default: true)", { required: false, validator: program.BOOLEAN, default: true })
    .option("--webhook <webhook>", "Webhook URL to send notifications", { required: false, validator: program.STRING })
    .option("--access-token <access-token>", "NPM access token", { required: false, validator: program.STRING })
    .option("--dry-run", "Dry run mode, do not publish", { required: false, validator: program.BOOLEAN, default: false })
    .option("--override-name <name>", "Override package name", { required: false, validator: program.STRING })
    .option("--override-version <version>", "Override package version", { required: false, validator: program.STRING })
    .action(async ({ logger, args, options }) => {
        const directory = (args.directory || process.cwd()).toString();
        const registry = (options.registry || 'https://registry.npmjs.org/').toString();
        const tag = options.tag?.toString() || null;
        await publish({
            logger: logger,
            packageDirectory: directory,
            registry: registry,
            accessToken: options.accessToken?.toString() || null,
            useCommitHash: options.commitHash !== false,
            useTagInVersion: options.useTagInVersion !== false,
            dryRun: options.dryRun === true,
            tag: tag,
            webhookUrl: options.webhook?.toString() || null,
            overrideName: options.overrideName?.toString() || null,
            overrideVersion: options.overrideVersion?.toString() || null
        });
    });



program.run();