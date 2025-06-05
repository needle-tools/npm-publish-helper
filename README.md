# Needle Package Publish Helper

Use e.g. in a `package.json` or github action

### package.json
You can call this script from your package.json scripts
```json
{
    "scripts": {
      "prepublishOnly": "npx --yes needle-tools/npm-publish-helper prepare-publish",
      "compile": "npx --yes needle-tools/npm-publish-helper compile-library",
    },
}
```

## CLI Commands

### `prepare-publish`
This is a hidden command that runs `update-npmdef`, then `build` (similar to `compile-library`), and finally `compile`. It's used internally for preparing a package before publishing but is not typically run directly by users.

**Options:**

| Option                | Type   | Description                                                     | Default |
|-----------------------|--------|-----------------------------------------------------------------|---------|
| `--library <library>` | string | Specifies the name of the library to build. This is optional. |         |

### `compile-library`
Compiles the library.
This command can optionally take a library name.

**Options:**

| Option                | Type   | Description                                                        | Default |
|-----------------------|--------|--------------------------------------------------------------------|---------|
| `--library <library>` | string | Specifies the name of the library to compile. This is optional. |         |

### `update-npmdef`
Updates npmdef files.
This command is used to ensure that your npmdef files are up-to-date.
This command takes no arguments or options.

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
| `--create-tag [prefix]` | string  | Creates a new git tag for the release. An optional prefix can be provided (e.g., `release/`). If the prefix is an empty string, the tag will typically be based on the version. If omitted, no git tag is created. |         |
| `--webhook <webhook>`   | string  | URL of a webhook to send a notification to after publishing.                                                                                                                      |         |
| `--access-token <access-token>`| string  | Your NPM access token, required for publishing.                                                                                                                                   |         |
| `--dry-run`           | boolean | Performs a dry run without actually publishing the package to the registry. Boolean flag.                                                                                         | `false` |
| `--override-name <name>`| string  | Overrides the package name defined in `package.json`.                                                                                                                             |         |
| `--override-version <version>` | string  | Overrides the package version defined in `package.json`.                                                                                                                     |         |

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
        with:
          submodules: 'recursive'  # Fetch all submodules recursively
          token: ${{ secrets.GH_RELEASE_TOKEN }} # Required to allow action to create tags
        
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          
      - name: Install dependencies
        run: npm install
        
      - name: Publish to npm
        run: npx --yes needle-tools/npm-publish-helper publish "./dist" --webhook "${{ secrets.DISCORD_WEBHOOK }}" --access-token "${{ secrets.NPM_TOKEN }}" --tag "${{github.ref_name}}" --version+tag --version+hash --create-tag release/
```

# Contact ✒️
<b>[🌵 Needle](https://needle.tools)</b> •
[Github](https://github.com/needle-tools) •
[Twitter](https://twitter.com/NeedleTools) • 
[Discord](https://discord.needle.tools) • 
[Forum](https://forum.needle.tools) • 
[Youtube](https://www.youtube.com/@needle-tools)
