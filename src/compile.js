import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

/**
 * @param {{name?:string, logger:import("@caporal/core").Logger}} options
 */
export async function build(options) {

    const dir = process.cwd();
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


    execSync('npm install --no-save vite');
    let cmd = "npx --yes vite build --base=./ --outDir=dist --config=" + viteConfigPath;
    options.logger.info(cmd);
    execSync(cmd, { stdio: "inherit" });
    options.logger.info("Built " + options.name);
}

/**
 * @param {{logger:import("@caporal/core").Logger}} options
 */
export async function compile(options) {
    let cmd = `npx --yes --package typescript tsc --rootDir . --outDir lib --noEmit false --incremental false --skipLibCheck`;
    options.logger.info("Compile TSC");
    execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
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


