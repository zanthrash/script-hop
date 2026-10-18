import { readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { exists, findUp } from '../fs.ts'
import type { LoadOptions, SourceResult, Task, TaskSource } from '../types.ts'

/** What hop needs from one pom.xml. */
interface Pom {
  artifactId?: string
  packaging: string
  /** Module directories (`<modules>`, or Maven 4's `<subprojects>`), relative to the POM. */
  modules: string[]
  /** artifactIds of plugins in `<build><plugins>` (not pluginManagement). */
  plugins: string[]
  parent?: { artifactId?: string; relativePath: string }
}

/** One project of the reactor: the root (`path` '') or a module (`path` 'app', 'services/api'). */
export interface MavenProject {
  path: string
  /**
   * How `-pl` selects it: `:artifactId`. Not the path, which Maven failed to match on
   * Windows (temp folders under 8.3 short names); the path is the fallback when the
   * artifactId is missing or a ${property}.
   */
  selector: string
  dir: string
  packaging: string
  /** Its own build plugins plus those inherited from parent POMs in the build. */
  plugins: string[]
}

interface Definition {
  name: string
  goals: string[]
  description: string
  /** Safe to run with `-am`, i.e. in every module the target depends on too. */
  alsoMake: boolean
}

// lifecycle phases are what `-am` is for: Maven runs them in each upstream module first
const PHASES: Definition[] = ([
  { name: 'clean', goals: ['clean'], description: 'Delete build output (target/)' },
  { name: 'validate', goals: ['validate'], description: 'Check the project is correct' },
  { name: 'compile', goals: ['compile'], description: 'Compile the sources' },
  { name: 'test', goals: ['test'], description: 'Run the unit tests' },
  { name: 'package', goals: ['package'], description: 'Package the compiled code (e.g. a JAR)' },
  { name: 'verify', goals: ['verify'], description: 'Run integration tests and checks' },
  { name: 'install', goals: ['install'], description: 'Install into the local Maven repository' },
  { name: 'deploy', goals: ['deploy'], description: 'Publish to the remote repository' },
  { name: 'site', goals: ['site'], description: "Generate the project's site" },
  { name: 'clean install', goals: ['clean', 'install'], description: 'Rebuild from scratch and install into the local repository' },
  { name: 'clean verify', goals: ['clean', 'verify'], description: 'Rebuild from scratch and run all checks' },
  { name: 'clean package', goals: ['clean', 'package'], description: 'Rebuild from scratch and package' },
] as const).map((phase) => ({ ...phase, goals: [...phase.goals], alsoMake: true }))

/**
 * Goals people run day to day, for plugins found in a POM, matched by artifactId. Goal
 * names come from each plugin's `mvn help:describe`. Left out on purpose: goals meant
 * to be bound to the lifecycle, and `flyway:clean` (drops every database object).
 *
 * `alsoMake`: with `-am`, Maven runs the goal in every upstream module too (the parent
 * POM included), which fails for most plugins (`exec:java` without a main class there).
 * Only plugins checked to skip modules they don't apply to get it; for the rest, a module's
 * goal runs with plain `-pl`, as Maven's docs show, and needs its dependencies installed.
 */
const PLUGINS: { artifactId: RegExp; label: string; alsoMake?: boolean; goals: [goal: string, description: string][] }[] = [
  {
    artifactId: /^micronaut-maven-plugin$/,
    label: 'Micronaut',
    // checked: mn:run with -pl app -am builds lib and runs only the app
    alsoMake: true,
    goals: [
      ['mn:run', 'Run the app in development mode, restarting on changes'],
      ['mn:dockerfile', 'Generate a Dockerfile for the app'],
    ],
  },
  {
    artifactId: /^spring-boot-maven-plugin$/,
    label: 'Spring Boot',
    goals: [
      ['spring-boot:run', 'Run the app'],
      ['spring-boot:test-run', 'Run the app with the test classpath'],
      ['spring-boot:build-image', 'Build an OCI image with buildpacks'],
    ],
  },
  {
    artifactId: /^quarkus-maven-plugin$/,
    label: 'Quarkus',
    goals: [
      ['quarkus:dev', 'Run in dev mode with live reload'],
      ['quarkus:test', 'Run the tests continuously'],
      ['quarkus:build', 'Build the app'],
      ['quarkus:image-build', 'Build a container image'],
    ],
  },
  {
    artifactId: /^exec-maven-plugin$/,
    label: 'exec',
    goals: [
      ['exec:java', 'Run the configured Java main class'],
      ['exec:exec', 'Run the configured program'],
    ],
  },
  {
    artifactId: /^jib-maven-plugin$/,
    label: 'Jib',
    goals: [
      ['jib:build', 'Build a container image and push it'],
      ['jib:dockerBuild', 'Build a container image into the local Docker daemon'],
      ['jib:buildTar', 'Build a container image as a tarball'],
    ],
  },
  {
    artifactId: /^flyway-maven-plugin$/,
    label: 'Flyway',
    goals: [
      ['flyway:migrate', 'Apply pending migrations'],
      ['flyway:info', 'Show the status of all migrations'],
      ['flyway:validate', 'Check applied migrations against the local ones'],
      ['flyway:repair', 'Repair the schema history table'],
      ['flyway:baseline', 'Baseline an existing database'],
    ],
  },
  {
    artifactId: /^jetty(-ee\d+)?-maven-plugin$/,
    label: 'Jetty',
    goals: [
      ['jetty:run', 'Run the webapp in place'],
      ['jetty:run-war', 'Build the WAR and run it'],
    ],
  },
]

function goalsFor(project: MavenProject): Definition[] {
  // an aggregator (packaging pom) has nothing to run a plugin's goals on
  if (project.packaging === 'pom') return []
  const found = new Map<string, Definition>()
  for (const plugin of PLUGINS) {
    if (!project.plugins.some((id) => plugin.artifactId.test(id))) continue
    for (const [goal, description] of plugin.goals) {
      found.set(goal, { name: goal, goals: [goal], description: `${description} (${plugin.label})`, alsoMake: !!plugin.alsoMake })
    }
  }
  return [...found.values()]
}

/**
 * Tasks for a directory in a Maven build, mirroring Gradle builds and Node workspaces.
 * At the root, the build's phases (`./mvnw clean install`, across every module), plus each
 * module's plugin goals, labelled with the module, since those only make sense for it. In
 * a module, its phases and goals, run with `-pl :<artifactId>`, plus `-am` where safe so the
 * modules it depends on are built too (without it, Maven looks for them in the local
 * repository and fails if they were never installed), plus other modules' goals it
 * doesn't have. With `all`,
 * everything: the root's phases and every module's tasks.
 */
export function tasksFromReactor(projects: MavenProject[], root: string, cwd: string, opts: LoadOptions, wrapper: boolean): SourceResult {
  const make = (def: Definition, project: MavenProject, scope: Task['scope']): Task => {
    const module = project.path ? project.selector : undefined
    const alsoMake = !!module && def.alsoMake
    return {
      name: def.name,
      runner: 'maven',
      command: [...(module ? ['-pl', module] : []), ...(alsoMake ? ['-am'] : []), ...def.goals].join(' '),
      description: def.description,
      source: 'maven',
      scope,
      ...(scope === 'package' && project.path ? { package: project.path } : {}),
      cwd: root,
      maven: { goals: def.goals, ...(module ? { module } : {}), ...(alsoMake ? { alsoMake } : {}), wrapper },
    }
  }
  const everything = (project: MavenProject) => [...PHASES, ...goalsFor(project)]

  const [top, ...modules] = projects
  if (!top) return { dir: root, tasks: [] }
  const inside = (dir: string) => cwd === dir || cwd.startsWith(dir + sep)
  const current = modules
    .filter((project) => inside(project.dir))
    .reduce<MavenProject | undefined>((deepest, p) => (!deepest || p.dir.length > deepest.dir.length ? p : deepest), undefined)

  const others = modules.filter((project) => project !== current)
  const fromOthers = others.flatMap((project) => (opts.all ? everything(project) : goalsFor(project)).map((def) => make(def, project, 'package')))

  if (!current) return { dir: root, tasks: [...everything(top).map((def) => make(def, top, 'local')), ...fromOthers] }

  // in a module, `test` means the module's tests; the build-wide one only comes with `all`
  const local = everything(current).map((def) => make(def, current, 'local'))
  const names = new Set(local.map((task) => task.name))
  const fromRoot = everything(top).map((def) => make(def, top, 'root'))
  const elsewhere = [...fromRoot, ...fromOthers].filter((task) => opts.all || !names.has(task.name))
  return { dir: current.dir, root, tasks: [...local, ...elsewhere] }
}

/** Maven phases and plugin goals, read from the build's pom.xml files (Maven isn't run). */
export const mavenSource: TaskSource = {
  async load(cwd, opts) {
    const pomFile = await findUp('pom.xml', cwd)
    if (!pomFile) return undefined
    let root = dirname(pomFile)
    try {
      root = await reactorRoot(root)
      const projects = await readReactor(root)
      return tasksFromReactor(projects, root, resolve(cwd), opts, await exists(join(root, 'mvnw')))
    } catch (error) {
      return { dir: root, tasks: [], warnings: [(error as Error).message] }
    }
  },
}

/** The top of the reactor: climb while the folder above lists this one as a module. */
async function reactorRoot(dir: string): Promise<string> {
  for (;;) {
    const up = dirname(dir)
    if (up === dir || !(await exists(join(up, 'pom.xml')))) return dir
    let pom: Pom
    try {
      pom = await readPom(join(up, 'pom.xml'))
    } catch {
      return dir
    }
    if (!pom.modules.some((m) => moduleDir(up, m) === dir)) return dir
    dir = up
  }
}

/** Every project in the build, root first, with the plugins each one ends up with. */
async function readReactor(root: string): Promise<MavenProject[]> {
  const poms = new Map<string, Pom>()
  const visit = async (dir: string) => {
    if (poms.has(dir)) return
    poms.set(dir, await readPom(join(dir, 'pom.xml')))
    for (const module of poms.get(dir)!.modules) {
      const child = moduleDir(dir, module)
      if (await exists(join(child, 'pom.xml'))) await visit(child)
    }
  }
  await visit(root)

  // build plugins are inherited from the parent POM, when that parent is part of the build
  const pluginsOf = (dir: string, pom: Pom, seen = new Set<string>()): string[] => {
    if (!pom.parent || seen.has(dir)) return pom.plugins
    seen.add(dir)
    const parentDir = moduleDir(dir, pom.parent.relativePath)
    const parent = poms.get(parentDir)
    if (!parent || parent.artifactId !== pom.parent.artifactId) return pom.plugins
    return [...pom.plugins, ...pluginsOf(parentDir, parent, seen)]
  }

  return [...poms].map(([dir, pom]) => {
    // forward slashes: it's shown as a label, and passed to -pl as a fallback
    const path = relative(root, dir).split(sep).join('/')
    const selector = pom.artifactId && !pom.artifactId.includes('$') ? `:${pom.artifactId}` : path
    return { path, selector, dir, packaging: pom.packaging, plugins: pluginsOf(dir, pom) }
  })
}

/** A module (or parent relativePath) entry names a directory, or a POM file in one. */
function moduleDir(from: string, entry: string): string {
  const path = resolve(from, entry)
  return path.endsWith('.xml') ? dirname(path) : path
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === 'module' || name === 'subproject' || name === 'plugin',
})

async function readPom(file: string): Promise<Pom> {
  const text = await readFile(file, 'utf8')
  let project: any
  try {
    project = parser.parse(text, true)?.project
  } catch (error) {
    const message = (error as { err?: { msg?: string } }).err?.msg ?? (error as Error).message
    throw new Error(`couldn't read ${file}: ${message}`)
  }
  if (!project || typeof project !== 'object') throw new Error(`couldn't read ${file}: no <project> element`)

  const str = (value: unknown) => (typeof value === 'string' ? value.trim() : undefined)
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
  return {
    artifactId: str(project.artifactId),
    packaging: str(project.packaging) || 'jar',
    modules: [...list(project.modules?.module), ...list(project.subprojects?.subproject)]
      .map(str)
      .filter((m): m is string => !!m),
    plugins: list(project.build?.plugins?.plugin)
      .map((plugin) => str((plugin as { artifactId?: unknown })?.artifactId))
      .filter((id): id is string => !!id),
    parent: project.parent
      ? { artifactId: str(project.parent.artifactId), relativePath: str(project.parent.relativePath) || '../pom.xml' }
      : undefined,
  }
}
