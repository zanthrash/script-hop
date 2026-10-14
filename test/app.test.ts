import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main, type IO } from '../src/app.ts'
import type { Command } from '../src/command.ts'
import type { Ranked } from '../src/rank.ts'
import { makeProject } from './helpers.ts'

// a clock that moves forward on every read, so successive runs are ordered
let clock = Date.UTC(2026, 9, 12)
const tick = () => (clock += 1000)

interface Harness {
  io: IO
  out: () => string
  err: () => string
  runs: { command: Command; cwd: string }[]
  picks: { choices: Ranked[]; query: string }[]
}

/** IO with captured output, a fake process launcher, and a scripted picker. */
async function harness(cwd: string, opts: {
  tty?: boolean
  pick?: (choices: Ranked[], query: string) => Ranked['task'] | undefined
  exitCode?: number
  historyFile?: string
  env?: Record<string, string>
} = {}): Promise<Harness> {
  let out = ''
  let err = ''
  const runs: Harness['runs'] = []
  const picks: Harness['picks'] = []
  const historyFile = opts.historyFile ?? join(await makeProject({}), 'history.json')
  return {
    out: () => out,
    err: () => err,
    runs,
    picks,
    io: {
      cwd,
      now: tick,
      isTTY: opts.tty ?? true,
      env: opts.env ?? {},
      historyFile,
      stdout: (s) => { out += s },
      stderr: (s) => { err += s },
      pick: async (search, query) => {
        const choices = search(query)
        picks.push({ choices, query })
        return opts.pick ? opts.pick(choices, query) : undefined
      },
      exec: async (command, cwd) => {
        runs.push({ command, cwd })
        return opts.exitCode ?? 0
      },
    },
  }
}

const basic = () => makeProject({
  'package.json': { scripts: { dev: 'vite', build: 'vite build', test: 'vitest' } },
  'package-lock.json': '{}',
})

describe('hop --list', () => {
  it('prints ranked script names with their commands', async () => {
    const h = await harness(await basic())
    expect(await main(['--list'], h.io)).toBe(0)
    expect(h.out()).toBe('build\tvite build\ndev\tvite\ntest\tvitest\n')
    expect(h.runs).toEqual([])
  })
})

describe('hop <name>', () => {
  it('runs an exactly named script without the picker and returns its exit code', async () => {
    const dir = await basic()
    const h = await harness(dir, { exitCode: 3 })

    expect(await main(['dev'], h.io)).toBe(3)
    expect(h.picks).toEqual([])
    expect(h.runs).toEqual([{ command: { bin: 'npm', args: ['run', 'dev'] }, cwd: dir }])
    expect(h.err()).toContain('› npm run dev')
  })

  it('records the run so it ranks first next time', async () => {
    const dir = await basic()
    const first = await harness(dir)
    await main(['test'], first.io)

    const second = await harness(dir, { historyFile: first.io.historyFile })
    await main(['--list'], second.io)
    expect(second.out().split('\n')[0]).toBe('test\tvitest')
  })

  it('passes arguments after -- through to the script', async () => {
    const h = await harness(await basic())
    await main(['test', '--', '--watch', 'src'], h.io)
    expect(h.runs[0]?.command.args).toEqual(['run', 'test', '--', '--watch', 'src'])
  })

  it('honours --pm', async () => {
    const h = await harness(await basic())
    await main(['--pm', 'bun', 'dev'], h.io)
    expect(h.runs[0]?.command).toEqual({ bin: 'bun', args: ['run', 'dev'] })
  })

  it('honours HOP_PM, with --pm taking precedence', async () => {
    const h = await harness(await basic(), { env: { HOP_PM: 'pnpm' } })
    await main(['dev'], h.io)
    await main(['--pm', 'yarn', 'dev'], h.io)
    expect(h.runs.map((r) => r.command.bin)).toEqual(['pnpm', 'yarn'])
  })

  it('ignores an empty HOP_PM', async () => {
    const h = await harness(await basic(), { env: { HOP_PM: '' } })
    expect(await main(['dev'], h.io)).toBe(0)
    expect(h.runs[0]?.command.bin).toBe('npm')
  })

  it('prefers the local script over a same-named root script', async () => {
    const root = await makeProject({
      'package.json': { workspaces: ['web'], scripts: { dev: 'turbo dev' } },
      'web/package.json': { scripts: { dev: 'vite' } },
    })
    const h = await harness(join(root, 'web'))
    await main(['dev'], h.io)
    expect(h.runs[0]?.cwd).toBe(join(root, 'web'))
  })
})

