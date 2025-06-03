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
    .action(async ({ logger, args }) => {
        await build({
            name: args.library?.toString(),
            logger
        });
    });

program.defaultCommand = program.command('default', 'Compile and update')
    .configure({ visible: false, strictOptions: false })
    .option('--library <library>', 'Library name', { required: false, validator: program.STRING })
    .action(async ({ logger, args }) => {
        await updateNpmdef();
        await build({
            name: args.library?.toString(),
            logger
        });
        await compile({ logger });
    });



program.command('publish', 'Publish npm package')
    .option("--directory <directory>", "Directory to publish", { required: false, validator: program.STRING })
    .option("--registry <registry>", "NPM registry to use", { required: false, validator: program.STRING })
    .option("--tag <tag>", "NPM tag to use", { required: false, validator: program.STRING })
    .action(async ({ logger, args }) => {
        const directory = args.directory.toString() || process.cwd();
        const registry = args.registry.toString() || 'https://registry.npmjs.org/';
        const tag = args.tag.toString() || null;
        await publish({
            logger: logger,
            packageDirectory: directory,
            registry: registry,
            tag: tag
        });
    });



program.run();