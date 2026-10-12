import { constants } from 'node:os'
import spawn from 'cross-spawn'
import type { IO } from './app.ts'

const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

/**
 * Run a command attached to the terminal and resolve to its exit code.
 * Signals sent to hop are passed on to the child instead of killing hop first, so the
 * child can clean up and hop can still report its exit code.
 */
export const exec: IO['exec'] = (command, cwd) =>
  new Promise((resolve) => {
    const child = spawn(command.bin, command.args, { cwd, stdio: 'inherit' })

    // Ctrl-C reaches the child directly via the terminal's process group; forwarding
    // covers signals sent to hop alone (e.g. `kill`).
    const forward = (signal: NodeJS.Signals) => () => child.kill(signal)
    const handlers = FORWARDED.map((signal) => [signal, forward(signal)] as const)
    for (const [signal, handler] of handlers) process.on(signal, handler)
    const cleanup = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler)
    }

    child.on('error', (error: NodeJS.ErrnoException) => {
      cleanup()
      if (error.code === 'ENOENT') {
        process.stderr.write(
          `hop: "${command.bin}" was not found. Install it, or run \`corepack enable\`, or pick another with --pm.\n`,
        )
        resolve(127)
      } else {
        process.stderr.write(`hop: ${error.message}\n`)
        resolve(1)
      }
    })

    child.on('close', (code, signal) => {
      cleanup()
      resolve(code ?? 128 + (signal ? (constants.signals[signal] ?? 0) : 0))
    })
  })
