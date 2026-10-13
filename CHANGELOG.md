# script-hop

## 0.2.0

### Minor Changes

- [`79fceab`](https://github.com/zanthrash/script-hop/commit/79fceab4b97467b043ea6d720bbc24612bd3dd0a) Thanks [@zanthrash](https://github.com/zanthrash)! - Show `pre`/`post` hooks in the picker: when your package manager will run them, the line under the selected script reads e.g. `tsc  ·  runs prebuild → build → postbuild`. Shown for npm, pnpm, bun and Yarn 1; Yarn 2+ skips hooks, so nothing is shown there.

## 0.1.0

### Minor Changes

- [`115700b`](https://github.com/zanthrash/script-hop/commit/115700b5c16ae761e8d24c0312f3bb25a901f707) Thanks [@zanthrash](https://github.com/zanthrash)! - First release of `hop`: a fuzzy, frecency-ranked picker for package.json scripts that works with npm, pnpm, yarn, bun and deno, including deno.json tasks and workspace root scripts.
