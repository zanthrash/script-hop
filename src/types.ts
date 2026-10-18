export const PMS = ['npm', 'pnpm', 'yarn', 'bun', 'deno'] as const
export type PM = (typeof PMS)[number]

/** What runs a task: a Node package manager, or mise (Gradle and Maven to come). */
export type RunnerId = PM | 'mise'

export interface Task {
  name: string
  /** The tool that runs this task. */
  runner: RunnerId
  command: string
  description?: string
  /** Which file the task is defined in. */
  source: 'pkg' | 'deno' | 'mise'
  /**
   * Where the task comes from: the nearest package (`local`), the workspace root (`root`),
   * or, with `--all`, another workspace package (`package`).
   */
  scope: 'local' | 'root' | 'package'
  /** For `package` tasks: the package's name, or its path from the workspace root. */
  package?: string
  /** Directory to run the task in. */
  cwd: string
  /** `pre<name>` / `post<name>` scripts the runner will run around this one, if any. */
  hooks?: { pre?: string; post?: string }
}

export interface Project {
  /** The Node package manager, when the project has Node tasks. */
  pm: PM
  /** Nearest directory with a task source's manifest (package.json, deno.json, …). */
  dir: string
  /** Workspace root above `dir`, if any. */
  root?: string
  tasks: Task[]
}

export interface LoadOptions {
  /** Force a package manager instead of detecting one. */
  pm?: PM
  /** Include lifecycle scripts and pre/post hooks. */
  allScripts?: boolean
  /** Include the scripts of every workspace package. */
  all?: boolean
}

/** What a task source found for the directory hop was started in. */
export interface SourceResult {
  /** Nearest directory at or above the start with this source's manifest. */
  dir: string
  /** Workspace root above `dir`, if any. */
  root?: string
  tasks: Task[]
  /** For the Node source: the package manager in use. */
  pm?: PM
}

/**
 * One kind of task definition (package.json scripts, and later mise, Gradle, Maven).
 * Finds its own nearest project from `cwd`; resolves to undefined when there is none.
 */
export interface TaskSource {
  load(cwd: string, opts: LoadOptions): Promise<SourceResult | undefined>
}