describe('the picker', () => {
  it('opens with every script ranked when run with no arguments', async () => {
    const dir = await basic()
    const h = await harness(dir, { pick: (choices) => choices[1]?.task })

    expect(await main([], h.io)).toBe(0)
    expect(h.picks[0]?.query).toBe('')
    expect(h.picks[0]?.choices.map((c) => c.task.name)).toEqual(['build', 'dev', 'test'])
    expect(h.runs).toEqual([{ command: { bin: 'npm', args: ['run', 'dev'] }, cwd: dir }])
  })

  it('opens pre-filtered when the query is not an exact name', async () => {
    const h = await harness(await basic(), { pick: (choices) => choices[0]?.task })
    await main(['bld'], h.io)
    expect(h.picks[0]?.query).toBe('bld')
    expect(h.picks[0]?.choices.map((c) => c.task.name)).toEqual(['build'])
    expect(h.runs[0]?.command.args).toEqual(['run', 'build'])
  })

  it('exits 130 without recording anything when cancelled', async () => {
    const dir = await basic()
    const h = await harness(dir, { pick: () => undefined })
    expect(await main([], h.io)).toBe(130)
    expect(h.runs).toEqual([])

    const after = await harness(dir, { historyFile: h.io.historyFile })
    await main(['--list'], after.io)
    expect(after.out().split('\n')[0]).toBe('build\tvite build')
  })
})

describe('without a terminal', () => {
  it('lists scripts instead of prompting', async () => {
    const h = await harness(await basic(), { tty: false })
    expect(await main([], h.io)).toBe(0)
    expect(h.picks).toEqual([])
    expect(h.out()).toBe('build\tvite build\ndev\tvite\ntest\tvitest\n')
  })

  it('fails when the query is not an exact name', async () => {
    const h = await harness(await basic(), { tty: false })
    expect(await main(['bld'], h.io)).toBe(1)
    expect(h.picks).toEqual([])
    expect(h.err()).toMatch(/No script named "bld"/)
  })
})

describe('hop --last', () => {
  it('reruns the last script in this project without the picker', async () => {
    const dir = await basic()
    const first = await harness(dir)
    await main(['build'], first.io)
    await main(['test'], first.io)

    const h = await harness(dir, { historyFile: first.io.historyFile })
    await main(['-l'], h.io)
    expect(h.picks).toEqual([])
    expect(h.runs[0]?.command.args).toEqual(['run', 'test'])
  })

  it('falls back to the picker when nothing has run here yet', async () => {
    const h = await harness(await basic(), { pick: (choices) => choices[0]?.task })
    await main(['--last'], h.io)
    expect(h.err()).toContain('No previous run here')
    expect(h.picks).toHaveLength(1)
  })
})

describe('errors and edge cases', () => {
  it('fails clearly without a package.json', async () => {
    const h = await harness(join(await makeProject({ 'x/.keep': '' }), 'x'))
    expect(await main([], h.io)).toBe(1)
    expect(h.err()).toMatch(/No package\.json found/)
  })

  it('says so when there are no scripts', async () => {
    const dir = await makeProject({ 'package.json': { name: 'empty' } })
    const h = await harness(dir)
    expect(await main([], h.io)).toBe(0)
    expect(h.err()).toContain(`No scripts in ${dir}`)
    expect(h.picks).toEqual([])
  })

  it('rejects an unknown --pm', async () => {
    const h = await harness(await basic())
    expect(await main(['--pm', 'pip'], h.io)).toBe(1)
    expect(h.err()).toMatch(/Unknown package manager "pip"/)
  })

  it('rejects unknown flags', async () => {
    const h = await harness(await basic())
    expect(await main(['--nope'], h.io)).toBe(1)
    expect(h.err()).toMatch(/--nope/)
  })

  it('warns about corrupt history but still runs', async () => {
    const dir = await basic()
    const file = join(await makeProject({ 'history.json': '{ nope' }), 'history.json')
    const h = await harness(dir, { historyFile: file })
    expect(await main(['dev'], h.io)).toBe(0)
    expect(h.err()).toMatch(/corrupt history/)
    expect(h.runs).toHaveLength(1)
  })

  it('still runs when history cannot be written', async () => {
    const blocker = await makeProject({ 'file': '' })
    const h = await harness(await basic(), { historyFile: join(blocker, 'file', 'history.json') })
    expect(await main(['dev'], h.io)).toBe(0)
    expect(h.runs).toHaveLength(1)
    expect(h.err()).toMatch(/history/i)
  })
})

