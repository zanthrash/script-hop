import { describe, expect, it } from 'vitest'
import { buildCommand } from '../src/command.ts'

describe('buildCommand', () => {
  it.each([
    ['npm', 'npm', ['run', 'dev', '--', '--watch', '-x']],
    ['pnpm', 'pnpm', ['run', 'dev', '--watch', '-x']],
    ['yarn', 'yarn', ['dev', '--watch', '-x']],
    ['bun', 'bun', ['run', 'dev', '--watch', '-x']],
    ['deno', 'deno', ['task', 'dev', '--watch', '-x']],
  ] as const)('%s passes extra args correctly', (pm, bin, args) => {
    expect(buildCommand(pm, 'dev', ['--watch', '-x'])).toEqual({ bin, args })
  })

  it('omits the npm separator when there are no extra args', () => {
    expect(buildCommand('npm', 'dev', [])).toEqual({ bin: 'npm', args: ['run', 'dev'] })
  })
})
