---
"script-hop": minor
---

Add shell integration for fish and zsh. Add `hop --init fish | source` to your fish config or `eval "$(hop --init zsh)"` to `~/.zshrc`, and the scripts you pick run in your shell and land in its history as the real command (e.g. `pnpm run dev`), so ↑ and history search find them.
