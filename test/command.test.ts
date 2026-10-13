import { describe, expect, it } from 'vitest'
import { buildCommand, toShell } from '../src/command.ts'

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

describe('buildCommand with a directory', () => {
  it.each([
    ['npm', ['--prefix', '../..', 'run', 'lint', '--', '--fix']],
    ['pnpm', ['--dir', '../..', 'run', 'lint', '--fix']],
    ['yarn', ['--cwd', '../..', 'lint', '--fix']],
    ['bun', ['run', '--cwd', '../..', 'lint', '--fix']],
    ['deno', ['task', '--cwd', '../..', 'lint', '--fix']],
  ] as const)('%s runs the script in that directory', (pm, args) => {
    expect(buildCommand(pm, 'lint', ['--fix'], '../..')).toEqual({ bin: pm, args })
  })
})

describe('toShell', () => {
  it('leaves plain words alone', () => {
    expect(toShell({ bin: 'pnpm', args: ['--dir', '../..', 'run', 'test:unit', '--', '-x', 'a=b', 'src/x.ts'] }))
      .toBe('pnpm --dir ../.. run test:unit -- -x a=b src/x.ts')
  })

  it('single-quotes anything the shell would interpret', () => {
    expect(toShell({ bin: 'npm', args: ['run', 'test', '--', 'two words', "it's", '$HOME', '*.ts', ''] }))
      .toBe(`npm run test -- 'two words' 'it'\\''s' '$HOME' '*.ts' ''`)
  })
})
