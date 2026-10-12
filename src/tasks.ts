import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { detect } from 'package-manager-detector/detect'

export const PMS = ['npm', 'pnpm', 'yarn', 'bun', 'deno'] as const
export type PM = (typeof PMS)[number]

const isPM = (name: string | undefined): name is PM =>
  (PMS as readonly string[]).includes(name ?? '')

export interface Task {
  name: string
  command: string
  description?: string
  /** Which file the task is defined in. */
  source: 'pkg' | 'deno'
  /** `root` tasks come from the workspace root rather than the nearest package. */
  scope: 'local' | 'root'
  /** Directory to run the task in. */
  cwd: string
  /** `pre<name>` / `post<name>` scripts the runner will run around this one, if any. */
  hooks?: { pre?: string; post?: string }
}

export interface Project {
  pm: PM
  /** Nearest directory with a package.json or deno.json. */
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
}

// npm lifecycle scripts that run implicitly and are rarely invoked by hand
const LIFECYCLE = new Set([
  'preinstall', 'install', 'postinstall',
  'preuninstall', 'uninstall', 'postuninstall',
  'prepublish', 'prepublishOnly', 'publish', 'postpublish',
  'prepack', 'postpack', 'prepare',
  'preversion', 'version', 'postversion',
  'dependencies',
])

function isHidden(name: string, scripts: Record<string, string>): boolean {
  if (LIFECYCLE.has(name)) return true
  const hook = /^(pre|post)(.+)$/.exec(name)
  return hook !== null && hook[2]! in scripts
}

async function detectPM(cwd: string, hasDenoConfig: boolean): Promise<PM> {
  const detected = await detect({ cwd })
  if (isPM(detected?.name)) return detected.name
  return hasDenoConfig ? 'deno' : 'npm'
}

const exists = (path: string) => access(path).then(() => true, () => false)

/** Nearest directory at or above `from` containing `file`. */
async function findUp(file: string, from: string): Promise<string | undefined> {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (await exists(join(dir, file))) return join(dir, file)
    if (dirname(dir) === dir) return undefined
  }
}

/** Yarn 2+ dropped pre/post scripts; tell it apart from Yarn 1. */
async function isYarnBerry(dir: string, packageManagers: unknown[]): Promise<boolean> {
  for (const field of packageManagers) {
    const major = typeof field === 'string' ? /^yarn@\^?(\d+)/.exec(field)?.[1] : undefined
    if (major) return Number(major) >= 2
  }
  if (await findUp('.yarnrc.yml', dir)) return true
  const lockfile = await findUp('yarn.lock', dir)
  return lockfile !== undefined && (await readFile(lockfile, 'utf8')).includes('__metadata:')
}

/** Whether `<runner> run x` also runs `prex` and `postx`. */
async function runsHooks(pm: PM, dir: string, packageManagers: unknown[]): Promise<boolean> {
  switch (pm) {
    case 'npm':
    case 'pnpm':
    case 'bun':
      return true
    case 'yarn':
      return !(await isYarnBerry(dir, packageManagers))
    case 'deno':
      return false
  }
}

const MANIFESTS = ['package.json', 'deno.json', 'deno.jsonc']

/** Nearest directory at or above `from` containing any manifest. */
async function findProjectDir(from: string): Promise<string | undefined> {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    for (const file of MANIFESTS) if (await exists(join(dir, file))) return dir
    if (dirname(dir) === dir) return undefined
  }
}

async function readJson(path: string): Promise<any | undefined> {
  if (!(await exists(path))) return undefined
  return parseJsonc(await readFile(path, 'utf8'))
}

async function readDenoConfig(dir: string): Promise<any | undefined> {
  return (await readJson(join(dir, 'deno.json'))) ?? (await readJson(join(dir, 'deno.jsonc')))
}

type TaskDef = Omit<Task, 'scope' | 'cwd'>

function denoTasks(config: any): TaskDef[] {
  return Object.entries<unknown>(config?.tasks ?? {}).flatMap(([name, def]): TaskDef[] => {
    if (typeof def === 'string') return [{ name, command: def, source: 'deno' }]
    if (def && typeof def === 'object' && 'command' in def && typeof def.command === 'string') {
      const description = 'description' in def && typeof def.description === 'string'
        ? def.description
        : undefined
      return [{ name, command: def.command, description, source: 'deno' }]
    }
    return []
  })
}

