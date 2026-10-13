import { readFile, writeFile } from 'node:fs/promises'
import { relative, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { buildCommand, toShell, type Command } from './command.ts'
import { openHistory } from './history.ts'
import { rank, type Ranked } from './rank.ts'
import { isShell, SHELLS } from './shell.ts'
import { loadProject, PMS, type PM, type Task } from './tasks.ts'

/** Everything `main` touches outside its own logic, injected so it can be tested. */
export interface IO {
  cwd: string
  now: () => number
  isTTY: boolean
  env: Record<string, string | undefined>
  historyFile: string
  stdout: (text: string) => void
  stderr: (text: string) => void
  /**
   * Show the picker, starting from `query`. `search` ranks tasks for the current input.
   * Resolves to the chosen task, or undefined if cancelled.
   */
  pick: (search: (query: string) => Ranked[], query: string) => Promise<Task | undefined>
  /** Run a command attached to the terminal; resolves to its exit code. */
  exec: (command: Command, cwd: string) => Promise<number>
}

const HELP = `Usage: hop [query] [options] [-- args]

Pick a package.json script with fuzzy search; most-used scripts come first.

  hop                 open the picker
  hop <query>         run the script named <query>, or open the picker filtered by it
  hop -- <args>       append <args> to the chosen script

Options:
  -l, --last          rerun the last script run in this project
      --list          print scripts in ranked order and exit
      --pm <name>     use this package manager (${PMS.join(', ')}); also HOP_PM
      --all-scripts   include lifecycle and pre/post hook scripts
      --reset-history forget all usage history
      --init <shell>  print shell integration (fish, zsh) so chosen scripts
                      run in your shell and land in its history
  -h, --help          show this help
  -v, --version       show the version
`

class UsageError extends Error {}

function parsePM(value: string | undefined): PM | undefined {
  if (value === undefined) return undefined
  if ((PMS as readonly string[]).includes(value)) return value as PM
  throw new UsageError(`Unknown package manager "${value}". Expected one of: ${PMS.join(', ')}`)
}

function parse(argv: string[], env: IO['env']) {
  // everything after `--` belongs to the script, not to hop
  const separator = argv.indexOf('--')
  const ownArgs = separator === -1 ? argv : argv.slice(0, separator)
  const extraArgs = separator === -1 ? [] : argv.slice(separator + 1)

  try {
    const { values, positionals } = parseArgs({
      args: ownArgs,
      allowPositionals: true,
      options: {
        last: { type: 'boolean', short: 'l' },
        list: { type: 'boolean' },
        pm: { type: 'string' },
        'all-scripts': { type: 'boolean' },
        'reset-history': { type: 'boolean' },
        init: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    })
    return { ...values, pm: parsePM(values.pm ?? (env.HOP_PM || undefined)), query: positionals.join(' '), extraArgs }
  } catch (error) {
    if (error instanceof UsageError) throw error
    throw new UsageError((error as Error).message)
  }
}

async function version(): Promise<string> {
  // src/app.ts in development, dist/cli.js when built: package.json is one level up either way
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  return pkg.version
}

export async function main(argv: string[], io: IO): Promise<number> {
  try {
    return await hop(argv, io)
  } catch (error) {
    io.stderr(`hop: ${(error as Error).message}\n`)
    return 1
  }
}

async function hop(argv: string[], io: IO): Promise<number> {
  const args = parse(argv, io.env)

  if (args.help) {
    io.stdout(HELP)
    return 0
  }
  if (args.version) {
    io.stdout(`${await version()}\n`)
    return 0
  }
  if (args.init !== undefined) {
    if (!isShell(args.init)) {
      throw new UsageError(`Unsupported shell "${args.init}". Supported: ${Object.keys(SHELLS).join(', ')}`)
    }
    io.stdout(SHELLS[args.init])
    return 0
  }

  const history = await openHistory(io.historyFile)
  if (history.warning) io.stderr(`hop: ${history.warning}\n`)

  if (args['reset-history']) {
    await history.reset()
    io.stderr('History cleared\n')
    return 0
  }

  const project = await loadProject(io.cwd, { pm: args.pm, allScripts: args['all-scripts'] })
  if (project.tasks.length === 0) {
    io.stderr(`No scripts in ${project.dir}\n`)
    return 0
  }

  const search = (q: string) => rank(project.tasks, history.usage(), q, io.now())

  if (args.list || (!io.isTTY && args.query === '')) {
    for (const { task } of search('')) io.stdout(`${task.name}\t${task.command}\n`)
    return 0
  }

  if (args.last) {
    const last = lastRun(project.tasks)
    if (last) return run(last)
    io.stderr('No previous run here\n')
  }

  // tasks are ordered local-first, so an exact local name wins over a root one
  const exact = args.query ? project.tasks.find((t) => t.name === args.query) : undefined
  if (exact) return run(exact)

  if (!io.isTTY) {
    io.stderr(`No script named "${args.query}"\n`)
    return 1
  }

  const picked = await io.pick(search, args.query)
  return picked ? run(picked) : 130

  function lastRun(tasks: Task[]): Task | undefined {
    const usage = history.usage()
    let latest: Task | undefined
    let latestAt = -Infinity
    for (const t of tasks) {
      const at = usage[t.cwd]?.[t.name]?.lastRun ?? -Infinity
      if (at > latestAt) [latest, latestAt] = [t, at]
    }
    return latest
  }

  async function run(task: Task): Promise<number> {
    try {
      await history.record(task.cwd, task.name, io.now())
    } catch (error) {
      // history is a convenience; never let it stop the script from running
      io.stderr(`hop: could not save history: ${(error as Error).message}\n`)
    }

    const handoff = io.env.HOP_CMD_FILE
    if (handoff) {
      // Shell integration: the wrapper function runs the command in the user's shell and
      // adds it to history, so it must work as typed from here. Local scripts are found
      // by the runner walking up; root scripts need the directory spelled out.
      // forward slashes: the line is for fish/zsh, and runners accept them on Windows too
      const dir = task.scope === 'root' ? relative(io.cwd, task.cwd).split(sep).join('/') || '.' : undefined
      const line = toShell(buildCommand(project.pm, task.name, args.extraArgs, dir))
      await writeFile(handoff, `${line}\n`)
      return 0
    }

    const command = buildCommand(project.pm, task.name, args.extraArgs)
    io.stderr(`› ${toShell(command)}\n`)
    return io.exec(command, task.cwd)
  }
}
