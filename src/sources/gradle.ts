import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import spawn from 'cross-spawn'
import { glob } from 'tinyglobby'
import { exists, findDirUp } from '../fs.ts'
import type { LoadOptions, SourceResult, Task, TaskSource } from '../types.ts'

/** Every project in a Gradle build with its tasks, as hop's init script reports them. */
export type GradleModel = {
  /** Gradle project path: `:` for the root, `:app`, `:services:api`. */
  path: string
  dir: string
  tasks: { name: string; group?: string | null; description?: string | null }[]
}[]

/** Asks Gradle for the build's model; rejects with a short reason. */
export type ReadGradle = (root: string, wrapper: boolean) => Promise<GradleModel>

const SETTINGS = ['settings.gradle', 'settings.gradle.kts']
const BUILD_FILES = ['build.gradle', 'build.gradle.kts']

// grouped, but not tasks people run day to day (dependencies, properties, wrapper, init…)
const HIDDEN_GROUPS = new Set(['help', 'build setup'])

/**
 * Tasks for a directory in a Gradle build, mirroring Node workspaces. At the root, each
 * task name once, run for every module that has it (`./gradlew build`, as Gradle itself
 * does). In a module, that module's tasks (`:app:build`) plus the root's it doesn't
 * have. With `all`, everything: the root's same-named tasks and every other module's.
 * Everything runs from the root, through its wrapper.
 */
export function tasksFromModel(model: GradleModel, root: string, cwd: string, opts: LoadOptions, wrapper: boolean): SourceResult {
  const visible = (task: GradleModel[number]['tasks'][number]) =>
    opts.allScripts || (!!task.group && !HIDDEN_GROUPS.has(task.group.toLowerCase()))
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)

  const make = (name: string, target: string, description: string | null | undefined, scope: Task['scope'], pkg?: string): Task => ({
    name,
    runner: 'gradle',
    command: target,
    ...(description ? { description } : {}),
    source: 'gradle',
    scope,
    ...(pkg ? { package: pkg } : {}),
    cwd: root,
    gradle: { target, wrapper },
  })

  // each name once; the description from the root project if it has one, else the first module's
  const everywhere = (scope: Task['scope']) => {
    const seen = new Map<string, string | null | undefined>()
    for (const project of model) {
      for (const task of project.tasks.filter(visible)) {
        if (!seen.get(task.name)) seen.set(task.name, task.description)
      }
    }
    return [...seen].map(([name, description]) => make(name, name, description, scope)).sort(byName)
  }
  const moduleTasks = (project: GradleModel[number], scope: Task['scope']) =>
    project.tasks.filter(visible).sort(byName)
      .map((task) => make(task.name, `${project.path}:${task.name}`, task.description, scope, scope === 'package' ? project.path.slice(1) : undefined))

  const inside = (dir: string) => cwd === dir || cwd.startsWith(dir + sep)
  const current = model
    .filter((project) => project.path !== ':' && inside(project.dir))
    .reduce<GradleModel[number] | undefined>((deepest, p) => (!deepest || p.dir.length > deepest.dir.length ? p : deepest), undefined)

  const others = opts.all
    ? model.filter((project) => project.path !== ':' && project !== current).flatMap((project) => moduleTasks(project, 'package'))
    : []

  if (!current) return { dir: root, tasks: [...everywhere('local'), ...others] }

  // In a module, `build` means the module's build, as typing `../gradlew build` there
  // would; the all-module one only comes with `all`
  const local = moduleTasks(current, 'local')
  const names = new Set(local.map((task) => task.name))
  const fromRoot = everywhere('root').filter((task) => opts.all || !names.has(task.name))
  return { dir: current.dir, root, tasks: [...local, ...fromRoot, ...others] }
}

/** Gradle tasks, read by asking Gradle (most come from plugins) and cached per build. */
export function createGradleSource(read: ReadGradle = readGradle): TaskSource {
  return {
    async load(cwd, opts) {
      // Gradle's own rule: the nearest settings file is the build; without one, a lone build file
      const root = (await findDirUp(SETTINGS, cwd)) ?? (await findDirUp(BUILD_FILES, cwd))
      if (!root) return undefined
      const wrapper = await exists(join(root, 'gradlew'))

      const { model, warning } = await cachedModel(root, wrapper, opts, read)
      const warnings = warning ? [warning] : undefined
      if (!model) return { dir: root, tasks: [], warnings }

      // Gradle reports real paths (e.g. /private/var for /var on macOS); show and match
      // directories under the path the user is actually in
      const realRoot = await realpath(root)
      const userPath = (p: string) => (p === realRoot || p.startsWith(realRoot + sep) ? root + p.slice(realRoot.length) : p)
      const mapped = model.map((project) => ({ ...project, dir: userPath(project.dir) }))
      return { ...tasksFromModel(mapped, root, cwd, opts, wrapper), warnings }
    },
  }
}

export const gradleSource = createGradleSource()

interface CacheEntry {
  version: 1
  root: string
  fingerprint: string
  readAt: number
  model: GradleModel
}

