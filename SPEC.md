# script-hop (`hop`) — Spec

An interactive picker for package.json scripts, building on the idea of [`ntl`](https://github.com/ruyadorno/ntl), with fuzzy finding, frecency ranking, and support for every major JS package manager.

- **npm package:** `script-hop`
- **Binary:** `hop`
- **Audience:** public, cross-platform (macOS, Linux, Windows; any shell)

## Goals (v1)

1. Fuzzy-find scripts from the current project.
2. Most-used scripts float to the top (frecency).
3. Works with npm, pnpm, yarn, bun, and deno.

## Non-goals (v1)

- Multi-select / running several scripts.
- Full-screen TUI or large preview pane.
- Config files.
- Task sources beyond package.json and deno.json (Makefile, justfile, turbo…).

## CLI

```
hop                 open the picker
hop <query>         exact script name match → run immediately; otherwise open picker pre-filtered
hop -l, --last      rerun the last script in this project, no picker
hop -a, --all       include the scripts of every workspace package
hop --list          print ranked scripts, one per line (for piping)
hop --pm <name>     override detected package manager (npm|pnpm|yarn|bun|deno)
hop --all-scripts   include hidden lifecycle/hook scripts
hop --reset-history clear usage history
hop --init <shell>  print shell integration (fish, zsh, bash)
hop -- <args>       append args to the chosen script
hop --help / -v     help / version
```

Environment: `HOP_PM=<name>` — same as `--pm` (empty is ignored). `HOP_HISTORY=<path>` — override the history file location.

## Package manager detection

Precedence:

1. `--pm` flag, then `HOP_PM` env var.
2. `packageManager` field in package.json (Corepack).
3. Lockfile in the project or a parent directory: `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`/`bun.lockb`, `package-lock.json`, `deno.lock`.
4. Fallback: npm.

Implemented with [`package-manager-detector`](https://github.com/antfu-collective/package-manager-detector) plus the override layer above.

- **Multiple lockfiles:** `packageManager` wins; otherwise first match in fixed order, with a warning.
- **Detected manager not installed:** error suggesting `corepack enable`, with an offer to fall back to npm.

### Run command per manager

| Manager | Command                 | Extra args            |
|---------|-------------------------|-----------------------|
| npm     | `npm run <name>`        | `-- <args>`           |
| pnpm    | `pnpm run <name>`       | `<args>`              |
| yarn    | `yarn <name>`           | `<args>`              |
| bun     | `bun run <name>`        | `<args>`              |
| deno    | `deno task <name>`      | `<args>`              |

## Task sources

Internally a small `TaskSource` interface, so more sources can be added later. v1 ships two:

- **package.json `scripts`** — always.
- **deno.json / deno.jsonc `tasks`** — when deno is the runner. On name collision, deno.json wins (mirrors `deno task`).

Each entry carries a source tag (`pkg` / `deno`).

### Monorepos

List scripts from the **nearest package.json** plus the **workspace root's** scripts, grouped and tagged `root`. Root scripts run with cwd set to the workspace root. Workspace root detection: `pnpm-workspace.yaml`, or a `workspaces` field in package.json (npm/yarn/bun), or deno workspace config.

### All workspace packages (`-a`, `--all`)

- Packages come from the workspace root's `pnpm-workspace.yaml` `packages`, package.json `workspaces` (array or yarn's `{ packages }`), or deno.json `workspace`. Patterns are expanded with `tinyglobby`; `!` exclusions are honoured, `node_modules` is skipped, and only directories with a package.json or deno.json count.
- Tasks get `scope: 'package'` and a `package` label (package name, else path from the root), and run in their package directory. Works from the root too.
- Search matches `"<name> <package>"` with fzf extended matching (space-separated terms must all match); highlighting stays within the script name.
- Exact names: current package, then root, then a unique other package; several packages → picker (non-TTY: error naming them).
- Shell handoff reuses the per-runner directory flags (`pnpm --dir ../api run migrate`) rather than workspace flags (`--filter`, `-w`, `yarn workspace`), whose package selection differs between runners. Checked against real npm, pnpm, Yarn 1 and bun workspaces.

### Hidden scripts

Hidden by default (shown with `--all-scripts`):

- Lifecycle scripts: `preinstall`, `install`, `postinstall`, `prepare`, `prepublish`, `prepublishOnly`, `prepack`, `postpack`, etc.
- `pre<x>` / `post<x>` when a matching `<x>` exists.

### Descriptions

Read, in order: `hop.descriptions`, `ntl.descriptions`, `scripts-info` (package.json), `description` (deno.json tasks). Shown in the preview line; fall back to the raw command.

## Picker UI

- Inline (no alternate screen), built on [`@inquirer/search`](https://github.com/SBoudrias/Inquirer.js) — we supply an ordered source function; the library does no filtering of its own.
- Each row: name, source/workspace tag, highlighted fuzzy match characters.
- Rendered on stderr so stdout stays clean. Ctrl-C or Esc cancels (exit 130).
- Footer (inquirer `description`): description or command of the highlighted entry.
- When the runner will also run `pre`/`post` hooks, the footer shows the chain, e.g. `tsc  ·  runs prebuild → build → postbuild`. Verified against real runners: npm 11, pnpm 10, bun 1.3 and Yarn 1 run hooks; Yarn 2+ doesn't (detected from `packageManager`, `.yarnrc.yml`, or `__metadata` in `yarn.lock`). deno is treated as not running them (unverified).

## Ranking

### Frecency

- Each run adds a score that decays over time (half-life ~1 week, zoxide-style).
- The **last-run script is always pinned first**.
- Never-run scripts follow, alphabetical.

### With a query

- Fuzzy matching via [`fzf`](https://github.com/ajitid/fzf-for-js) (fzf-for-js).
- Match against **name and command**; name matches always outrank command-only matches.
- **Fuzzy score is primary**, then an exact name match, then frecency.

### History storage

- Single JSON file in the user data dir via `env-paths` (`~/Library/Application Support/script-hop/history.json` on macOS, `~/.local/share/script-hop/` on Linux, `%LOCALAPPDATA%\script-hop\Data\` on Windows), overridable with `HOP_HISTORY`.
- Keyed by absolute path of the package.json directory, then script name: `{ count, score, lastRun }`.
- Recorded **at launch**, not on success.
- Writes are atomic (temp file + rename). Last-write-wins on races; acceptable.
- Entries older than ~90 days pruned on each write.
- Unknown script names ignored during ranking.

## Execution

- Spawn the manager with `stdio: 'inherit'` (TTY, colors, interactive scripts all work).
- Forward SIGINT/SIGTERM to the child; exit with the child's exit code.
- Print the resolved command to stderr before running, e.g. `› pnpm run dev`.
- Windows: `.cmd` shims handled by `cross-spawn`.
- Manager binary missing → message suggesting `corepack enable` or `--pm`, exit 127.

## Shell integration

`hop --init fish|zsh|bash` prints a `hop` wrapper function (a flag rather than `hop init`, so a script named `init` still runs with `hop init`).

- The wrapper sets `HOP_CMD_FILE` to a temp file. When a script is chosen, hop records usage and writes the command line there instead of running it. The wrapper adds the line to history (fish `history append`, zsh `print -s`, bash `history -s`), prints `› <command>` to stderr and `eval`s it, so the script's exit code is the function's.
- If nothing is written (`--list`, `--help`, cancel, errors), hop's own exit code is returned.
- fish needs 4.0+ for `history append`. On fish 3.x (`history append` would run a search instead) the command still runs, and a note is printed once per session. Writing fish's history file directly was tried and rejected: fish tracks its own file offsets, and an outside append corrupted the file.
- atuin: it replaces ↑/Ctrl-R with its own database, fed only by its hooks for typed commands. When `ATUIN_SESSION` is set (and fish isn't in private mode), the wrapper records the command via `atuin history start` / `atuin history end --exit`, as atuin's hooks do. This also covers fish 3.x users who have atuin.
- bash: `history -s` replaces the entry for the line being run (the typed `hop …`) with the real command. Checked on bash 3.2 and 5.2 that it never removes an unrelated entry (e.g. when the `hop` line was skipped by `ignorespace`). The wrapper sticks to bash 3.2 syntax, since that is still macOS's `/bin/bash`.
- Lines are quoted with single quotes and `'\''`, which works in both fish and POSIX shells.
- Root scripts carry their directory, relative to the current one and always with `/`, so history entries replay correctly: `npm --prefix`, `pnpm --dir`, `yarn --cwd`, `bun run --cwd`, `deno task --cwd` (all but deno checked by hand).
- Tested in real fish, zsh and bash. CI installs fish 3.x and zsh on Linux and fish 4.x on macOS, so both fish paths run; bash is 5.x on Linux and 3.2 on macOS. Shell tests are skipped on Windows (Git Bash isn't covered yet).

## Edge cases

| Situation | Behaviour |
|---|---|
| No package.json in cwd | Walk up to nearest; none found → clear error, exit 1. |
| package.json with no scripts | "No scripts in <path>", exit 0. |
| Not a TTY (piped / CI) | Never prompt. `hop` behaves like `--list`, exit 0. `hop <exact-name>` still runs. |
| Ctrl-C / Esc in picker | Exit 130 quietly; nothing recorded. |
| History corrupt / unwritable | Warn once, continue without ranking. Never blocks running. |
| `hop -l` with no history | "No previous run here", fall back to picker. |

## Technical choices

| Area | Choice |
|---|---|
| Language | TypeScript, ESM |
| Runtime | Node `>=22` (keep bun-compatible) |
| Build | tsdown → single bundled ESM file `dist/cli.mjs` (config is `.mjs`, loaded with `--config-loader native`) |
| Tests | vitest; core logic as pure functions tested against fixture repos (one per PM + workspace layouts). Picker is a thin shell. |
| Dev PM | pnpm |
| CI | GitHub Actions, matrix ubuntu/macos/windows × Node 22/24 |
| Release | changesets, npm publish with provenance |

### Module layout

```
src/
  cli.ts          entry point: wires real IO into main
  app.ts          main(argv, io): arg parsing, flow, exit codes (tested with fake IO)
  tasks.ts        loadProject: asks every task source, merges their tasks
  types.ts        Task, Project, TaskSource, RunnerId
  sources/
    node.ts       package.json scripts + deno.json tasks: PM detection, workspaces, hooks
  fs.ts           file helpers shared by sources (exists, findUp, readJson)
  rank.ts         frecency + fuzzy combination (pure)
  history.ts      load/save/prune history file
  command.ts      command for a task, from its runner (pure); shell quoting
  run.ts          spawn + signal forwarding
  picker.ts       @inquirer/search integration
  shell.ts        fish/zsh/bash wrappers for --init
scripts/
  homebrew-formula.ts   formula for zanthrash/homebrew-tap, from release checksums
```

A **task source** finds its own nearest project from where hop starts and returns tasks; each task records its **runner** (`pnpm`, later `mise`, `gradle`, `maven`), and the command to run it is built from that runner, not from one project-wide package manager. That's what lets one list mix runners. New runners are new files in `src/sources/`.

## v2: beyond Node, and native installs

Agreed 2026-10-17. Built in this order, each step releasable on its own:

1. **Standalone executable + Homebrew tap** (0.6.0)
2. **Task-runner abstraction** (no user-visible change)
3. **mise tasks** (0.7.0)
4. **Gradle** (0.8.0)
5. **Maven** (0.9.0)

### Distribution

- `bun build --compile` produces self-contained executables; no Node needed to install or run. Targets: macOS arm64 and x64, Linux x64 and arm64, built on each platform's CI runner.
- Values read from `package.json` at runtime (the version) are embedded at build time instead.
- **Homebrew** via a separate tap repo, `zanthrash/homebrew-tap`: `brew install zanthrash/tap/script-hop`. The formula installs the prebuilt executable per OS/arch (works on Homebrew for Linux too). No Apple signing/notarisation: Homebrew downloads don't carry the quarantine flag.
- Release flow: merging the version PR publishes npm (unchanged), builds the 4 executables, attaches them with SHA-256 checksums to the GitHub release, then updates the formula in the tap. The tap is written with a fine-grained token scoped to `homebrew-tap` (Contents: read/write), stored as a repo secret.
- npm stays as an install option.
- Later: AUR (`script-hop-bin`), `.deb`/`.rpm` on releases, a hosted apt/yum repo or COPR, Scoop/winget.
- Name notes: Homebrew's `hop` cask only installs `HOP.app` (no `hop` command), so there's no clash. The AUR has a package `hop`; check whether it installs a `hop` binary before publishing there (declare `conflicts` if so).
- Built with a pinned bun (dev dependency, 1.4.3). bun 1.3.12 produced unsigned macOS executables that Apple Silicon killed on launch (exit 137); 1.4.3 signs them ad hoc. CI checks the signature and re-signs ad hoc if needed.
- x64 executables use bun's `baseline` builds (no AVX2 requirement) for older CPUs.
- The end-to-end and real-shell tests run against each platform's executable (`HOP_BIN=…`) in CI on every push and before publishing.
- Checked with a real Homebrew install from a local tap: install, `brew test`, and the signature survives installation.

### Task runners

A project can have several runners; their tasks are merged into one list.

- Each task is labelled with its runner (`dev (pnpm)`, `build (gradle)`, `mn:run (maven)`, `lint (mise)`) only when more than one runner is present, so pure Node projects look unchanged. The runner name is searchable (`gradle build`).
- An exact name in several runners opens the picker filtered to it, unless frecency clearly favours one, in which case that one runs.
- Wrappers are preferred over global installs: `./gradlew` over `gradle`, `./mvnw` over `mvn`.
- hop doesn't pick a JDK: runners get the user's environment (e.g. `JAVA_HOME`/`PATH` from mise), exactly as when typing `./gradlew` by hand.

### mise tasks (built, 0.7.0)

- `sources/mise.ts`. mise is only started when a mise config or task directory exists in the project (`mise.toml`, `.mise.toml`, `.mise/tasks`, …), so other projects don't pay for it. `mise tasks --json` takes ~15 ms, so no cache.
- Tasks marked `global` are left out, and so are tasks whose source file is outside the repository root (nearest `.git`). Hidden tasks come with `--all-scripts` (`--hidden`). File tasks show their path as the command.
- mise reports real paths (symlinks resolved, e.g. `/var` → `/private/var` on macOS). Comparisons use real paths; tasks are shown and run under the path the user is in.
- Run with `mise run <task> -- <args>`; exit codes pass through. `mise --cd <dir>` is supported for the shell handoff but not needed (mise finds its config from subdirectories).
- Untrusted configs are skipped by mise without any message, so their tasks don't appear; documented (`mise trust`).
- History keys: package.json/deno.json scripts keep the bare name (existing history keeps working, and survives switching npm ↔ pnpm); other runners use `@<runner>:<name>`, so same-named tasks of two runners in one folder rank separately.
- Labels (`tags.ts`): runner shown in the picker and `--list` only when the list mixes runners, decided from the whole list (not the filtered one); the runner name is searchable only then, so `bu` in a bun project doesn't match everything.
- Same name in several runners at the same level: the task with at least twice the frecency of the next runs; otherwise the picker (non-TTY: error naming the runners).
- Tested against real mise with an isolated global config and trust settings; CI installs mise (`jdx/mise-action`) on Linux and macOS, including for the standalone executables.

### Gradle

- Tasks come from asking Gradle (`./gradlew tasks --all`), since most come from plugins and can't be read from build files.
- Cached per project; the cache is reused until build inputs change (`build.gradle*`, `settings.gradle*`, `gradle.properties`, `gradle/libs.versions.toml`, `buildSrc/`). `hop --refresh` forces a re-read. First read shows a spinner.
- One call at the root returns every module's tasks, so it serves both the default list and `--all`.
- Only grouped tasks are shown by default (Build, Application, Verification, Documentation and custom groups); ungrouped low-level tasks (`compileJava`, `processResources`, …) need `--all-scripts`.
- Failure (broken build, missing JDK, offline first run): other runners still show; one line explains (`hop: couldn't read Gradle tasks (exit 1); run "./gradlew tasks" to see why`); a previous cached list is used and marked stale; failures are never cached; reading gives up after 2 minutes (`HOP_GRADLE_TIMEOUT`).

### Maven

- Read from `pom.xml` directly (no Maven invocation): lifecycle phases (`clean`, `validate`, `compile`, `test`, `package`, `verify`, `install`, `deploy`, `site`), common combinations (`clean install`, `clean verify`, `clean package`), and goals of well-known plugins found in the POM from a built-in table, starting with Micronaut (`mn:run`), then Spring Boot, Quarkus, exec, jib, flyway and jetty, filled from each plugin's docs.
- Later: user-defined commands per project (e.g. `.hop.toml`), for any runner.

### Multi-module JVM builds

Mirrors Node workspaces: in a module, its tasks plus the root build's; at the root, the root's tasks; `--all` adds every module, labelled `run (api)`. Tasks run through the root wrapper with module-qualified commands that also replay correctly from history, e.g. `./gradlew :api:run` / `../gradlew :api:run`, and `./mvnw -pl api mn:run` / `../mvnw -f ../pom.xml -pl api mn:run`. Each form gets checked against real builds before relying on it.

## Future

- Shell integration for PowerShell and Git Bash on Windows.
- Tab to edit the command / add args before running.
- Multi-select, sequential or parallel runs.
- Additional task sources (Makefile, justfile, turbo.json).
- User-defined commands per project (`.hop.toml`).
- More install channels: AUR, `.deb`/`.rpm`, apt/yum repo or COPR, Scoop/winget.
