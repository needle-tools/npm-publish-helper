# Needle Package Publish Helper

Use e.g. in a `package.json` or github action

### package.json
You can call this script from your package.json scripts
```json
{
    "scripts": {
      "prepublishOnly": "npx --yes needle-tools/npm-publish-helper",
      "compile": "npx --yes needle-tools/npm-publish-helper compile",
    },
}
```

## Publish via Github Action
```yml
  - name: Run publish command # publish a new version with a tag + git short hash
    run: npx . publish "path/to/directory" --webhook "${{ secrets.DISCORD_WEBHOOK }}" --access-token "${{ secrets.NPM_TOKEN }}" --version+hash --version+tag --tag --tag "${{ github.ref_name }}"
```

### Example

```yml
name: Release Workflow
on:
  push:
    branches:
      - 'release/*'

jobs:
  run-release-script:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: .
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          submodules: 'recursive'  # Fetch all submodules recursively
          token: ${{ secrets.GH_RELEASE_TOKEN }} 
        
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          
      - name: Install dependencies
        run: npm install
        
      - name: Publish to npm
        run: npx --yes needle-tools/npm-publish-helper publish "./dist" --webhook "${{ secrets.DISCORD_WEBHOOK }}" --access-token "${{ secrets.NPM_TOKEN }}" --tag "${{github.ref_name}}" --version+tag --version+hash


```




# Contact ✒️
<b>[🌵 Needle](https://needle.tools)</b> • 
[Github](https://github.com/needle-tools) • 
[Twitter](https://twitter.com/NeedleTools) • 
[Discord](https://discord.needle.tools) • 
[Forum](https://forum.needle.tools) • 
[Youtube](https://www.youtube.com/@needle-tools)

