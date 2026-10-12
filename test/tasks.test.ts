import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadProject } from '../src/tasks.ts'
import { makeProject } from './helpers.ts'

const scripts = { dev: 'vite --port 3000', build: 'vite build', test: 'vitest' }

describe('loadProject', () => {
  it('lists package.json scripts and detects npm from its lockfile', async () => {
    const dir = await makeProject({
      'package.json': { scripts },
      'package-lock.json': '{}',
    })
    const project = await loadProject(dir)

    expect(project.pm).toBe('npm')
    expect(project.tasks.map((t) => [t.name, t.command])).toEqual([
      ['dev', 'vite --port 3000'],
      ['build', 'vite build'],
      ['test', 'vitest'],
    ])
  })

  it('finds the nearest package.json in a parent directory', async () => {
    const root = await makeProject({ 'package.json': { scripts }, 'src/deep/.keep': '' })
    const project = await loadProject(join(root, 'src/deep'))

    expect(project.dir).toBe(root)
    expect(project.tasks.map((t) => t.name)).toEqual(['dev', 'build', 'test'])
  })

  it('fails clearly when there is no package.json anywhere above', async () => {
    const dir = await makeProject({ 'empty/.keep': '' })
    await expect(loadProject(join(dir, 'empty'))).rejects.toThrow(/No package\.json found/)
  })

  describe('hidden scripts', () => {
    const noisy = {
      preinstall: 'only-allow pnpm',
      postinstall: 'patch-package',
      prepare: 'husky',
      prepublishOnly: 'pnpm build',
      prebuild: 'rimraf dist',
      build: 'tsc',
      postbuild: 'echo done',
      preview: 'vite preview',
      postcss: 'postcss src -o dist',
    }

    it('hides lifecycle scripts and pre/post hooks of other scripts', async () => {
      const dir = await makeProject({ 'package.json': { scripts: noisy } })
      const names = (await loadProject(dir)).tasks.map((t) => t.name)
      // `preview` and `postcss` look like hooks but have no `view` / `css` script to attach to
      expect(names).toEqual(['build', 'preview', 'postcss'])
    })

    it('shows everything with allScripts', async () => {
      const dir = await makeProject({ 'package.json': { scripts: noisy } })
      const names = (await loadProject(dir, { allScripts: true })).tasks.map((t) => t.name)
      expect(names).toEqual(Object.keys(noisy))
    })
  })

  describe('descriptions', () => {
    const describedBy = async (pkg: object) => {
      const dir = await makeProject({ 'package.json': { scripts, ...pkg } })
      return Object.fromEntries((await loadProject(dir)).tasks.map((t) => [t.name, t.description]))
    }

    it('reads hop.descriptions', async () => {
      expect(await describedBy({ hop: { descriptions: { dev: 'Start dev server' } } })).toEqual({
        dev: 'Start dev server', build: undefined, test: undefined,
      })
    })

    it('reads ntl.descriptions and scripts-info', async () => {
      expect(await describedBy({
        ntl: { descriptions: { build: 'Production build' } },
        'scripts-info': { test: 'Run unit tests' },
      })).toEqual({ dev: undefined, build: 'Production build', test: 'Run unit tests' })
    })

    it('prefers hop over ntl over scripts-info', async () => {
      expect(await describedBy({
        hop: { descriptions: { dev: 'from hop' } },
        ntl: { descriptions: { dev: 'from ntl', build: 'from ntl' } },
        'scripts-info': { dev: 'from info', build: 'from info', test: 'from info' },
      })).toEqual({ dev: 'from hop', build: 'from ntl', test: 'from info' })
    })
  })

  describe('deno', () => {
    const summary = async (dir: string) =>
      (await loadProject(dir)).tasks.map((t) => [t.name, t.source, t.command, t.description])

    it('merges deno.json tasks with package.json scripts', async () => {
      const dir = await makeProject({
        'package.json': { scripts: { lint: 'eslint .' } },
        'deno.json': {
          tasks: {
            dev: 'deno run -A main.ts',
            check: { command: 'deno check main.ts', description: 'Type-check' },
          },
        },
        'deno.lock': '{}',
      })
      expect(await summary(dir)).toEqual([
        ['dev', 'deno', 'deno run -A main.ts', undefined],
        ['check', 'deno', 'deno check main.ts', 'Type-check'],
        ['lint', 'pkg', 'eslint .', undefined],
      ])
    })

    it('lets deno.json win when both define the same name', async () => {
      const dir = await makeProject({
        'package.json': { scripts: { dev: 'node server.js' } },
        'deno.json': { tasks: { dev: 'deno run -A main.ts' } },
        'deno.lock': '{}',
      })
      expect(await summary(dir)).toEqual([['dev', 'deno', 'deno run -A main.ts', undefined]])
    })

    it('reads deno.jsonc with comments', async () => {
      const dir = await makeProject({
        'deno.jsonc': `{
          // the dev server
          "tasks": { "dev": "deno run -A main.ts", },
        }`,
        'deno.lock': '{}',
      })
      expect(await summary(dir)).toEqual([['dev', 'deno', 'deno run -A main.ts', undefined]])
    })

    it('works in a deno-only project with no package.json', async () => {
      const dir = await makeProject({ 'deno.json': { tasks: { dev: 'deno run main.ts' } } })
      const project = await loadProject(dir)
      expect(project.pm).toBe('deno')
      expect(project.dir).toBe(dir)
    })

    it('ignores deno.json tasks when deno is not the runner', async () => {
      const dir = await makeProject({
        'package.json': { scripts: { lint: 'eslint .' } },
        'deno.json': { tasks: { dev: 'deno run main.ts' } },
        'pnpm-lock.yaml': '',
      })
      expect(await summary(dir)).toEqual([['lint', 'pkg', 'eslint .', undefined]])
    })
  })

  describe('workspaces', () => {
    const scoped = async (cwd: string) =>
      (await loadProject(cwd)).tasks.map((t) => [t.name, t.scope, t.cwd])

    it('adds workspace root scripts when inside a pnpm workspace package', async () => {
      const root = await makeProject({
        'package.json': { scripts: { lint: 'eslint .', dev: 'turbo dev' } },
        'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
        'pnpm-lock.yaml': '',
        'packages/web/package.json': { scripts: { dev: 'vite' } },
      })
      const web = join(root, 'packages/web')
      const project = await loadProject(web)

      expect(project.pm).toBe('pnpm')
      expect(project.root).toBe(root)
      expect(await scoped(web)).toEqual([
        ['dev', 'local', web],
        ['lint', 'root', root],
        ['dev', 'root', root],
      ])
    })

    it('recognises a package.json workspaces field', async () => {
      const root = await makeProject({
        'package.json': { workspaces: ['apps/*'], scripts: { lint: 'eslint .' } },
        'package-lock.json': '{}',
        'apps/api/package.json': { scripts: { start: 'node .' } },
      })
      const api = join(root, 'apps/api')
      expect(await scoped(api)).toEqual([
        ['start', 'local', api],
        ['lint', 'root', root],
      ])
    })

    it('does not duplicate scripts when run from the workspace root', async () => {
      const root = await makeProject({
        'package.json': { workspaces: ['apps/*'], scripts: { lint: 'eslint .' } },
      })
      const project = await loadProject(root)
      expect(project.root).toBeUndefined()
      expect(await scoped(root)).toEqual([['lint', 'local', root]])
    })

    it('ignores a parent package.json that is not a workspace root', async () => {
      const outer = await makeProject({
        'package.json': { scripts: { outer: 'echo outer' } },
        'inner/package.json': { scripts: { inner: 'echo inner' } },
      })
      const inner = join(outer, 'inner')
      expect(await scoped(inner)).toEqual([['inner', 'local', inner]])
    })
  })

  describe('package manager detection', () => {
    it.each([
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['bun.lock', 'bun'],
      ['bun.lockb', 'bun'],
    ])('detects %s as %s', async (lockfile, pm) => {
      const dir = await makeProject({ 'package.json': { scripts }, [lockfile]: '' })
      expect((await loadProject(dir)).pm).toBe(pm)
    })

    it('prefers the packageManager field over a lockfile', async () => {
      const dir = await makeProject({
        'package.json': { scripts, packageManager: 'yarn@4.5.0' },
        'package-lock.json': '{}',
      })
      expect((await loadProject(dir)).pm).toBe('yarn')
    })

    it('lets an explicit pm option override detection', async () => {
      const dir = await makeProject({ 'package.json': { scripts }, 'yarn.lock': '' })
      expect((await loadProject(dir, { pm: 'bun' })).pm).toBe('bun')
    })

    it('falls back to npm when nothing identifies a manager', async () => {
      const dir = await makeProject({ 'package.json': { scripts } })
      expect((await loadProject(dir)).pm).toBe('npm')
    })
  })
})
