import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { dirname, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { findDirUp, findUp } from '../fs.ts'
import type { LoadOptions, SourceResult, Task, TaskSource } from '../types.ts'

const run = promisify(execFile)

// Files and directories mise reads tasks from. hop only asks mise when one of these is in
// the project, so projects without mise never pay for starting it.
const MARKERS = [
  'mise.toml', '.mise.toml', 'mise.local.toml', '.mise.local.toml',
  '.mise/config.toml', 'mise/config.toml', '.config/mise.toml', '.config/mise/config.toml',
  '.mise/tasks', 'mise/tasks', 'mise-tasks', '.mise-tasks', '.config/mise/tasks',
]

/** The fields hop uses from `mise tasks --json`. */
interface MiseTask {
  name: string
  description?: string
  source: string
  dir?: string | null
  hide?: boolean
  global?: boolean
  run?: string[]
}

/** Tasks from mise config files and task directories, run with `mise run`. */
export const miseSource: TaskSource = { load }

async function load(cwd: string, opts: LoadOptions): Promise<SourceResult | undefined> {
  const dir = await findDirUp(MARKERS, cwd)
  if (!dir) return undefined

  let listed: MiseTask[]
  try {
    const args = ['tasks', '--json', ...(opts.allScripts ? ['--hidden'] : [])]
    const { stdout } = await run('mise', args, { cwd, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 })
    listed = JSON.parse(stdout)
  } catch {
    // mise not installed, or failed: its tasks just don't appear
    return undefined
  }

  // mise reports real paths (symlinks resolved, e.g. /var -> /private/var on macOS or a
  // symlinked ~/code). Compare in real paths, but show and run tasks under the path the
  // user is actually in.
  const realDir = await realpath(dir)
  const userPath = (p: string) => (p === realDir || p.startsWith(realDir + sep) ? dir + p.slice(realDir.length) : p)

  // Only tasks defined inside the project: not the global config, and not configs in
  // directories above the repository (e.g. a mise.toml in ~/projects).
  const gitDir = await findUp('.git', dir)
  const repoRoot = gitDir ? await realpath(dirname(gitDir)) : undefined
  const inside = (file: string) => !repoRoot || file === repoRoot || file.startsWith(repoRoot + sep)

  const tasks = listed
    .filter((t) => !t.global && inside(t.source))
    .map((t): Task => {
      const taskDir = t.dir ? userPath(t.dir) : dir
      // file tasks have no `run`; show where the script lives instead
      const command = t.run?.length
        ? t.run.map((line) => line.trim().replace(/\s*\n\s*/g, '; ')).join(' && ')
        : relative(taskDir, userPath(t.source)).split(sep).join('/')
      return {
        name: t.name,
        runner: 'mise',
        command,
        description: t.description || undefined,
        source: 'mise',
        scope: 'local',
        cwd: taskDir,
      }
    })

  return { dir, tasks }
}
