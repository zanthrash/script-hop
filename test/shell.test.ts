import { spawnSync } from 'node:child_process'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeProject } from './helpers.ts'

const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url))
const has = (bin: string) => spawnSync(bin, ['--version']).status === 0

/** fish only gained `history append` in 4.0; older fish runs the command without recording it. */
const fishMajor = () =>
  Number(/version (\d+)/.exec(spawnSync('fish', ['--version'], { encoding: 'utf8' }).stdout ?? '')?.[1] ?? 0)
const recordsHistory = (shell: string) => shell !== 'fish' || fishMajor() >= 4

/** A project, plus a bin dir that puts the built `hop` on PATH. */
async function setup() {
  const dir = await makeProject({
    'package.json': { scripts: { hi: 'echo hello-from-script', fail: 'exit 3', args: 'node args.js' } },
    'args.js': 'console.log("ARGS:" + JSON.stringify(process.argv.slice(2)))',
    'package-lock.json': '{}',
    'bin/.keep': '',
  })
  await symlink(cli, join(dir, 'bin', 'hop'))
  const env = {
    ...process.env,
    PATH: `${join(dir, 'bin')}${delimiter}${process.env.PATH}`,
    HOP_HISTORY: join(dir, 'hop-history.json'),
    HOP_PM: '',
    XDG_DATA_HOME: join(dir, 'xdg'), // fish history
    HISTFILE: join(dir, 'zsh_history'),
  }
  return { dir, env }
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
    // --no-config: ignore the user's config; history append works in -c mode
    run: (script: string) => ['fish', ['--no-config', '-c', `hop --init fish | source\n${script}`]] as const,
    status: '$status',
    lastHistory: 'history search --max 1',
  },
  zsh: {
    run: (script: string) => ['zsh', ['-f', '-c', `eval "$(hop --init zsh)"\n${script}`]] as const,
    status: '$?',
    lastHistory: 'fc -ln -1',
  },
}

describe.each(Object.entries(shells))('%s integration', (shell, s) => {
  const run = async (script: string, opts: { atuin?: boolean } = {}) => {
    const { dir, env } = await setup()
    const atuinEnv = opts.atuin ? await isolatedAtuin(dir) : {}
    const [bin, args] = s.run(script)
    const result = spawnSync(bin, args, { cwd: dir, env: { ...env, ...atuinEnv }, encoding: 'utf8' })
    return { out: result.stdout, err: result.stderr }
  }

  // atuin replaces ↑ and Ctrl-R with its own history, which the shell's history doesn't feed
  it.skipIf(!has(shell) || !has('atuin'))('records the command in atuin when atuin is active', async () => {
    // fish --no-config implies private mode, where atuin (and hop) record nothing; a real
    // session isn't private. atuin's `history end` runs in the background, hence the sleep.
    const unprivate = shell === 'fish' ? 'set -e fish_private_mode\n' : ''
    const { out } = await run(`${unprivate}hop hi\nsleep 1\natuin history list --cmd-only`, { atuin: true })
    expect(out).toContain('hello-from-script')
    expect(out.trim().split('\n').at(-1)?.trim()).toBe('npm run hi')
  })

  it.skipIf(!has(shell) || !recordsHistory(shell))('runs the script in the shell and records it in shell history', async () => {
    const { out, err } = await run(`hop hi\necho EXIT=${s.status}\n${s.lastHistory}`)
    expect(out).toContain('hello-from-script')
    expect(out).toContain('EXIT=0')
    expect(out.trim().split('\n').at(-1)?.trim()).toBe('npm run hi')
    expect(err).toContain('› npm run hi')
  })

  it.skipIf(!has(shell) || recordsHistory(shell))('on fish < 4, runs the script and explains once why history is skipped', async () => {
    const { out, err } = await run(`hop hi\nhop hi\necho EXIT=${s.status}`)
    // npm also echoes the script's command, so count only its output lines
    expect(out.split('\n').filter((l) => l.trim() === 'hello-from-script')).toHaveLength(2)
    expect(out).toContain('EXIT=0')
    expect(err.match(/cannot add commands to history/g)).toHaveLength(1)
  })

  it.skipIf(!has(shell))("returns the script's exit code", async () => {
    const { out } = await run(`hop fail\necho EXIT=${s.status}`)
    expect(out).toContain('EXIT=3')
  })

  it.skipIf(!has(shell))('passes quoted arguments through intact', async () => {
    const { out } = await run(`hop args -- 'two words' '$HOME'\n${s.lastHistory}`)
    expect(out).toContain('ARGS:["two words","$HOME"]')
    if (recordsHistory(shell)) {
      expect(out.trim().split('\n').at(-1)?.trim()).toBe(`npm run args -- 'two words' '$HOME'`)
    }
  })

  it.skipIf(!has(shell))('passes non-run output and exit codes straight through', async () => {
    const { out } = await run(`hop --list\nhop nope\necho EXIT=${s.status}`)
    expect(out).toContain('hi\techo hello-from-script')
    expect(out).toContain('EXIT=1')
  })
})
