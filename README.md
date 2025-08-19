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
| `--access-token <access-token>`| string  | Your NPM access token, required for publishing.                                                                                                                                   |         |
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

**Example Github Action Workflow:**

```yml
name: Release Workflow
on:
  push:
    branches:
      - 'release/*'

jobs:
  run-release-script:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    defaults:
      run:
        working-directory: .
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        # with:
          # submodules: 'recursive'  # Fetch all submodules recursively
          # token: ${{ secrets.GH_RELEASE_TOKEN }} # Required to allow action to create tags
        
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          
      - name: Install dependencies
        run: npm install
        
      - name: Publish to npm
        id: publish
        run: npx --yes needle-publish-helper@stable publish "./dist" --webhook "${{ secrets.DISCORD_WEBHOOK }}" --access-token "${{ secrets.NPM_TOKEN }}" --tag "${{github.ref_name}}" --version+tag --version+hash --create-tag release/
```

# Contact ✒️
<b>[🌵 Needle](https://needle.tools)</b> •
[Github](https://github.com/needle-tools) •
[Twitter](https://twitter.com/NeedleTools) • 
[Discord](https://discord.needle.tools) • 
[Forum](https://forum.needle.tools) • 
[Youtube](https://www.youtube.com/@needle-tools)
