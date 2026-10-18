import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasGradle, hasMise, isolateMise, makeProject } from './helpers.ts'
import { hopCommand } from './hop-under-test.ts'


async function hop(cwd: string, args: string[], historyFile?: string, env: Record<string, string> = {}) {
  const [command, prefix] = hopCommand
  const result = spawnSync(command, [...prefix, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOP_HISTORY: historyFile ?? join(cwd, '.hop-history.json'), HOP_PM: '', ...env },
  })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('built hop binary', () => {
  it('lists scripts when not attached to a terminal', async () => {
    const dir = await makeProject({ 'package.json': { scripts: { b: 'echo b', a: 'echo a' } } })
    const result = await hop(dir, [])
    expect(result).toMatchObject({ code: 0, stdout: 'a\techo a\nb\techo b\n' })
  })

  it('runs a script through npm, passing args and the exit code through', async () => {
    const dir = await makeProject({
      'package.json': {
        scripts: { check: 'node check.js' },
      },
      'check.js': 'console.log("args:" + process.argv.slice(2).join(",")); process.exit(7)',
    })
    const result = await hop(dir, ['check', '--', '--flag', 'x'])
    expect(result.code).toBe(7)
    expect(result.stdout).toContain('args:--flag,x')
    expect(result.stderr).toContain('› npm run check -- --flag x')
  })

  it('remembers runs between invocations', async () => {
    const dir = await makeProject({ 'package.json': { scripts: { a: 'echo a', z: 'echo z' } } })
    await hop(dir, ['z'])
    const result = await hop(dir, ['--list'])
    expect(result.stdout.split('\n')[0]).toBe('z\techo z')
  })

  it('stops quietly when a pipe reader stops early (`hop --list | head`)', async () => {
    // more output than a pipe buffers, so hop is still writing when head exits
    const scripts = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`script-${i}`, `echo ${'x'.repeat(40)}`]))
    const dir = await makeProject({ 'package.json': { scripts } })
    const [command, prefix] = hopCommand
    const result = spawnSync('sh', ['-c', '"$@" --list | head -1', 'sh', command, ...prefix], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOP_HISTORY: join(dir, '.hop-history.json') },
    })
    expect(result.stdout).toBe(`script-0\techo ${'x'.repeat(40)}\n`)
    expect(result.stderr).toBe('')
  })

  it('prints its version', async () => {
    const dir = await makeProject({})
    expect((await hop(dir, ['-v'])).stdout).toMatch(/^\d+\.\d+\.\d+\n$/)
  })
})

describe.skipIf(!hasMise)('built hop with mise', () => {
  let restore: () => void
  beforeAll(async () => { restore = await isolateMise() })
  afterAll(() => restore())

  it('lists and runs mise tasks alongside package.json scripts', async () => {
    const dir = await makeProject({
      'package.json': { scripts: { dev: 'echo pnpm-dev' } },
      'pnpm-lock.yaml': '',
      'mise.toml': '[tasks.greet]\nrun = "echo hello-from-mise"\n',
      '.git/HEAD': '',
    })
    expect((await hop(dir, ['--list'])).stdout).toBe('dev\techo pnpm-dev\tpnpm\ngreet\techo hello-from-mise\tmise\n')
    const result = await hop(dir, ['greet'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('hello-from-mise')
    expect(result.stderr).toContain('› mise run greet')
  })
})

// A real two-module build: app (an application) depends on lib. No wrapper, so hop uses
// the gradle on PATH; wrapper commands are covered with a stub gradlew in app.test.ts.
const gradleBuild = () => makeProject({
  'settings.gradle': "rootProject.name = 'demo'\ninclude 'app', 'lib'\n",
  'app/build.gradle': "plugins { id 'application' }\napplication { mainClass = 'demo.App' }\ndependencies { implementation project(':lib') }\n",
  'app/src/main/java/demo/App.java':
    'package demo; public class App { public static void main(String[] a) { System.out.println("hello from " + demo.lib.Lib.name() + " " + String.join(",", a)); } }\n',
  'lib/build.gradle': "plugins { id 'java-library' }\n",
  'lib/src/main/java/demo/lib/Lib.java': 'package demo.lib; public class Lib { public static String name() { return "lib"; } }\n',
})

describe.skipIf(!hasGradle)('built hop with Gradle', { timeout: 300_000 }, () => {
  it('lists the tasks people run, once each, at the root', async () => {
    const root = await gradleBuild()
    const result = await hop(root, ['--list'], undefined, { HOP_CACHE: join(root, '.cache') })
    expect(result.stderr).toBe('')
    const names = result.stdout.trim().split('\n').map((line) => line.split('\t')[0])
    expect(names).toEqual(expect.arrayContaining(['build', 'clean', 'run', 'test']))
    expect(names).not.toContain('compileJava')
    expect(names).not.toContain('dependencies')
    expect(new Set(names).size).toBe(names.length)

    // the second listing comes from the cache: no Gradle needed
    const cached = await hop(root, ['--list'], undefined, { HOP_CACHE: join(root, '.cache'), PATH: '/usr/bin:/bin' })
    expect(cached).toMatchObject({ code: 0, stdout: result.stdout, stderr: '' })
  })

  it("runs a module's task from inside it, with extra args", async () => {
    const root = await gradleBuild()
    const result = await hop(join(root, 'app/src'), ['run', '--', '-q', '--args=a1 a2'], undefined, { HOP_CACHE: join(root, '.cache') })
    expect(result.stderr).toContain("› gradle :app:run -q '--args=a1 a2'")
    expect(result.stdout).toContain('hello from lib a1,a2')
    expect(result.code).toBe(0)
  })

  it("passes Gradle's exit code through", async () => {
    const root = await gradleBuild()
    const result = await hop(root, ['run', '--', '-q', '--no-such-flag'], undefined, { HOP_CACHE: join(root, '.cache') })
    expect(result.code).not.toBe(0)
  })
})
