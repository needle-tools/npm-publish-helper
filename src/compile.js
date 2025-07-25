import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { tryExecSync } from "./utils";

/**
 * @param {{name?:string, packageDirectory?:string, logger:import("@caporal/core").Logger}} options
 */
export async function build(options) {

    const dir = options.packageDirectory || process.cwd();
    const packageJsonPath = dir + "/package.json";
    if (!existsSync(packageJsonPath)) {
        throw Error("package.json not found at " + packageJsonPath);
    }
    /** @type {import("../types").PackageJson} */
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (!options.name) {
        options.name = packageJson.name.split("/").pop();
    }
    if (!options.name) {
        throw Error("Library name not found");
    }
    options.logger.info("Building " + options.name);

    let viteConfigPath = `${dir}/vite.config.js`;
    if (!existsSync(viteConfigPath)) {
        viteConfigPath = `${dir}/node_modules/.needle`;
        viteConfigPath = await createDefaultViteConfig(options.name, viteConfigPath, packageJson, { logger: options.logger });
    }


    execSync('npm install --no-save vite', { cwd: dir });
    let cmd = "npx --yes vite build --base=./ --outDir=dist --config=" + viteConfigPath;
    options.logger.info(cmd);
    const res = tryExecSync(cmd, { stdio: "inherit", cwd: dir }, { logger: options.logger, logError: true });
    if (res.success === false) {
        options.logger.error("Failed to build Vite project. Please check the errors above.");
        throw new Error("Vite build failed");
    }
    options.logger.info("Built " + options.name);
}

/**
 * @param {{directory?:string, logger:import("@caporal/core").Logger}} options
 */
export async function compile(options) {
    execSync('npm install --no-save typescript');
    let cmd = `npx --yes --package typescript tsc --outDir lib --noEmit false --incremental false --skipLibCheck`;
    options.logger.info("Compile TSC");
    const res = tryExecSync(cmd, { stdio: "inherit", cwd: options.directory || process.cwd() }, { logger: options.logger, logError: true });
    if (res.success === false) {
        throw new Error("TypeScript compilation failed");
    }
    options.logger.info("Compiled TSC");
}

/**
 * @param {string} name
 * @param {string} dir
 * @param {import("../types").PackageJson} packageJson
 * @param {{logger:import("@caporal/core").Logger}} options
 * @returns {Promise<string>}
 */
async function createDefaultViteConfig(name, dir, packageJson, options) {
    const templateConfig = import.meta.dirname + "/vite.config.template.js";
    if (!existsSync(templateConfig)) {
        throw Error("Vite config template not found: " + templateConfig);
    }
    options.logger.info(`Creating default vite config at ${dir} (from template ${templateConfig})`);
    let text = readFileSync(templateConfig, "utf8");
    text = text.replaceAll("<entry>", packageJson.main || "index.ts");
    text = text.replaceAll("<name>", name);

    mkdirSync(dir, { recursive: true });
    const outputPath = `${dir}/vite.config.js`;
    writeFileSync(outputPath, text, "utf8");
    return outputPath;
}


