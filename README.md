# script-hop

Fuzzy-find and run your package.json scripts. The ones you use most are always at the top.

```
$ hop
? Run script
❯ dev
  test
  build
  lint
  docs:dev (root)

vite --port 3000
```

Works with **npm, pnpm, yarn, bun and deno**, picking whichever your project uses. Inspired by [ntl](https://github.com/ruyadorno/ntl).

## Install

```sh
npm install -g script-hop
```

Requires Node.js 22 or later. The command is `hop`.

## Usage

```sh
hop                 # open the picker
hop dev             # run "dev" straight away
hop bld             # no script called "bld": open the picker filtered to "bld"
hop -l              # rerun the last script you ran in this project
hop test -- --watch # pass extra arguments to the script
```

In the picker, type to filter, use ↑/↓ to move, Enter to run, and Esc or Ctrl-C to cancel.

### Options

| Option | |
|---|---|
| `-l`, `--last` | Rerun the last script run in this project |
| `--list` | Print scripts in ranked order (`name<TAB>command`) and exit |
| `--pm <name>` | Use this package manager: `npm`, `pnpm`, `yarn`, `bun` or `deno` |
| `--all-scripts` | Include lifecycle scripts and pre/post hooks |
| `--reset-history` | Forget all usage history |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show the version |

| Environment variable | |
|---|---|
| `HOP_PM` | Same as `--pm` |
| `HOP_HISTORY` | Where to keep usage history |

## How it works

### Ranking

With nothing typed, the script you ran last comes first, then the rest by *frecency*: how often you've run them, weighted toward recent use (a run's weight halves every week). Scripts you've never run follow, alphabetically.

While typing, the closest match wins. Matches on the script name come before matches on its command, so typing `vite` finds `vite-legacy` first, then `dev: vite --port 3000`. When two matches are equally good, an exact name wins, then whichever you use more.

History is stored per project in your user data folder and never in the repo. Entries you haven't used for 90 days are dropped.

### Package manager

Chosen in this order:

1. `--pm` or `HOP_PM`
2. The `packageManager` field in package.json
3. A lockfile in the project or a parent folder (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `package-lock.json`, `deno.lock`)
4. A `deno.json` with no package.json
5. Otherwise npm

`hop` prints the command it runs (e.g. `› pnpm run dev`) and exits with the script's exit code, so it's safe to use in `&&` chains.

### Monorepos

Inside a workspace package, you see that package's scripts plus the workspace root's scripts, labelled `(root)`. Root scripts run from the root. Workspaces are recognised from `pnpm-workspace.yaml`, a `workspaces` field in package.json, or a deno `workspace`.

### Deno

When deno is the runner, tasks from `deno.json` / `deno.jsonc` are listed alongside package.json scripts, labelled `(deno)`. If both define the same name, deno.json wins, as with `deno task`.

### Hidden scripts

Lifecycle scripts (`install`, `prepare`, `prepublishOnly`, …) and `pre`/`post` hooks with a matching script (`prebuild` next to `build`) are hidden. Use `--all-scripts` to show them.

### Descriptions

Add descriptions to show them in the picker instead of the raw command:

```json
{
  "scripts": { "dev": "vite --port 3000" },
  "hop": { "descriptions": { "dev": "Start the dev server" } }
}
```

`ntl.descriptions` and `scripts-info` are read too, so existing ntl descriptions work as-is. Deno tasks can use their own `description` field.

### Scripting

When not attached to a terminal, `hop` never prompts: `hop` on its own prints the list, `hop <name>` runs that exact script, and anything else fails with exit code 1.

```sh
hop --list | cut -f1 | fzf | xargs hop
```

## Development

```sh
pnpm install
pnpm test       # unit and end-to-end tests
pnpm typecheck
pnpm build      # bundles to dist/cli.mjs
```

See [SPEC.md](SPEC.md) for the design.

### Releasing

Releases use [Changesets](https://changesets.dev):

1. With a change, run `pnpm changeset` and commit the generated file.
2. On `main`, the Release workflow opens a "Release: version packages" PR that bumps the version and updates `CHANGELOG.md`.
3. Merging that PR publishes to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers), with no npm token, and creates a GitHub release.

npm only allows trusted publishing for a package that already exists, so the very first version has to be published by hand:

1. Merge the first version PR, then on an up-to-date `main` run `pnpm build && npm publish`.
2. On npmjs.com, under the package's **Settings → Trusted publishing**, add GitHub Actions with repository `zanthrash/script-hop`, workflow `release.yml` and environment `npm`.

After that, every merged version PR publishes automatically.

## License

MIT
