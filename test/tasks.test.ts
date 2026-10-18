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
    await expect(loadProject(join(dir, 'empty'))).rejects.toThrow(/No package\.json, deno\.json, mise tasks or Gradle build found/)
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

  describe('all workspace packages (--all)', () => {
    const summary = async (cwd: string, opts = { all: true }) =>
      (await loadProject(cwd, opts)).tasks.map((t) => [t.name, t.scope, t.package, t.cwd])

    it('adds every other workspace package, labelled with its name', async () => {
      const root = await makeProject({
        'package.json': { scripts: { lint: 'eslint .' } },
        'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
        'pnpm-lock.yaml': '',
        'packages/web/package.json': { name: '@acme/web', scripts: { dev: 'vite' } },
        'packages/api/package.json': { name: '@acme/api', scripts: { dev: 'tsx watch', test: 'vitest' } },
      })
      const web = join(root, 'packages/web')
      const api = join(root, 'packages/api')
      expect(await summary(web)).toEqual([
        ['dev', 'local', undefined, web],
        ['lint', 'root', undefined, root],
        ['dev', 'package', '@acme/api', api],
        ['test', 'package', '@acme/api', api],
      ])
    })

    it('works from the workspace root itself', async () => {
      const root = await makeProject({
        'package.json': { workspaces: ['apps/*'], scripts: { lint: 'eslint .' } },
        'package-lock.json': '{}',
        'apps/a/package.json': { name: 'a', scripts: { start: 'node .' } },
        'apps/b/package.json': { name: 'b', scripts: { start: 'node .' } },
      })
      expect(await summary(root)).toEqual([
        ['lint', 'local', undefined, root],
        ['start', 'package', 'a', join(root, 'apps/a')],
        ['start', 'package', 'b', join(root, 'apps/b')],
      ])
    })

    it("reads yarn's { packages } form and labels unnamed packages by path", async () => {
      const root = await makeProject({
        'package.json': { workspaces: { packages: ['libs/**'] } },
        'yarn.lock': '',
        'libs/x/y/package.json': { scripts: { build: 'tsc' } },
      })
      expect(await summary(root)).toEqual([['build', 'package', 'libs/x/y', join(root, 'libs/x/y')]])
    })

    it('honours exclusions and skips node_modules and dirs without a manifest', async () => {
      const root = await makeProject({
        'package.json': { private: true },
        'pnpm-workspace.yaml': "packages:\n  - 'packages/**'\n  - '!packages/legacy'\n",
        'packages/app/package.json': { name: 'app', scripts: { dev: 'vite' } },
        'packages/app/node_modules/dep/package.json': { name: 'dep', scripts: { x: 'no' } },
        'packages/legacy/package.json': { name: 'legacy', scripts: { dev: 'old' } },
        'packages/docs/README.md': '# no manifest',
      })
      expect(await summary(root)).toEqual([['dev', 'package', 'app', join(root, 'packages/app')]])
    })

    it('reads deno workspace members when deno is the runner', async () => {
      const root = await makeProject({
        'deno.json': { workspace: ['./core', './cli'], tasks: { check: 'deno check' } },
        'deno.lock': '{}',
        'core/deno.json': { name: '@acme/core', tasks: { test: 'deno test' } },
        'cli/deno.json': { name: '@acme/cli', tasks: { run: 'deno run main.ts' } },
      })
      expect(await summary(root)).toEqual([
        ['check', 'local', undefined, root],
        ['run', 'package', '@acme/cli', join(root, 'cli')],
        ['test', 'package', '@acme/core', join(root, 'core')],
      ])
    })

    it('changes nothing outside a workspace', async () => {
      const dir = await makeProject({ 'package.json': { scripts } })
      expect(await summary(dir)).toEqual(await summary(dir, { all: false }))
    })

    it('is off by default', async () => {
      const root = await makeProject({
        'package.json': { workspaces: ['apps/*'], scripts: { lint: 'eslint .' } },
        'apps/a/package.json': { name: 'a', scripts: { start: 'node .' } },
      })
      expect((await loadProject(root)).tasks.map((t) => t.name)).toEqual(['lint'])
    })
  })

  describe('pre/post hooks', () => {
    const withHooks = {
      prebuild: 'rimraf dist',
      build: 'tsc',
      postbuild: 'echo done',
      lint: 'eslint .',
    }
    const hooksOf = async (files: Record<string, unknown>, pm?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'deno') => {
      const dir = await makeProject({ 'package.json': { scripts: withHooks }, ...files })
      const tasks = (await loadProject(dir, { pm })).tasks
      return Object.fromEntries(tasks.map((t) => [t.name, t.hooks]))
    }

    it('attaches hooks that npm will run', async () => {
      expect(await hooksOf({ 'package-lock.json': '{}' })).toEqual({
        build: { pre: 'rimraf dist', post: 'echo done' },
        lint: undefined,
      })
    })

    it('attaches hooks for pnpm, bun and Yarn 1', async () => {
      expect((await hooksOf({ 'pnpm-lock.yaml': '' })).build).toEqual({ pre: 'rimraf dist', post: 'echo done' })
      expect((await hooksOf({ 'bun.lock': '' })).build).toEqual({ pre: 'rimraf dist', post: 'echo done' })
      expect((await hooksOf({ 'yarn.lock': '# yarn lockfile v1\n' })).build)
        .toEqual({ pre: 'rimraf dist', post: 'echo done' })
    })

    it('omits hooks for deno', async () => {
      expect((await hooksOf({}, 'deno')).build).toBeUndefined()
    })

    it('omits hooks for Yarn 2+', async () => {
      expect((await hooksOf({ 'yarn.lock': '__metadata:\n  version: 8\n' })).build).toBeUndefined()
      expect((await hooksOf({ 'yarn.lock': '', '.yarnrc.yml': 'nodeLinker: pnp\n' })).build).toBeUndefined()
      const dir = await makeProject({
        'package.json': { scripts: withHooks, packageManager: 'yarn@4.5.0' },
      })
      expect((await loadProject(dir)).tasks.find((t) => t.name === 'build')?.hooks).toBeUndefined()
    })

    it('includes only the hooks that exist', async () => {
      const dir = await makeProject({ 'package.json': { scripts: { test: 'vitest', posttest: 'echo ok' } } })
      expect((await loadProject(dir)).tasks.map((t) => [t.name, t.hooks])).toEqual([
        ['test', { post: 'echo ok' }],
      ])
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
