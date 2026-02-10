# Needle Package Publish Helper

Use e.g. in a `package.json` or github action

### package.json
You can call this script from your package.json scripts.

```json
{
    "scripts": {
      "prepare": "npx --yes needle-publish-helper prepare-publish",
      "build": "npx --yes needle-publish-helper compile-library"
    }
}
```

**A note on compilation commands:**
- `compile`: Runs `tsc` to compile TypeScript files. Not exposed as a direct command, but used by `prepare-publish`.
- `compile-library`: Compiles the library using `vite`. This is the command you would typically use for building your library for distribution.
- `prepare-publish`: A hidden command that runs `update-npmdef`, `compile`, and `compile-library` (`build`). It's a convenience script for getting a package ready for publishing.

When using the build commands, ensure your `package.json` `files` property is configured to include the build output directory (e.g., `dist`).

## CLI Commands

### `publish <directory>`
Publishes the npm package from the specified directory.

**Arguments:**

| Argument      | Type   | Description                                                                    |
|---------------|--------|--------------------------------------------------------------------------------|
| `<directory>` | string | (Required) The path to the directory containing the package to be published. |

**Options:**

| Option                | Type    | Description                                                                                                                                                                       | Default |
|-----------------------|---------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| `--registry <registry>` | string  | Specifies the NPM registry to use (e.g., `https://registry.npmjs.org/`).                                                                                                         |         |
| `--tag <tag>`           | string  | Sets the NPM tag to publish the package with (e.g., `latest`, `beta`).                                                                                                            |         |
| `--version+hash`      | boolean | Appends the short git commit hash to the package version. Boolean flag.                                                                                                           | `false` |
| `--version+tag`       | boolean | Appends the git tag name to the package version. Boolean flag.                                                                                                                    | `false` |
| `--create-tag [prefix]` | string  | Creates a new git tag for the release. An optional prefix can be provided (e.g., `release/`). If no prefix is provided, it defaults to `release/`. If omitted, no git tag is created. |         |
| `--webhook <webhook>`   | string  | URL of a webhook to send a notification to after publishing.                                                                                                                      |         |
| `--access-token <access-token>`| string  | Your NPM access token for publishing (alternative to `--oidc`).                                                                                                                   |         |
| `--oidc`                | boolean | Use OIDC (OpenID Connect) for authentication instead of access tokens. Requires npm 11.5+ and a trusted publisher configured on npmjs.com. See [OIDC Setup](#oidc-trusted-publishing). | `false` |
| `--dry-run`           | boolean | Performs a dry run without actually publishing the package to the registry. Boolean flag.                                                                                         | `false` |
| `--override-name <name>`| string  | Overrides the package name defined in `package.json`.                                                                                                                             |         |
| `--override-version <version>` | string  | Overrides the package version defined in `package.json`.                                                                                                                     |         |
| `--llm-api-key <api-key>`| string  | An optional LLM API key for summarizing changes since the last push. The summary is then sent to the webhook.                                                                      |         |
| `--prepare-package`   | boolean | If set, runs `update-npmdef`, `compile`, and `build` before publishing.                                                                                                           | `false` |

### `prepare-publish`
This is a hidden command that runs `update-npmdef`, then `build` (similar to `compile-library`), and finally `compile`. It's used internally for preparing a package before publishing but is not typically run directly by users.

**Options:**

| Option                | Type   | Description                                                     | Default |
|-----------------------|--------|-----------------------------------------------------------------|---------|
| `--library <library>` | string | Specifies the name of the library to build. This is optional. |         |

### `compile-library`
Compiles the library using Vite.
This command can optionally take a library name.

**Options:**

| Option                | Type   | Description                                                        | Default |
|-----------------------|--------|--------------------------------------------------------------------|---------|
| `--library <library>` | string | Specifies the name of the library to compile. This is optional. |         |

### `update-npmdef`
Updates npmdef files.
This command is used to ensure that your npmdef files are up-to-date.
This command takes no arguments or options.

### `send-webhook-message <webhook> <message>`
Sends a message to a webhook.

**Arguments:**

| Argument    | Type   | Description                        |
|-------------|--------|------------------------------------|
| `<webhook>` | string | (Required) The webhook URL.        |
| `<message>` | string | (Required) The message to send.    |

### `repository-dispatch`
Triggers a GitHub Actions workflow in another repository.

**Options:**

| Option                  | Type   | Description                                                                                             | Default |
|-------------------------|--------|---------------------------------------------------------------------------------------------------------|---------|
| `--access-token <token>`| string | (Required) A GitHub access token with `actions:write` and `contents:write` permissions.                 |         |
| `--repository <repo>`   | string | (Required) The repository to trigger the workflow in (e.g., `owner/repo`).                                |         |
| `--workflow <workflow>` | string | (Required) The workflow filename or ID to trigger.                                                      |         |
| `--ref <ref>`           | string | The git reference (branch, tag, etc.) to use for the dispatch event.                                      | `main`  |
| `--webhook <webhook>`   | string | URL of a webhook to send a notification to after triggering the dispatch.                                 |         |
| `--inputs <inputs>`     | string | A JSON string of inputs to pass to the workflow.                                                        | `{}`    |

### `diff <directory>`
Gets git changes within a time range and can summarize them using an LLM. This command is hidden from the main help output.

**Arguments:**

| Argument      | Type   | Description                                                                    |
|---------------|--------|--------------------------------------------------------------------------------|
| `<directory>` | string | (Required) The path to the directory containing the git repository.            |

**Options:**

| Option                  | Type    | Description                                                                | Default                               |
|-------------------------|---------|----------------------------------------------------------------------------|---------------------------------------|
| `--start-time <time>`   | string  | The start time for the diff (ISO 8601 format).                             | 24 hours ago                          |
| `--end-time <time>`     | string  | The end time for the diff (ISO 8601 format).                               | now                                   |
| `--llm-api-key <key>`   | string  | An optional LLM API key for summarizing the diff.                          |                                       |
| `--webhook <webhook>`   | string  | URL of a webhook to send the diff or summary to.                           |                                       |

## OIDC Trusted Publishing

OIDC (OpenID Connect) allows publishing to npm without storing long-lived tokens. Instead, GitHub Actions authenticates directly with npm using short-lived tokens.

### Requirements
- Node.js 24+ (includes npm 11.5+ with OIDC support)
- Package must already exist on npmjs.com (first publish requires `--access-token`)
- Trusted Publisher configured on npmjs.com

### Setup Steps

1. **First-time publish** (if package doesn't exist yet):
   ```bash
   npx needle-publish-helper publish "." --access-token "${{ secrets.NPM_TOKEN }}"
   ```

2. **Configure Trusted Publisher on npmjs.com:**
   - Go to `https://www.npmjs.com/package/YOUR_PACKAGE_NAME/access`
   - Click "Trusted Publisher" → "GitHub Actions"
   - Enter:
     - **Owner**: Your GitHub org/username (case-sensitive!)
     - **Repository**: Your repo name
     - **Workflow**: The workflow filename (e.g., `publish.yml`)

3. **Update your workflow** to use OIDC:

### Example OIDC Workflow

```yml
name: Publish
on:
  push:
    branches:
      - 'release/*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write   # Required for git tags
      id-token: write   # Required for OIDC
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'

      - run: npm install

      - name: Publish
        run: npx needle-publish-helper publish "." --oidc --webhook "${{ secrets.DISCORD_WEBHOOK }}" --tag "${{ github.ref_name }}" --version+tag --version+hash --create-tag release/
```

### Key Differences from Token-based Publishing
- Use `--oidc` instead of `--access-token`
- Add `permissions: id-token: write` to workflow
- Use Node.js 24+ (for npm 11.5+)
- No npm token secret needed

### Troubleshooting

If OIDC publishing fails:
1. Verify Trusted Publisher config matches exactly (case-sensitive)
2. Ensure workflow has `id-token: write` permission
3. Check npm version is 11.5+ (`npm --version`)
4. The `repository` field in package.json should match your GitHub repo (auto-added if missing)

---

## Example Workflows

### OIDC Publishing (Recommended)

This is the recommended approach for publishing to npm. It uses short-lived tokens generated by GitHub Actions, eliminating the need to store long-lived npm tokens as secrets.

```yml
name: Publish to npm
on:
  push:
    branches:
      - 'release/*'

jobs:
  publish:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write   # Required for creating git tags
      id-token: write   # Required for OIDC authentication with npm
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'  # Node 24+ includes npm 11.5+ with OIDC support
          registry-url: 'https://registry.npmjs.org'

      - run: npm install

      - name: Publish
        run: |
          npx needle-publish-helper publish "." \
            --oidc \
            --tag "${{ github.ref_name }}" \
            --version+tag \
            --version+hash \
            --create-tag release/ \
            --webhook "${{ secrets.DISCORD_WEBHOOK }}"
```

**Prerequisites:**
1. Package must already exist on npmjs.com (first publish requires `--access-token`)
2. Configure Trusted Publisher at `https://www.npmjs.com/package/YOUR_PACKAGE/access`:
   - Owner: `your-github-org` (case-sensitive!)
   - Repository: `your-repo-name`
   - Workflow: `publish.yml` (your workflow filename)

### Token-based Publishing (Legacy)

Use this approach if you can't use OIDC or for the initial publish of a new package.

```yml
name: Publish to npm
on:
  push:
    branches:
      - 'release/*'

jobs:
  publish:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write   # Required for creating git tags
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'

      - run: npm install

      - name: Publish
        run: |
          npx needle-publish-helper publish "." \
            --access-token "${{ secrets.NPM_TOKEN }}" \
            --tag "${{ github.ref_name }}" \
            --version+tag \
            --version+hash \
            --create-tag release/ \
            --webhook "${{ secrets.DISCORD_WEBHOOK }}"
```

**Prerequisites:**
1. Create an npm access token at `https://www.npmjs.com/settings/YOUR_USERNAME/tokens`
2. Add the token as `NPM_TOKEN` secret in your repository settings

# Contact ✒️
<b>[🌵 Needle](https://needle.tools)</b> •
[Github](https://github.com/needle-tools) •
[Twitter](https://twitter.com/NeedleTools) • 
[Discord](https://discord.needle.tools) • 
[Forum](https://forum.needle.tools) • 
[Youtube](https://www.youtube.com/@needle-tools)
