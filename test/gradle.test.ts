import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGradleSource, tasksFromModel, type GradleModel } from '../src/sources/gradle.ts'
import { makeProject } from './helpers.ts'

const t = (name: string, group: string | null, description: string | null = null) => ({ name, group, description })

function model(root: string): GradleModel {
  return [
    { path: ':', dir: root, tasks: [t('init', 'Build Setup'), t('help', 'help'), t('wrapper', 'Build Setup'), t('tasks', 'help')] },
    {
      path: ':app',
      dir: join(root, 'app'),
      tasks: [
        t('run', 'application', 'Runs this project as a JVM application'),
        t('build', 'build', 'Assembles and tests this project.'),
        t('test', 'verification', 'Runs the test suite.'),
        t('compileJava', null, 'Compiles main Java source.'),
        t('dependencies', 'help', 'Displays all dependencies.'),
      ],
    },
    {
      path: ':lib',
      dir: join(root, 'lib'),
      tasks: [t('build', 'build', 'Assembles and tests this project.'), t('test', 'verification', 'Runs the test suite.')],
    },
    { path: ':services:api', dir: join(root, 'services/api'), tasks: [t('run', 'application', 'Runs the API')] },
  ]
}

const summary = (tasks: ReturnType<typeof tasksFromModel>['tasks']) =>
  tasks.map((task) => [task.name, task.scope, task.package, task.gradle?.target])

describe('tasksFromModel', () => {
  const root = '/work/demo'

  it('at the root, lists each task name once and runs it across every module', () => {
    const found = tasksFromModel(model(root), root, root, {}, true)
    expect(found.dir).toBe(root)
    expect(found.root).toBeUndefined()
    expect(summary(found.tasks)).toEqual([
      ['build', 'local', undefined, 'build'],
      ['run', 'local', undefined, 'run'],
      ['test', 'local', undefined, 'test'],
    ])
    const run = found.tasks.find((task) => task.name === 'run')!
    expect(run).toMatchObject({
      runner: 'gradle',
      source: 'gradle',
      command: 'run',
      description: 'Runs this project as a JVM application',
      cwd: root,
      gradle: { target: 'run', wrapper: true },
    })
  })

  it('hides help, build setup and ungrouped tasks unless allScripts', () => {
    const names = tasksFromModel(model(root), root, root, { allScripts: true }, true).tasks.map((task) => task.name)
    expect(names).toEqual(['build', 'compileJava', 'dependencies', 'help', 'init', 'run', 'tasks', 'test', 'wrapper'])
  })

  it("in a module, lists that module's tasks plus the root's it doesn't have", () => {
    const found = tasksFromModel(model(root), root, join(root, 'lib/src/main'), {}, true)
    expect(found.dir).toBe(join(root, 'lib'))
    expect(found.root).toBe(root)
    // in lib/, `build` means lib's build, as typing `../gradlew build` there would
    expect(summary(found.tasks)).toEqual([
      ['build', 'local', undefined, ':lib:build'],
      ['test', 'local', undefined, ':lib:test'],
      ['run', 'root', undefined, 'run'],
    ])
    // every Gradle task runs from the root, through the root's wrapper
    expect(new Set(found.tasks.map((task) => task.cwd))).toEqual(new Set([root]))
    expect(found.tasks[0]!.command).toBe(':lib:build')
  })

  it("with all, a module also gets the root's same-named tasks", () => {
    const found = tasksFromModel(model(root), root, join(root, 'lib'), { all: true }, true)
    expect(summary(found.tasks.filter((task) => task.scope === 'root'))).toEqual([
      ['build', 'root', undefined, 'build'],
      ['run', 'root', undefined, 'run'],
      ['test', 'root', undefined, 'test'],
    ])
  })

  it('finds the deepest module for nested modules', () => {
    const found = tasksFromModel(model(root), root, join(root, 'services/api'), {}, true)
    expect(found.dir).toBe(join(root, 'services/api'))
    expect(summary(found.tasks.filter((task) => task.scope === 'local'))).toEqual([['run', 'local', undefined, ':services:api:run']])
  })

  it('treats a folder that is not a module as the root', () => {
    const found = tasksFromModel(model(root), root, join(root, 'docs'), {}, true)
    expect(found.dir).toBe(root)
    expect(found.tasks.every((task) => task.scope === 'local')).toBe(true)
  })

  it('with all, adds every other module, labelled with its path', () => {
    const found = tasksFromModel(model(root), root, join(root, 'app'), { all: true }, true)
    expect(summary(found.tasks.filter((task) => task.scope === 'package'))).toEqual([
      ['build', 'package', 'lib', ':lib:build'],
      ['test', 'package', 'lib', ':lib:test'],
      ['run', 'package', 'services:api', ':services:api:run'],
    ])
  })

  it('with all at the root, adds every module', () => {
    const found = tasksFromModel(model(root), root, root, { all: true }, true)
    expect(found.tasks.filter((task) => task.scope === 'package').map((task) => task.gradle?.target)).toEqual([
      ':app:build', ':app:run', ':app:test', ':lib:build', ':lib:test', ':services:api:run',
    ])
  })

  it('in a single-project build, lists its tasks by name', () => {
    const single: GradleModel = [{ path: ':', dir: root, tasks: [t('build', 'build'), t('run', 'application')] }]
    expect(summary(tasksFromModel(single, root, root, {}, false).tasks)).toEqual([
      ['build', 'local', undefined, 'build'],
      ['run', 'local', undefined, 'run'],
    ])
  })

  it('prefers the root project description for an all-module task', () => {
    const withRoot: GradleModel = [
      { path: ':', dir: root, tasks: [t('check', 'verification', 'Checks everything')] },
      { path: ':app', dir: join(root, 'app'), tasks: [t('check', 'verification', 'Runs all checks.')] },
    ]
    expect(tasksFromModel(withRoot, root, root, {}, true).tasks[0]!.description).toBe('Checks everything')
  })
})

