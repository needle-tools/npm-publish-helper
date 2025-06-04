# Needle Package Publish Helper

Use e.g. in a `package.json` or github action

### In your package.json
```json
{
    "scripts": {
      "prepublishOnly": "npx --yes needle-tools/npm-publish-helper",
      "compile": "npx --yes needle-tools/npm-publish-helper compile",
    },
}
```

### Publish via github workflow
```yml
  - name: Run publish command # publish a new version with a tag + git short hash
    run: npx . publish "path/to/directory" --webhook "${{ secrets.DISCORD_WEBHOOK }}" --access-token "${{ secrets.NPM_TOKEN }}" --version+hash --version+tag --tag --tag "${{ github.ref_name }}"
```



# Contact ✒️
<b>[🌵 Needle](https://needle.tools)</b> • 
[Github](https://github.com/needle-tools) • 
[Twitter](https://twitter.com/NeedleTools) • 
[Discord](https://discord.needle.tools) • 
[Forum](https://forum.needle.tools) • 
[Youtube](https://www.youtube.com/@needle-tools)

