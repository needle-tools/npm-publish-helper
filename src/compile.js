import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

/**
 * @param {{name?:string, logger:import("@caporal/core").Logger}} args
 */
export async function build(args) {

    const dir = process.cwd();
    const packageJsonPath = dir + "/package.json";
    if (!existsSync(packageJsonPath)) {
        throw Error("package.json not found at " + packageJsonPath);
    }
    /** @type {import("../types").PackageJson} */
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (!args.name) {
        args.name = packageJson.name.split("/").pop();
    }
    if (!args.name) {
        throw Error("Library name not found");
    }
    args.logger.info("Building " + args.name);

    let viteConfigPath = `${dir}/vite.config.js`;
    if (!existsSync(viteConfigPath)) {
        viteConfigPath = `${dir}/node_modules/.needle`;
        viteConfigPath = await createDefaultViteConfig(args.name, viteConfigPath, packageJson);
    }

    let cmd = "npx vite build --base=./ --outDir=dist --config=" + viteConfigPath;
    args.logger.info(cmd);
    execSync(cmd, { stdio: "inherit" });
    args.logger.info("Built " + args.name);
}

/**
 * @param {{logger:import("@caporal/core").Logger}} args
 */
export async function compile(args) {
    let cmd = `npx tsc --rootDir . --outDir lib --noEmit false --incremental false --skipLibCheck`;
    args.logger.info("Compile TSC");
    execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
    args.logger.info("Compiled TSC");
}

/**
 * @param {string} name
 * @param {string} dir
 * @param {import("../types").PackageJson} packageJson
 * @returns {Promise<string>}
 */
async function createDefaultViteConfig(name, dir, packageJson) {
    const templateConfig = import.meta.dirname + "/vite.config.template.js";
    if (!existsSync(templateConfig)) {
        throw Error("Template not found: " + templateConfig);
    }
    let text = readFileSync(templateConfig, "utf8");
    text = text.replaceAll("<entry>", packageJson.main || "index.ts");
    text = text.replaceAll("<name>", name);

    const outputPath = dir + "/vite.config.js";
    writeFileSync(outputPath, text, "utf8");
    return outputPath;
}


