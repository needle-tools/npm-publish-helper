import { readFileSync } from 'fs';

/**
 * @type {Object | null | undefined}
 */
let loadedData = undefined;


/**
 * Load GitHub event data from the environment variable GITHUB_EVENT_PATH.
 * @param {{logger?:import("@caporal/core").Logger}} [opts] Options for loading the data.
 * @returns {Object | null} Parsed JSON object from the event file, or null if not available or an error occurs.
 */
export function tryLoadGithubEventData(opts) {
    if (loadedData === null) {
        return null;
    }
    loadedData = null;
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
        opts?.logger?.debug('GITHUB_EVENT_PATH is not set, skipping loading GitHub event data.');
        return null;
    }
    try {
        opts?.logger?.debug(`Loading GitHub event data from ${eventPath}`);
        const eventData = readFileSync(eventPath, 'utf8');
        loadedData = JSON.parse(eventData);
        return loadedData;
    } catch (error) {
        opts?.logger?.error(`Failed to load GitHub event data from ${eventPath}:`, error);
        return null;
    }
}