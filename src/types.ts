export const PMS = ['npm', 'pnpm', 'yarn', 'bun', 'deno'] as const
export type PM = (typeof PMS)[number]

/** What runs a task: a Node package manager, mise, Gradle or Maven. */
export type RunnerId = PM | 'mise' | 'gradle' | 'maven'

export interface Task {
  name: string
  /** The tool that runs this task. */
  runner: RunnerId
  command: string
  description?: string
  /** Which file the task is defined in. */
  source: 'pkg' | 'deno' | 'mise' | 'gradle' | 'maven'
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
  /**
   * For Gradle tasks: what to ask Gradle for (`:app:run` for one module, `build` for every
   * module that has it), and whether the build has its own `gradlew`.
   */
  gradle?: { target: string; wrapper: boolean }
  /**
   * For Maven tasks: the phases or goals to run, the module they're for (its path from the
   * build root, for `-pl`), whether to also build the modules it depends on (`-am`), and
   * whether the build has its own `mvnw`.
   */
  maven?: { goals: string[]; module?: string; alsoMake?: boolean; wrapper: boolean }
}

export interface Project {
  /** The Node package manager, when the project has Node tasks. */
  pm: PM
  /** Nearest directory with a task source's manifest (package.json, deno.json, …). */
  dir: string
  /** Workspace root above `dir`, if any. */
  root?: string
  tasks: Task[]
  /** One-line problems worth telling the user about, e.g. a build Gradle couldn't read. */
  warnings: string[]
}

export interface LoadOptions {
  /** Force a package manager instead of detecting one. */
  pm?: PM
  /** Include lifecycle scripts and pre/post hooks. */
  allScripts?: boolean
  /** Include the scripts of every workspace package. */
  all?: boolean
  /** Where task lists that are slow to get (Gradle's) are cached; no caching without it. */
  cacheDir?: string
  /** Ignore cached task lists. */
  refresh?: boolean
  /** Show that something slow is happening; returns a function that ends it. */
  progress?: (message: string) => () => void
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
  warnings?: string[]
}

/**
 * One kind of task definition (package.json scripts, mise, Gradle, Maven).
 * Finds its own nearest project from `cwd`; resolves to undefined when there is none.
 */
export interface TaskSource {
  load(cwd: string, opts: LoadOptions): Promise<SourceResult | undefined>
}
