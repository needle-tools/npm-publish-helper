import fetch from 'node-fetch';

/**
 * Exchange a GitHub Actions OIDC token for a short-lived npm auth token.
 *
 * Workaround for npm/cli#8547: `npm dist-tag add` (and a few other commands)
 * do not yet support OIDC directly. The npm registry however exposes a token
 * exchange endpoint that returns a regular bearer token usable with any npm
 * command. Mirrors what electron/npm-trusted-auth-action does.
 *
 * @param {object} args
 * @param {string} args.packageName - The npm package name to authenticate against.
 * @param {string} [args.registry] - Registry base URL. Defaults to https://registry.npmjs.org/.
 * @param {import('@caporal/core').Logger} args.logger
 * @returns {Promise<{success:true, token:string} | {success:false, error:string, status?:number}>}
 */
export async function exchangeOidcForNpmToken(args) {
    const { packageName, logger } = args;
    const registry = (args.registry || 'https://registry.npmjs.org/').replace(/\/+$/, '');

    const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!requestUrl || !requestToken) {
        return {
            success: false,
            error: `OIDC environment not available (ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN missing). Ensure the workflow has 'id-token: write' permission.`,
        };
    }

    // 1) Get a GitHub OIDC token with npm registry as audience
    const audienceHost = new URL(registry).host;
    const oidcUrl = `${requestUrl}&audience=${encodeURIComponent(`npm:${audienceHost}`)}`;
    logger.info(`Requesting GitHub OIDC token for audience npm:${audienceHost}`);

    let oidcToken;
    try {
        const res = await fetch(oidcUrl, {
            headers: { Authorization: `bearer ${requestToken}` },
        });
        if (!res.ok) {
            const body = await safeReadBody(res);
            return { success: false, status: res.status, error: `Failed to get GitHub OIDC token (status ${res.status}): ${body}` };
        }
        const data = await res.json();
        oidcToken = data?.value;
        if (!oidcToken) {
            return { success: false, error: `GitHub OIDC response did not contain a token value.` };
        }
    } catch (err) {
        return { success: false, error: `Failed to request GitHub OIDC token: ${err.message}` };
    }

    // 2) Exchange the OIDC token for an npm auth token
    const exchangeUrl = `${registry}/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(packageName)}`;
    logger.info(`Exchanging OIDC token for npm auth token at ${exchangeUrl}`);
    try {
        const res = await fetch(exchangeUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${oidcToken}`,
                Accept: 'application/json',
            },
        });
        if (res.status !== 201) {
            const body = await safeReadBody(res);
            return { success: false, status: res.status, error: `Failed to exchange OIDC token (status ${res.status}): ${body}` };
        }
        const data = await res.json();
        const token = data?.token;
        if (!token) {
            return { success: false, error: `npm exchange response did not contain a token.` };
        }
        // Mask in GitHub Actions logs
        if (process.env.GITHUB_ACTIONS) {
            process.stdout.write(`::add-mask::${token}\n`);
        }
        return { success: true, token };
    } catch (err) {
        return { success: false, error: `Failed to exchange OIDC token: ${err.message}` };
    }
}

async function safeReadBody(res) {
    try { return (await res.text()).slice(0, 500); }
    catch { return '<unreadable body>'; }
}
