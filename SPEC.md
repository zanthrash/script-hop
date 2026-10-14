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
- Listing every workspace package's scripts (reserved as `-a/--all`).
- Config files.
- Task sources beyond package.json and deno.json (Makefile, justfile, turbo…).

## CLI

```
hop                 open the picker
hop <query>         exact script name match → run immediately; otherwise open picker pre-filtered
hop -l, --last      rerun the last script in this project, no picker
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

### Module layout (proposed)

```
src/
  cli.ts          entry point: wires real IO into main
  app.ts          main(argv, io): arg parsing, flow, exit codes (tested with fake IO)
  tasks.ts        project discovery, PM detection, task sources, workspaces
  rank.ts         frecency + fuzzy combination (pure)
  history.ts      load/save/prune history file
  command.ts      build run command per manager (pure)
  run.ts          spawn + signal forwarding
  picker.ts       @inquirer/search integration
```

## Future (post-v1)

- Shell integration for PowerShell and Git Bash on Windows.
- `-a/--all`: every workspace package's scripts, run via `--filter` / `-w` / `workspace`.
- Tab to edit the command / add args before running.
- Multi-select, sequential or parallel runs.
- Additional task sources (Makefile, justfile, turbo.json).
- Standalone `bun build --compile` binaries via Homebrew.