type Descriptions = Record<string, unknown>

/** Merge description sources; earlier sources win. */
function descriptionsOf(pkg: any): Record<string, string> {
  const sources: (Descriptions | undefined)[] = [
    pkg.hop?.descriptions,
    pkg.ntl?.descriptions,
    pkg['scripts-info'],
  ]
  const result: Record<string, string> = {}
  for (const source of sources.reverse()) {
    for (const [name, text] of Object.entries(source ?? {})) {
      if (typeof text === 'string') result[name] = text
    }
  }
  return result
}

function hooksFor(name: string, scripts: Record<string, string>): Task['hooks'] {
  const pre = scripts[`pre${name}`]
  const post = scripts[`post${name}`]
  if (pre === undefined && post === undefined) return undefined
  return { ...(pre !== undefined && { pre }), ...(post !== undefined && { post }) }
}

function packageScripts(pkg: any, allScripts: boolean, withHooks: boolean): TaskDef[] {
  const scripts: Record<string, string> = pkg?.scripts ?? {}
  const descriptions = descriptionsOf(pkg ?? {})
  return Object.entries(scripts)
    .filter(([name]) => allScripts || !isHidden(name, scripts))
    .map(([name, command]) => ({
      name,
      command,
      description: descriptions[name],
      source: 'pkg',
      hooks: withHooks ? hooksFor(name, scripts) : undefined,
    }))
}

interface Manifests {
  pkg: any
  deno: any
}

async function readManifests(dir: string): Promise<Manifests> {
  return { pkg: await readJson(join(dir, 'package.json')), deno: await readDenoConfig(dir) }
}

function isWorkspaceRoot(m: Manifests, hasPnpmWorkspace: boolean): boolean {
  return hasPnpmWorkspace || m.pkg?.workspaces !== undefined || m.deno?.workspace !== undefined
}

/** Nearest workspace root strictly above `dir`. */
async function findWorkspaceRoot(dir: string): Promise<string | undefined> {
  for (let d = dirname(dir); dirname(d) !== d; d = dirname(d)) {
    const hasPnpmWorkspace = await exists(join(d, 'pnpm-workspace.yaml'))
    if (isWorkspaceRoot(await readManifests(d), hasPnpmWorkspace)) return d
  }
  return undefined
}

function tasksFrom(m: Manifests, pm: PM, allScripts: boolean, withHooks: boolean): TaskDef[] {
  const pkgTasks = packageScripts(m.pkg, allScripts, withHooks)
  if (pm !== 'deno') return pkgTasks
  // `deno task` prefers deno.json over package.json on name collisions
  const fromDeno = denoTasks(m.deno)
  const shadowed = new Set(fromDeno.map((t) => t.name))
  return [...fromDeno, ...pkgTasks.filter((t) => !shadowed.has(t.name))]
}

export async function loadProject(cwd: string, opts: LoadOptions = {}): Promise<Project> {
  const dir = await findProjectDir(cwd)
  if (!dir) throw new Error(`No package.json found in ${resolve(cwd)} or any parent directory`)

  const manifests = await readManifests(dir)
  const pm = opts.pm ?? (await detectPM(dir, manifests.deno !== undefined))
  const allScripts = opts.allScripts ?? false
  const root = await findWorkspaceRoot(dir)
  const rootManifests = root ? await readManifests(root) : undefined
  const withHooks = await runsHooks(pm, dir, [manifests.pkg?.packageManager, rootManifests?.pkg?.packageManager])

  const tasks: Task[] = tasksFrom(manifests, pm, allScripts, withHooks)
    .map((t) => ({ ...t, scope: 'local', cwd: dir }))
  if (root && rootManifests) {
    const rootTasks = tasksFrom(rootManifests, pm, allScripts, withHooks)
    tasks.push(...rootTasks.map((t): Task => ({ ...t, scope: 'root', cwd: root })))
  }

  return { pm, dir, root, tasks }
}
