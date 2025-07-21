
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";


/**
 * Updates the npmdef files and Unity package.json based on the current package.json.
 * @param {{logger:import("@caporal/core").Logger} | null} options
 */
export async function updateNpmdef(options) {
    /** @type {import("../types").PackageJson} */
    const currentPackageJson = JSON.parse(readFileSync("package.json", "utf8"));
    updateUnityPackage(currentPackageJson, options);
}

/**
 * @param {import("../types").PackageJson} packageJson
 * @param {{logger:import("@caporal/core").Logger} | null} options
 */
function updateUnityPackage(packageJson, options) {

    const dir = process.cwd() + "/unity";
    if (existsSync(dir)) {

        // Update Unity packagejson
        const unityPackageJsonPath = dir + "/package.json";
        /** @type {import("../types").UnityPackageJson} */
        const unityPackageJson = JSON.parse(readFileSync(unityPackageJsonPath, "utf8"));
        unityPackageJson.version = packageJson.version;
        if (packageJson.description) unityPackageJson.description = packageJson.description;
        writeFileSync(unityPackageJsonPath, JSON.stringify(unityPackageJson, null, 4));
        options?.logger.info(`Updated unity package.json at ${unityPackageJsonPath}`);


        // Update npmdefs
        const npmdefs = readdirSync(dir).filter(f => f.endsWith(".npmdef"));
        for (const npmdef of npmdefs) {
            const fp = dir + "/" + npmdef;
            options?.logger.info(`Update npmdef: ${fp}`);
            /** @type {import("../types").Npmdef} */
            const content = JSON.parse(readFileSync(fp, "utf8"));
            content.packageName = packageJson.name;
            content.packageVersion = packageJson.version;
            writeFileSync(fp, JSON.stringify(content, null, 4));
        }
    }
    else {
        options?.logger.warn(`No unity directory found at ${dir}. Skipping npmdef update.`);
    }
}
