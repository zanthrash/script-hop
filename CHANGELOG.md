# script-hop

## 0.4.0

### Minor Changes

- [`326837d`](https://github.com/zanthrash/script-hop/commit/326837d8266ec812a61a20894a10acffaac482f0) Thanks [@zanthrash](https://github.com/zanthrash)! - Add bash shell integration. Add `eval "$(hop --init bash)"` to `~/.bashrc`, and the scripts you pick run in bash and are saved to its history as the real command, in place of the `hop` line. Works with bash 3.2 (macOS's `/bin/bash`) and later, and with atuin.

## 0.3.1

### Patch Changes

- [`70c5637`](https://github.com/zanthrash/script-hop/commit/70c5637e3ff997d3c492a8d51f59e7b269172042) Thanks [@zanthrash](https://github.com/zanthrash)! - Shell integration now records the command in [atuin](https://atuin.sh) when an atuin session is active. Previously atuin's ↑ and Ctrl-R only saw `hop`, because atuin keeps its own history and only records typed commands.

## 0.3.0

### Minor Changes

- [`8dc8ab9`](https://github.com/zanthrash/script-hop/commit/8dc8ab9c6735258f6345d59e71b9eab6a6bdcf99) Thanks [@zanthrash](https://github.com/zanthrash)! - Add shell integration for fish and zsh. Add `hop --init fish | source` to your fish config or `eval "$(hop --init zsh)"` to `~/.zshrc`, and the scripts you pick run in your shell and land in its history as the real command (e.g. `pnpm run dev`), so ↑ and history search find them. Adding to fish history needs fish 4.0+; on fish 3.x scripts still run and hop explains once per session.

## 0.2.0

### Minor Changes

- [`79fceab`](https://github.com/zanthrash/script-hop/commit/79fceab4b97467b043ea6d720bbc24612bd3dd0a) Thanks [@zanthrash](https://github.com/zanthrash)! - Show `pre`/`post` hooks in the picker: when your package manager will run them, the line under the selected script reads e.g. `tsc  ·  runs prebuild → build → postbuild`. Shown for npm, pnpm, bun and Yarn 1; Yarn 2+ skips hooks, so nothing is shown there.

## 0.1.0

### Minor Changes

- [`115700b`](https://github.com/zanthrash/script-hop/commit/115700b5c16ae761e8d24c0312f3bb25a901f707) Thanks [@zanthrash](https://github.com/zanthrash)! - First release of `hop`: a fuzzy, frecency-ranked picker for package.json scripts that works with npm, pnpm, yarn, bun and deno, including deno.json tasks and workspace root scripts.
