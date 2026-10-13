import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeProject } from './helpers.ts'

const repo = fileURLToPath(new URL('..', import.meta.url))
const cli = join(repo, 'dist/cli.mjs')

async function hop(cwd: string, args: string[], historyFile?: string) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOP_HISTORY: historyFile ?? join(cwd, '.hop-history.json'), HOP_PM: '' },
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

  it('prints its version', async () => {
    const dir = await makeProject({})
    expect((await hop(dir, ['-v'])).stdout).toMatch(/^\d+\.\d+\.\d+\n$/)
  })
})
