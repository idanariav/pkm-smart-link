#!/bin/sh
# Build, copy into the vault's plugin folder and reload the plugin (so Obsidian picks up new code).
set -e
cd "$(dirname "$0")/.."
npm run build >/dev/null
cp main.js /Users/idanariav/GitProjects/Obsidian_Vault/.obsidian/plugins/pkm-smart-link/main.js
obsidian eval code="(async()=>{await app.plugins.disablePlugin('pkm-smart-link');await app.plugins.enablePlugin('pkm-smart-link');await new Promise(r=>setTimeout(r,4000));return 'reloaded'})()" 2>&1 | grep -v FATAL || true