describe('other flags', () => {
  it('--reset-history clears usage', async () => {
    const dir = await basic()
    const h = await harness(dir)
    await main(['test'], h.io)
    expect(await main(['--reset-history'], h.io)).toBe(0)

    const after = await harness(dir, { historyFile: h.io.historyFile })
    await main(['--list'], after.io)
    expect(after.out().split('\n')[0]).toBe('build\tvite build')
  })

  it('--all-scripts includes hidden hooks', async () => {
    const dir = await makeProject({ 'package.json': { scripts: { prebuild: 'rm -rf dist', build: 'tsc' } } })
    const h = await harness(dir)
    await main(['--list', '--all-scripts'], h.io)
    expect(h.out()).toBe('build\ttsc\nprebuild\trm -rf dist\n')
  })

  it('--help prints usage and --version prints the version', async () => {
    const h = await harness(await basic())
    expect(await main(['--help'], h.io)).toBe(0)
    expect(h.out()).toMatch(/Usage: hop/)
    expect(await main(['-v'], h.io)).toBe(0)
    expect(h.out()).toMatch(/\d+\.\d+\.\d+\n$/)
  })
})

describe('shell integration handoff (HOP_CMD_FILE)', () => {
  const cmdFile = async () => join(await makeProject({ 'cmd': '' }), 'cmd')

  it('writes the command for the shell to run instead of running it', async () => {
    const dir = await basic()
    const file = await cmdFile()
    const h = await harness(dir, { env: { HOP_CMD_FILE: file } })

    expect(await main(['dev'], h.io)).toBe(0)
    expect(h.runs).toEqual([])
    expect(await readFile(file, 'utf8')).toBe('npm run dev\n')

    // still counts as a run for ranking
    const after = await harness(dir, { historyFile: h.io.historyFile })
    await main(['--list'], after.io)
    expect(after.out().split('\n')[0]).toBe('dev\tvite')
  })

  it('quotes extra arguments', async () => {
    const file = await cmdFile()
    const h = await harness(await basic(), { env: { HOP_CMD_FILE: file } })
    await main(['test', '--', 'two words', '$HOME'], h.io)
    expect(await readFile(file, 'utf8')).toBe(`npm run test -- 'two words' '$HOME'\n`)
  })

  it('points root scripts at the workspace root, relative to where you are', async () => {
    const root = await makeProject({
      'package.json': { workspaces: ['packages/*'], scripts: { lint: 'eslint .' } },
      'pnpm-lock.yaml': '',
      'packages/web/package.json': { scripts: { dev: 'vite' } },
      'packages/web/src/.keep': '',
    })
    const file = await cmdFile()
    const h = await harness(join(root, 'packages/web/src'), { env: { HOP_CMD_FILE: file } })
    await main(['lint'], h.io)
    expect(await readFile(file, 'utf8')).toBe('pnpm --dir ../../.. run lint\n')

    await main(['dev'], h.io)
    expect(await readFile(file, 'utf8')).toBe('pnpm run dev\n')
  })

  it('leaves the file empty when nothing is chosen', async () => {
    const file = await cmdFile()
    const h = await harness(await basic(), { env: { HOP_CMD_FILE: file }, pick: () => undefined })
    expect(await main([], h.io)).toBe(130)
    await main(['--list'], h.io)
    expect(await readFile(file, 'utf8')).toBe('')
    expect(h.out()).toContain('dev\tvite')
  })
})

describe('hop --init', () => {
  it.each([
    ['fish', ['function hop', 'HOP_CMD_FILE', 'history append']],
    ['zsh', ['hop() {', 'HOP_CMD_FILE', 'print -s']],
    ['bash', ['hop() {', 'HOP_CMD_FILE', 'history -s']],
  ])('prints the %s integration', async (shell, parts) => {
    const h = await harness(await makeProject({}))
    expect(await main(['--init', shell], h.io)).toBe(0)
    for (const part of parts) expect(h.out()).toContain(part)
  })

  it('works outside a project', async () => {
    const h = await harness(join(await makeProject({ 'x/.keep': '' }), 'x'))
    expect(await main(['--init', 'zsh'], h.io)).toBe(0)
  })

  it('rejects unsupported shells', async () => {
    const h = await harness(await makeProject({}))
    expect(await main(['--init', 'tcsh'], h.io)).toBe(1)
    expect(h.err()).toMatch(/Unsupported shell "tcsh".*fish, zsh, bash/)
  })
})
