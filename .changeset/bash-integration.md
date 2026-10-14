---
"script-hop": minor
---

Add bash shell integration. Add `eval "$(hop --init bash)"` to `~/.bashrc`, and the scripts you pick run in bash and are saved to its history as the real command, in place of the `hop` line. Works with bash 3.2 (macOS's `/bin/bash`) and later, and with atuin.
