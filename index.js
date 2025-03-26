#!/usr/bin/env node

import caporal from '@caporal/core';

import { updateNpmdef } from "./src/npmdef.js";
import { build, compile } from './src/compile.js';


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


program.run();