import { fileURLToPath } from 'node:url'
import crossSpawn from 'cross-spawn'

/** Build dist/ once for the suites that run the real CLI. */
export default function setup() {
  const repo = fileURLToPath(new URL('..', import.meta.url))
  // cross-spawn resolves Windows .cmd shims like pnpm.cmd
  const build = crossSpawn.sync('pnpm', ['build'], { cwd: repo, encoding: 'utf8' })
  if (build.status !== 0) throw new Error(`build failed:\n${build.stdout}${build.stderr}`)
}