const settings = "rootProject.name = 'demo'\ninclude 'app'\n"

describe('Gradle source', () => {
  /** A source whose Gradle is a stub: counts reads, returns `result` or throws it. */
  function stubbed(result: (root: string) => GradleModel | Error) {
    const calls: string[] = []
    const source = createGradleSource(async (root) => {
      calls.push(root)
      const value = result(root)
      if (value instanceof Error) throw value
      return value
    })
    return { source, calls }
  }

  it('does nothing outside a Gradle build', async () => {
    const dir = await makeProject({ 'package.json': {} })
    const { source, calls } = stubbed(model)
    expect(await source.load(dir, {})).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('finds the build root from a module and asks Gradle there', async () => {
    const root = await makeProject({ 'settings.gradle': settings, 'gradlew': '', 'app/build.gradle': '', 'app/src/x': '' })
    const { source, calls } = stubbed(model)
    const found = await source.load(join(root, 'app/src'), {})
    expect(calls).toEqual([root])
    expect(found?.dir).toBe(join(root, 'app'))
    expect(found?.tasks[0]?.gradle).toEqual({ target: ':app:build', wrapper: true })
  })

  it('uses gradle from PATH when the build has no wrapper', async () => {
    const root = await makeProject({ 'build.gradle.kts': '' })
    const { source } = stubbed(model)
    expect((await source.load(root, {}))?.tasks[0]?.gradle?.wrapper).toBe(false)
  })

  it('caches the task list until a build file changes', async () => {
    const root = await makeProject({ 'settings.gradle': settings, 'app/build.gradle': '' })
    const cacheDir = await makeProject({})
    const { source, calls } = stubbed(model)

    await source.load(root, { cacheDir })
    await source.load(root, { cacheDir })
    expect(calls).toHaveLength(1)

    await writeFile(join(root, 'app/build.gradle'), "plugins { id 'application' }\n")
    await source.load(root, { cacheDir })
    expect(calls).toHaveLength(2)

    // a new version catalog counts too
    await mkdir(join(root, 'gradle'), { recursive: true })
    await writeFile(join(root, 'gradle/libs.versions.toml'), '[versions]\n')
    await source.load(root, { cacheDir })
    expect(calls).toHaveLength(3)

    // build output doesn't
    await mkdir(join(root, 'app/build/tmp'), { recursive: true })
    await writeFile(join(root, 'app/build/tmp/x.gradle'), '')
    await source.load(root, { cacheDir })
    expect(calls).toHaveLength(3)
  })

  it('reads again with refresh', async () => {
    const root = await makeProject({ 'settings.gradle': settings })
    const cacheDir = await makeProject({})
    const { source, calls } = stubbed(model)
    await source.load(root, { cacheDir })
    await source.load(root, { cacheDir, refresh: true })
    expect(calls).toHaveLength(2)
  })

  it('shows progress while reading, but not for a cached list', async () => {
    const root = await makeProject({ 'settings.gradle': settings })
    const cacheDir = await makeProject({})
    const { source } = stubbed(model)
    const events: string[] = []
    const progress = (message: string) => {
      events.push(`start ${message}`)
      return () => events.push('stop')
    }
    await source.load(root, { cacheDir, progress })
    await source.load(root, { cacheDir, progress })
    expect(events).toEqual(['start Reading Gradle tasks…', 'stop'])
  })

  it('explains a failure in one line and lists nothing from Gradle', async () => {
    const root = await makeProject({ 'settings.gradle': settings, gradlew: '' })
    const { source } = stubbed(() => new Error('exit 1: Could not resolve plugin'))
    const found = await source.load(root, { cacheDir: await makeProject({}) })
    expect(found?.tasks).toEqual([])
    expect(found?.warnings).toEqual([
      `couldn't read Gradle tasks (exit 1: Could not resolve plugin); run "./gradlew tasks" to see why`,
    ])
  })

  it('falls back to the last good list when reading fails, and never caches the failure', async () => {
    const root = await makeProject({ 'settings.gradle': settings, 'app/build.gradle': '' })
    const cacheDir = await makeProject({})
    let broken = false
    const { source, calls } = stubbed((r) => (broken ? new Error('exit 1') : model(r)))
    await source.load(root, { cacheDir })

    broken = true
    await writeFile(join(root, 'app/build.gradle'), 'oops(\n')
    const stale = await source.load(root, { cacheDir })
    expect(stale?.tasks.map((task) => task.name)).toEqual(['build', 'run', 'test'])
    expect(stale?.warnings?.[0]).toMatch(/^couldn't read Gradle tasks \(exit 1\); run "gradle tasks" to see why\. Showing the list from /)

    // still broken: asks Gradle again rather than trusting the stale list
    await source.load(root, { cacheDir })
    expect(calls).toHaveLength(3)

    broken = false
    await source.load(root, { cacheDir })
    await source.load(root, { cacheDir })
    expect(calls).toHaveLength(4)
  })

  it('keeps one cache file per build', async () => {
    const root = await makeProject({ 'settings.gradle': settings })
    const cacheDir = await makeProject({})
    await stubbed(model).source.load(root, { cacheDir })
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(join(cacheDir, 'gradle'))
    expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(1)
    const cached = JSON.parse(await readFile(join(cacheDir, 'gradle', files.find((f) => f.endsWith('.json'))!), 'utf8'))
    expect(cached.root).toBe(root)
  })
})
