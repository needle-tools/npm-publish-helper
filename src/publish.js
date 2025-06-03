import { appendFileSync, existsSync } from 'fs';


/**
 * @param {import('../types').PublishOptions} args
 */
export function publish(args) {

    const logger = args.logger;

    const dir = args.packageDirectory;
    const dirExists = existsSync(dir);
    logger.info(`Publishing package from directory: ${dir} (exists: ${dirExists})`);

    const buildTime = new Date().toISOString();

    args.logger.info(`Build time: ${buildTime}`);
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `build-time=${buildTime}\n`);
    }
}