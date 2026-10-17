import { spawnSync } from 'node:child_process'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeProject } from './helpers.ts'
import { hopExecutable } from './hop-under-test.ts'

const has = (bin: string) => spawnSync(bin, ['--version']).status === 0
// shell integration targets Unix shells; Windows runners have Git Bash, which isn't covered yet
const available = (shell: string) => process.platform !== 'win32' && has(shell)

/** fish only gained `history append` in 4.0; older fish runs the command without recording it. */
const fishMajor = () =>
  Number(/version (\d+)/.exec(spawnSync('fish', ['--version'], { encoding: 'utf8' }).stdout ?? '')?.[1] ?? 0)
const recordsHistory = (shell: string) => shell !== 'fish' || fishMajor() >= 4

/**
 * A project and a throwaway HOME set up like an ordinary user's: shells start interactive
 * with their normal history behaviour (fish isn't in private mode; zsh has the HISTFILE
 * settings any distro or framework sets), and history is checked on disk afterwards.
 */
async function setup() {
  const dir = await makeProject({
    'package.json': { scripts: { hi: 'echo hello-from-script', fail: 'exit 3', args: 'node args.js' } },
    'args.js': 'console.log("ARGS:" + JSON.stringify(process.argv.slice(2)))',
    'package-lock.json': '{}',
    'bin/.keep': '',
    'home/.zshrc': 'HISTFILE=$HOME/.zsh_history\nHISTSIZE=1000\nSAVEHIST=1000\n',
    'home/.bashrc': 'HISTFILE=$HOME/.bash_history\nHISTSIZE=1000\nHISTFILESIZE=2000\n',
  })
  await symlink(hopExecutable, join(dir, 'bin', 'hop'))
  const home = join(dir, 'home')
  // never inherit the developer's own shell setup, history locations or atuin session
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    !/^(XDG_|ATUIN_|HIST|ZDOTDIR$|fish_)/.test(k)))
  const env = {
    ...inherited,
    HOME: home,
    ZDOTDIR: home,
    PATH: `${join(dir, 'bin')}${delimiter}${process.env.PATH}`,
    HOP_HISTORY: join(dir, 'hop-history.json'),
    HOP_PM: '',
    BASH_SILENCE_DEPRECATION_WARNING: '1', // macOS /bin/bash nags about zsh
  }
  return { dir, home, env }
}

/** Point atuin at a throwaway database (no daemon, no sync) and start a session. */
async function isolatedAtuin(dir: string) {
  const cfg = join(dir, 'atuin-config')
  const data = join(dir, 'atuin-data')
  await mkdir(cfg, { recursive: true })
  await mkdir(data, { recursive: true })
  await writeFile(join(cfg, 'config.toml'), [
    `db_path = "${join(data, 'history.db')}"`,
    `record_store_path = "${join(data, 'records.db')}"`,
    `key_path = "${join(data, 'key')}"`,
    'auto_sync = false',
    'update_check = false',
    '[daemon]',
    'enabled = false',
  ].join('\n'))
  const session = spawnSync('atuin', ['uuid'], { encoding: 'utf8' }).stdout.trim()
  return { ATUIN_CONFIG_DIR: cfg, ATUIN_SESSION: session }
}

const shells = {
  fish: {
    // -i: an interactive session saves history (with --no-config, fish is private and doesn't)
    run: (script: string) => ['fish', ['-i', '-c', `hop --init fish | source\n${script}`]] as const,
    status: '$status',
    /** Newest entries, read back by a fresh fish from the history file. */
    savedHistory: async (env: NodeJS.ProcessEnv) => {
      // fish can finish saving its history file just after the session exits; retry briefly
      for (let attempt = 0; ; attempt++) {
        const out = spawnSync('fish', ['-c', 'history search --max 3'], { env, encoding: 'utf8' }).stdout.trim()
        if (out || attempt === 20) return out.split('\n')
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    },
  },
  zsh: {
    run: (script: string) => ['zsh', ['-i', '-c', `eval "$(hop --init zsh)"\n${script}`]] as const,
    status: '$?',
    savedHistory: async (_env: NodeJS.ProcessEnv, home: string) =>
      (await readFile(join(home, '.zsh_history'), 'utf8')).trim().split('\n').reverse(),
  },
  bash: {
    run: (script: string) => ['bash', ['-i', '-c', `eval "$(hop --init bash)"\n${script}`]] as const,
    status: '$?',
    savedHistory: async (_env: NodeJS.ProcessEnv, home: string) =>
      (await readFile(join(home, '.bash_history'), 'utf8')).trim().split('\n').reverse(),
  },
}

describe.each(Object.entries(shells))('%s integration', (shell, s) => {
  const run = async (script: string, opts: { atuin?: boolean } = {}) => {
    const { dir, home, env } = await setup()
    const atuinEnv = opts.atuin ? await isolatedAtuin(dir) : {}
    const [bin, args] = s.run(script)
    const result = spawnSync(bin, args, { cwd: dir, env: { ...env, ...atuinEnv }, encoding: 'utf8', input: '' })
    return { out: result.stdout, err: result.stderr, history: () => s.savedHistory(env, home) }
  }

  // atuin replaces ↑ and Ctrl-R with its own history, which the shell's history doesn't feed
  it.skipIf(!available(shell) || !has('atuin'))('records the command in atuin when atuin is active', async () => {
    // atuin's `history end` runs in the background, hence the sleep
    const { out } = await run(`hop hi\nsleep 1\natuin history list --cmd-only`, { atuin: true })
    expect(out).toContain('hello-from-script')
    expect(out.trim().split('\n').at(-1)?.trim()).toBe('npm run hi')
  })

  it.skipIf(!available(shell) || !recordsHistory(shell))('runs the script in the shell and saves it to shell history', async () => {
    const { out, err, history } = await run(`hop hi\necho EXIT=${s.status}`)
    expect(out).toContain('hello-from-script')
    expect(out).toContain('EXIT=0')
    expect(err).toContain('› npm run hi')
    // newest entry is the real command (with -c there is no typed `hop` line to record)
    expect((await history())[0]).toBe('npm run hi')
  })

  it.skipIf(!available(shell) || recordsHistory(shell))('on fish < 4, runs the script and explains once why history is skipped', async () => {
    const { out, err } = await run(`hop hi\nhop hi\necho EXIT=${s.status}`)
    // npm also echoes the script's command, so count only its output lines
    expect(out.split('\n').filter((l) => l.trim() === 'hello-from-script')).toHaveLength(2)
    expect(out).toContain('EXIT=0')
    expect(err.match(/cannot add commands to history/g)).toHaveLength(1)
  })

  it.skipIf(!available(shell))("returns the script's exit code", async () => {
    const { out } = await run(`hop fail\necho EXIT=${s.status}`)
    expect(out).toContain('EXIT=3')
  })

  it.skipIf(!available(shell))('passes quoted arguments through intact', async () => {
    const { out, history } = await run(`hop args -- 'two words' '$HOME'`)
    expect(out).toContain('ARGS:["two words","$HOME"]')
    if (recordsHistory(shell)) {
      expect((await history())[0]).toBe(`npm run args -- 'two words' '$HOME'`)
    }
  })

  it.skipIf(!available(shell))('passes non-run output and exit codes straight through', async () => {
    const { out } = await run(`hop --list\nhop nope\necho EXIT=${s.status}`)
    expect(out).toContain('hi\techo hello-from-script')
    expect(out).toContain('EXIT=1')
  })
})
