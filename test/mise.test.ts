import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadProject } from '../src/tasks.ts'
import { hasMise, isolateMise, makeProject } from './helpers.ts'

let restore: () => void
beforeAll(async () => { restore = await isolateMise() })
afterAll(() => restore())

const miseToml = `
[tasks.build]
description = "Build everything"
run = "cargo build"

[tasks.test]
run = ["cargo test", "cargo clippy"]

[tasks.secret]
run = "echo hidden"
hide = true
`

describe.skipIf(!hasMise)('mise tasks', () => {
  const summary = async (cwd: string, opts = {}) =>
    (await loadProject(cwd, opts)).tasks.map((t) => [t.name, t.runner, t.command, t.description])

  it('lists project tasks, run by mise, without global or hidden ones', async () => {
    const dir = await makeProject({ 'mise.toml': miseToml, '.git/HEAD': '' })
    expect(await summary(dir)).toEqual([
      ['build', 'mise', 'cargo build', 'Build everything'],
      ['test', 'mise', 'cargo test && cargo clippy', undefined],
    ])
  })

  it('finds tasks from a subdirectory, and file tasks by path', async () => {
    const dir = await makeProject({
      'mise.toml': miseToml,
      '.git/HEAD': '',
      '.mise/tasks/deploy': '#!/usr/bin/env bash\n#MISE description="Ship it"\necho deploy\n',
      'src/deep/.keep': '',
    })
    spawnSync('chmod', ['+x', join(dir, '.mise/tasks/deploy')])
    const project = await loadProject(join(dir, 'src/deep'))
    expect(project.dir).toBe(dir)
    expect(project.tasks.map((t) => [t.name, t.command, t.description, t.cwd])).toEqual([
      ['build', 'cargo build', 'Build everything', dir],
      ['deploy', '.mise/tasks/deploy', 'Ship it', dir],
      ['test', 'cargo test && cargo clippy', undefined, dir],
    ])
  })

  it('includes hidden tasks with allScripts', async () => {
    const dir = await makeProject({ 'mise.toml': miseToml, '.git/HEAD': '' })
    expect((await loadProject(dir, { allScripts: true })).tasks.map((t) => t.name)).toEqual(['build', 'secret', 'test'])
  })

  it('leaves out tasks from mise configs above the repository', async () => {
    const outer = await makeProject({ 'mise.toml': '[tasks.outside]\nrun = "echo outside"\n' })
    const repo = join(outer, 'repo')
    await mkdir(join(repo, '.git'), { recursive: true })
    await writeFile(join(repo, 'mise.toml'), '[tasks.inside]\nrun = "echo inside"\n')
    expect((await loadProject(repo)).tasks.map((t) => t.name)).toEqual(['inside'])
  })

  it('merges with package.json scripts in the same project', async () => {
    const dir = await makeProject({
      'mise.toml': '[tasks.lint]\nrun = "cargo fmt --check"\n',
      'package.json': { scripts: { dev: 'vite' } },
      'pnpm-lock.yaml': '',
      '.git/HEAD': '',
    })
    expect((await loadProject(dir)).tasks.map((t) => [t.name, t.runner])).toEqual([
      ['dev', 'pnpm'],
      ['lint', 'mise'],
    ])
  })

  it('works in a project with only a mise config', async () => {
    const dir = await makeProject({ '.mise.toml': '[tasks.go]\nrun = "echo go"\n', '.git/HEAD': '' })
    expect((await loadProject(dir)).tasks.map((t) => t.name)).toEqual(['go'])
  })
})
