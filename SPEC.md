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
- Shell history integration (planned for v2 — see Future).
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
- *Not yet built:* showing `pre`/`post` hooks that will run (e.g. `prebuild → build → postbuild`). Only npm, bun and Yarn 1 run them; pnpm and Yarn 2+ don't, so this needs the Yarn major version from detection.

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

- `hop init fish|zsh|bash|pwsh` shell integration so the real command lands in shell history.
- `-a/--all`: every workspace package's scripts, run via `--filter` / `-w` / `workspace`.
- Tab to edit the command / add args before running.
- Multi-select, sequential or parallel runs.
- Additional task sources (Makefile, justfile, turbo.json).
- Standalone `bun build --compile` binaries via Homebrew.
