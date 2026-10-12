---
"script-hop": minor
---

Show `pre`/`post` hooks in the picker: when your package manager will run them, the line under the selected script reads e.g. `tsc  ·  runs prebuild → build → postbuild`. Shown for npm, pnpm, bun and Yarn 1; Yarn 2+ skips hooks, so nothing is shown there.
