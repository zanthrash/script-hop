---
"script-hop": minor
---

Add `-a` / `--all` to include the scripts of every workspace package, labelled with the package name (e.g. `test (api)`) and run in that package's directory. Package names are searchable (`api test`), and `hop -a <name>` runs a script directly when only one package has it. Works with pnpm, npm, yarn and bun workspaces and deno workspaces.
