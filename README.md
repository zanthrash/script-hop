# script-hop

Fuzzy-find and run your project's scripts and tasks (package.json, deno.json, mise, Gradle, Maven). The ones you use most are always at the top.

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

Works with **npm, pnpm, yarn, bun and deno**, picking whichever your project uses, and with **mise** tasks, **Gradle** and **Maven** builds. Inspired by [ntl](https://github.com/ruyadorno/ntl).

## Install

**Homebrew** (macOS and Linux), a standalone executable that doesn't need Node:

```sh
brew install zanthrash/tap/script-hop
```

**npm**, if you prefer (Node.js 22 or later):

```sh
npm install -g script-hop
```

Either way the command is `hop`. With a Node version manager (fnm, nvm, mise), an npm install belongs to one Node version and has to be reinstalled when you switch; the Homebrew install doesn't. If you move from npm to Homebrew, remove the npm copy (`npm uninstall -g script-hop`) so it doesn't shadow the Homebrew one on your `PATH`.

## Usage

```sh
hop                 # open the picker
hop dev             # run "dev" straight away
hop bld             # no script called "bld": open the picker filtered to "bld"
hop -l              # rerun the last script you ran in this project
hop -a              # include every workspace package's scripts (monorepos)
hop test -- --watch # pass extra arguments to the script
```

In the picker, type to filter, use ↑/↓ to move, Enter to run, and Esc or Ctrl-C to cancel.

### Shell integration

Normally your shell history records `hop`, not the script it ran. With shell integration, `hop` hands the command back to your shell, which runs it and saves the real command (`pnpm run dev`, `npm run test -- --watch`) to history, so ↑ and history search find it.

**fish**: add to `~/.config/fish/config.fish`:

```fish
hop --init fish | source
```

Adding to history needs fish 4.0 or later. On fish 3.x, scripts still run through your shell, and `hop` tells you once per session that history is skipped.

**bash**: add to `~/.bashrc`:

```bash
eval "$(hop --init bash)"
```

In bash, the real command takes the place of the `hop` line in history. It works with bash 3.2 (macOS's built-in `/bin/bash`) and later.

If you use [atuin](https://atuin.sh), the command is also recorded in atuin's history, so atuin's ↑ and Ctrl-R find it too.

**zsh**: add to `~/.zshrc`:

```zsh
eval "$(hop --init zsh)"
```

Workspace-root scripts are saved with their directory spelled out (e.g. `pnpm --dir ../.. run lint`), so rerunning them from history works from the same place.

### Options

| Option | |
|---|---|
| `-l`, `--last` | Rerun the last script run in this project |
| `-a`, `--all` | Include the scripts of every workspace package |
| `--list` | Print scripts in ranked order (`name<TAB>command`, plus a third column with the same labels as the picker: runner when mixed, `root`, package) and exit |
| `--pm <name>` | Use this package manager: `npm`, `pnpm`, `yarn`, `bun` or `deno` |
| `--all-scripts` | Include lifecycle scripts and pre/post hooks, and Gradle's ungrouped, help and build setup tasks |
| `--refresh` | Read Gradle's task list again instead of using the cached one |
| `--reset-history` | Forget all usage history |
| `--init <shell>` | Print shell integration for `fish`, `zsh` or `bash` |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show the version |

| Environment variable | |
|---|---|
| `HOP_PM` | Same as `--pm` |
| `HOP_HISTORY` | Where to keep usage history |
| `HOP_CACHE` | Where to cache Gradle task lists |
| `HOP_GRADLE_TIMEOUT` | Seconds to wait for Gradle to list tasks (default 300) |

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

With `-a` / `--all`, every package in the workspace is included, labelled with its name, e.g. `test (api)`. Each script runs in its own package's directory. Package names are searchable, so typing `api test` finds `test (api)`. `hop -a migrate` runs `migrate` straight away if only one package has it; if several do, the picker opens so you can choose (the current package and root still win when they have it).

### Deno

When deno is the runner, tasks from `deno.json` / `deno.jsonc` are listed alongside package.json scripts, labelled `(deno)`. If both define the same name, deno.json wins, as with `deno task`.

### mise tasks

If the project has [mise](https://mise.jdx.dev) tasks (`[tasks]` in `mise.toml`, or scripts in `.mise/tasks/`), they're listed alongside package.json scripts and run with `mise run`. Only tasks defined inside the project are shown, not ones from your global mise config. Hidden tasks (`hide = true`) appear with `--all-scripts`. mise skips config files you haven't trusted, so run `mise trust` in a new project if its tasks don't show up.

When a project mixes runners, each task is labelled with the one that runs it:

```
❯ build (pnpm)
  build (mise)
  dev (pnpm)
  lint (mise)
```

The runner name is searchable (`mise b` finds `build (mise)`). If you type a name more than one runner defines, such as `hop build`, the picker opens so you can choose, unless you've clearly used one of them more, in which case that one runs.

### Gradle

In a Gradle build, `hop` lists the build's tasks and runs them through the build's `./gradlew` (or `gradle` from your PATH if there's no wrapper). It uses whichever Java your environment provides, exactly as typing `./gradlew` would.

Gradle has to be asked for its tasks, since most come from plugins, so the first `hop` in a build shows `Reading Gradle tasks…` for a second or so (longer if the wrapper still has to download Gradle). The list is then cached until a build file changes (`*.gradle`, `*.gradle.kts`, `gradle.properties`, the version catalog, `buildSrc`), so after that `hop` is instant. If you change tasks some other way, `hop --refresh` reads them again.

Tasks people run day to day are shown: anything with a group, like `build`, `test`, `run`, `clean`, `javadoc` or your own grouped tasks. Ungrouped tasks (`compileJava`, …) and the help and build-setup groups (`dependencies`, `wrapper`, …) come with `--all-scripts`.

Multi-module builds work like workspaces:

| Where you are | What's listed | Runs as |
|---|---|---|
| The build's root | Each task once, run in every module that has it | `./gradlew test` |
| In a module (`app/src/…`) | That module's tasks | `../../gradlew :app:test` |
| | plus the root's tasks the module doesn't have, labelled `(root)` | `../../gradlew -p ../.. run` |
| With `-a` | Also every other module's tasks, e.g. `test (lib)` | `../../gradlew :lib:test` |

If Gradle can't list the tasks (a broken build script, no Java), `hop` says why in one line, still shows your other scripts, and uses the last list it read if it has one.

### Maven

In a Maven build, `hop` lists the lifecycle phases (`clean`, `compile`, `test`, `package`, `verify`, `install`, `deploy`, …), the combinations people type all the time (`clean install`, `clean verify`, `clean package`), and the everyday goals of well-known plugins your POMs use:

| Plugin | Goals |
|---|---|
| Micronaut | `mn:run`, `mn:dockerfile` |
| Spring Boot | `spring-boot:run`, `spring-boot:test-run`, `spring-boot:build-image` |
| Quarkus | `quarkus:dev`, `quarkus:test`, `quarkus:build`, `quarkus:image-build` |
| exec | `exec:java`, `exec:exec` |
| Jib | `jib:build`, `jib:dockerBuild`, `jib:buildTar` |
| Flyway | `flyway:migrate`, `flyway:info`, `flyway:validate`, `flyway:repair`, `flyway:baseline` |
| Jetty | `jetty:run`, `jetty:run-war` |

It reads `pom.xml` files directly, so listing is instant and Maven isn't started until you run something. Tasks run through the build's `./mvnw` (or `mvn` from your PATH). `hop clean install` runs the combination by name.

Multi-module builds work like workspaces:

| Where you are | What's listed | Runs as |
|---|---|---|
| The build's root | Phases for the whole build | `./mvnw clean install` |
| | plus each module's plugin goals, labelled with the module | `./mvnw -pl app -am mn:run` |
| In a module (`app/src/…`) | That module's phases and goals | `../../mvnw -f ../.. -pl app -am test` |
| With `-a` | Also the build's phases and every module's tasks | |

`-am` makes Maven build the modules `app` depends on first, so it works in a fresh checkout. Plugin goals other than Micronaut's run with plain `-pl app`, because with `-am` Maven would run the goal in those other modules too, where it usually fails; run `install` once first if `app` depends on other modules.

### Hidden scripts

Lifecycle scripts (`install`, `prepare`, `prepublishOnly`, …) and `pre`/`post` hooks with a matching script (`prebuild` next to `build`) are hidden. Use `--all-scripts` to show them.

Hooks aren't forgotten, though. When your package manager will run them, the picker says so under the selected script:

```
tsc  ·  runs prebuild → build → postbuild
```

npm, pnpm, bun and Yarn 1 run hooks; Yarn 2+ doesn't, so no chain is shown there.

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
pnpm build      # bundles to dist/cli.mjs (the npm package)
pnpm build:bin  # standalone executable for this machine: build/hop
HOP_BIN=build/hop pnpm vitest run test/e2e.test.ts test/shell.test.ts  # test it
```

See [SPEC.md](SPEC.md) for the design.

### Releasing

Releases use [Changesets](https://changesets.dev):

1. With a change, run `pnpm changeset` and commit the generated file.
2. On `main`, the Release workflow opens a "Release: version packages" PR that bumps the version and updates `CHANGELOG.md`.
3. Merging that PR publishes to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers), with no npm token, and creates a GitHub release. Standalone executables for macOS and Linux (arm64 and x64) are then built and tested on each platform, attached to the release with checksums, and the formula in [zanthrash/homebrew-tap](https://github.com/zanthrash/homebrew-tap) is updated. That last step uses the `HOMEBREW_TAP_TOKEN` secret: a fine-grained token with Contents read/write on `homebrew-tap` only.

npm only allows trusted publishing for a package that already exists, so the very first version has to be published by hand:

1. Merge the first version PR, then on an up-to-date `main` run `pnpm build && npm publish`.
2. On npmjs.com, under the package's **Settings → Trusted publishing**, add GitHub Actions with repository `zanthrash/script-hop`, workflow `release.yml` and environment `npm`.

After that, every merged version PR publishes automatically.

## License

MIT
