---
"script-hop": patch
---

Shell integration now records the command in [atuin](https://atuin.sh) when an atuin session is active. Previously atuin's ↑ and Ctrl-R only saw `hop`, because atuin keeps its own history and only records typed commands.
