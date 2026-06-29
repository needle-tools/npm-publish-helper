import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { tryExecSync } from './utils.js';
import { getVersionName } from './version-names.js';

/**
 * @typedef {object} VersionFlags
 * @property {boolean} [useTagInVersion] - Append the tag (e.g. `-canary`) to the version.
 * @property {string|null} [tag] - The primary tag. Ignored when it equals "latest".
 * @property {boolean} [useTimeInVersion] - Append an epoch-seconds segment for prerelease ordering.
 * @property {boolean} [useNameInVersion] - Append a human-readable name derived from the commit hash.
 * @property {boolean} [useHashInVersion] - Append the short commit hash.
 */

/**
 * Derives the next package version from the current version and the `--version+*` flags.
 * Pure (no I/O) so it can be unit-tested and shared between `publish` and `apply-version`.
 *
 * @param {string} currentVersion - The base version from package.json (e.g. "5.1.2").
 * @param {VersionFlags & { shortSha?: string|null, logger?: import('@caporal/core').Logger }} opts
 * @returns {string} The computed next version (equal to `currentVersion` when no flag applies).
 */
export function computeNextVersion(currentVersion, opts) {
    const { useTagInVersion, tag, useTimeInVersion, useNameInVersion, useHashInVersion, shortSha, logger } = opts;

    let nextVersion = currentVersion;
    if (useTagInVersion && tag && tag !== "latest") {
        // First remove the existing pre-release tag if it exists
        const dashIndex = nextVersion.indexOf('-');
        if (dashIndex > 0) nextVersion = nextVersion.substring(0, dashIndex);
        // Then append the new tag
        logger?.info(`Adding tag '${tag}' to version.`);
        nextVersion += `-${tag}`;
    }
    if (useTimeInVersion) {
        const epochSeconds = Math.floor(Date.now() / 1000);
        logger?.info(`Adding epoch timestamp '${epochSeconds}' to version.`);
        if (nextVersion.includes('-')) {
            nextVersion += `.${epochSeconds}`;
        }
        else {
            nextVersion += `-${epochSeconds}`;
        }
    }
    if (useNameInVersion && shortSha) {
        const name = getVersionName(shortSha);
        logger?.info(`Adding name '${name}' to version (derived from hash '${shortSha}').`);
        if (nextVersion.includes('-')) {
            nextVersion += `.${name}`;
        }
        else {
            nextVersion += `-${name}`;
        }
    }
    if (useHashInVersion && shortSha) {
        if (nextVersion.includes('-')) {
            nextVersion += `.${shortSha}`;
        }
        else {
            nextVersion += `-${shortSha}`;
        }
    }
    else {
        logger?.info(`Skipping commit hash in version as useHashInVersion is false or shortSha is not available.`);
    }
    return nextVersion;
}

/**
 * Computes the next version for the package at `packageDirectory` and writes it into that
 * package.json (via `npm version --no-git-tag-version`). Use this to finalize the version
 * on the SOURCE package BEFORE building, so a build that bakes the version into its bundle
 * (e.g. a Vite `define`) picks up the final published version instead of the base version.
 *
 * @param {VersionFlags & { packageDirectory?: string, logger: import('@caporal/core').Logger }} opts
 * @returns {string} The version that is now set in the package.json.
 */
export function applyVersion(opts) {
    const { packageDirectory, logger } = opts;
    const dir = resolve(packageDirectory || process.cwd());
    const packageJsonPath = `${dir}/package.json`;
    if (!existsSync(packageJsonPath)) {
        throw new Error(`No package.json found at ${packageJsonPath}`);
    }

    /** @type {import('../types').PackageJson} */
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const currentVersion = packageJson.version;
    if (!currentVersion) {
        throw new Error(`No version field in ${packageJsonPath}`);
    }

    const shortSha = tryExecSync('git rev-parse --short HEAD', { cwd: dir }).output;
    const nextVersion = computeNextVersion(currentVersion, { ...opts, shortSha, logger });

    if (currentVersion !== nextVersion) {
        // the package version can only be updated if it's different
        const cmd = `npm version ${nextVersion} --no-git-tag-version`;
        logger.info(`Updating package version to "${nextVersion}" with command "${cmd}" in ${dir}`);
        const res = tryExecSync(cmd, { cwd: dir }, { logger, logError: true });
        if (!res.success) {
            throw new Error(`Failed to update package version: ${res.error}`);
        }
    }
    else {
        logger.info(`Version unchanged (${currentVersion}); nothing to write.`);
    }
    return nextVersion;
}
