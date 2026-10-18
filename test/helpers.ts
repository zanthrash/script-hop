import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

/** Create a throwaway project tree. Object values are written as JSON, strings verbatim. */
export async function makeProject(files: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hop-'))
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, typeof content === 'string' ? content : JSON.stringify(content))
  }
  return root
}

/** Whether a real Gradle (and a JDK for it) is on PATH for tests that need one. */
export const hasGradle = spawnSync('gradle', ['--version'], { shell: process.platform === 'win32' }).status === 0

/** Whether a real Maven (and a JDK for it) is on PATH for tests that need one. */
export const hasMaven = spawnSync('mvn', ['-v'], { shell: process.platform === 'win32' }).status === 0

/** Whether a real `mise` is available for tests that need one. */
export const hasMise = spawnSync('mise', ['--version']).status === 0

/**
 * Keep tests away from the developer's own mise setup: a throwaway global config (with a
 * task that must never show up) and every temp project trusted. Returns a restore function.
 */
export async function isolateMise(): Promise<() => void> {
  const saved = { ...process.env }
  const globalDir = await makeProject({ 'config.toml': '[tasks.from-global]\nrun = "echo global"\n' })
  process.env.MISE_GLOBAL_CONFIG_FILE = join(globalDir, 'config.toml')
  // temp dirs on macOS are symlinked (/var -> /private/var); mise compares real paths
  process.env.MISE_TRUSTED_CONFIG_PATHS = [tmpdir(), realpathSync(tmpdir())].join(delimiter)
  process.env.MISE_YES = '1'
  return () => {
    process.env = saved
  }
}