/** The build's model: cached while its build files are unchanged, else read from Gradle. */
async function cachedModel(root: string, wrapper: boolean, opts: LoadOptions, read: ReadGradle): Promise<{ model?: GradleModel; warning?: string }> {
  const file = opts.cacheDir ? join(opts.cacheDir, 'gradle', `${hash(root).slice(0, 16)}.json`) : undefined
  const cached = file ? await readCache(file, root) : undefined
  const print = file ? await fingerprint(root) : ''
  if (cached && !opts.refresh && cached.fingerprint === print) return { model: cached.model }

  const stop = opts.progress?.('Reading Gradle tasks…')
  let model: GradleModel
  try {
    model = await read(root, wrapper)
  } catch (error) {
    // never cached, so the next run asks Gradle again
    const why = `couldn't read Gradle tasks (${(error as Error).message}); run "${wrapper ? './gradlew' : 'gradle'} tasks" to see why`
    if (!cached) return { warning: why }
    return { model: cached.model, warning: `${why}. Showing the list from ${when(cached.readAt)}` }
  } finally {
    stop?.()
  }

  if (file) {
    const entry: CacheEntry = { version: 1, root, fingerprint: print, readAt: Date.now(), model }
    await writeAtomic(file, JSON.stringify(entry)).catch(() => {})
  }
  return { model }
}

async function readCache(file: string, root: string): Promise<CacheEntry | undefined> {
  try {
    const entry = JSON.parse(await readFile(file, 'utf8')) as CacheEntry
    return entry.version === 1 && entry.root === root ? entry : undefined
  } catch {
    return undefined
  }
}

// Files whose changes can add, remove or rename tasks. Convention plugins written as Kotlin
// or Java classes in buildSrc/build-logic are covered by their src folders; anything else
// needs `hop --refresh`.
const INPUTS = [
  '**/*.gradle', '**/*.gradle.kts', '**/gradle.properties',
  'gradle/*.versions.toml', 'gradle/wrapper/gradle-wrapper.properties',
  'buildSrc/src/**', 'build-logic/src/**',
]
const SKIP = ['**/build/**', '**/.gradle/**', '**/node_modules/**', '**/.git/**']

/** Changes whenever a build input is added, removed or modified. */
async function fingerprint(root: string): Promise<string> {
  const files = (await glob(INPUTS, { cwd: root, ignore: SKIP })).sort()
  const parts = await Promise.all(
    files.map(async (file) => {
      const info = await stat(join(root, file)).catch(() => undefined)
      return `${file}\0${info?.mtimeMs}\0${info?.size}`
    }),
  )
  return hash(parts.join('\n'))
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex')

function when(time: number): string {
  const d = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, text)
  await rename(temp, file)
}

/**
 * Groovy init script that writes every project's path, directory and tasks as JSON. It
 * hooks in after configuration instead of running a task, so it works whatever the build's
 * configuration cache settings, and only reports the top-level build (not buildSrc or
 * included builds, which init scripts also reach).
 */
const INIT_SCRIPT = `// Written by hop (script-hop) to list this build's tasks.
if (gradle.parent == null) {
  gradle.rootProject { root -> root.tasks.register('hopTasks') }
  gradle.projectsEvaluated { g ->
    def projects = g.rootProject.allprojects.collect { p ->
      [path: p.path, dir: p.projectDir.absolutePath,
       tasks: p.tasks.collect { t -> [name: t.name, group: t.group, description: t.description] }]
    }
    new File(System.getProperty('hop.out')).setText(groovy.json.JsonOutput.toJson(projects), 'UTF-8')
  }
}
`

/** Seconds to wait for Gradle; the first read may download Gradle itself. */
const timeout = () => Number(process.env.HOP_GRADLE_TIMEOUT) || 300

/** Ask the build's Gradle for its model, through an init script. */
async function readGradle(root: string, wrapper: boolean): Promise<GradleModel> {
  const work = await mkdtemp(join(tmpdir(), 'hop-gradle-'))
  try {
    const init = join(work, 'hop.init.gradle')
    const out = join(work, 'tasks.json')
    await writeFile(init, INIT_SCRIPT)
    const bin = wrapper ? join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew') : 'gradle'
    const args = [
      '-q', '--console=plain',
      // the init script reads projects in a way the configuration cache doesn't allow,
      // and every project must be configured to list all their tasks
      '--no-configuration-cache', '--no-configure-on-demand',
      '--init-script', init, `-Dhop.out=${out}`, 'hopTasks',
    ]
    await capture(bin, args, root, timeout(), wrapper)
    return JSON.parse(await readFile(out, 'utf8')) as GradleModel
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** Run Gradle quietly; rejects with a one-line reason when it fails. */
function capture(bin: string, args: string[], cwd: string, seconds: number, wrapper: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-64 * 1024)
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, seconds * 1000)

    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(new Error(error.code === 'ENOENT' && !wrapper ? 'no gradlew in the build, and gradle is not on PATH' : error.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) reject(new Error(`gave up after ${seconds} s; set HOP_GRADLE_TIMEOUT to wait longer`))
      else if (code !== 0) reject(new Error([`exit ${code}`, whatWentWrong(stderr)].filter(Boolean).join(': ')))
      else resolve()
    })
  })
}

/**
 * The first line of Gradle's "What went wrong" section, or else the first thing it printed
 * (e.g. the wrapper's "JAVA_HOME is not set" before Gradle starts).
 */
function whatWentWrong(stderr: string): string | undefined {
  const lines = stderr.split(/\r?\n/)
  const at = lines.findIndex((line) => line.includes('What went wrong'))
  return lines.slice(at + 1).find((line) => line.trim())?.trim()
}
