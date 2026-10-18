---
"script-hop": minor
---

Gradle builds: `hop` lists a build's tasks (everyday ones by default, everything with `--all-scripts`) and runs them through the build's `gradlew`. Multi-module builds work like workspaces: at the root each task runs across modules, in a module you get that module's tasks, and `-a` adds every module. Task lists are cached until a build file changes; `--refresh` reads them again.

Also: `hop --list | head` no longer crashes when the reader stops early.
