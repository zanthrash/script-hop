import { describe, expect, it } from 'vitest'
import { buildCommand, commandFor, handoffDir, toShell } from '../src/command.ts'

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

describe('commandFor', () => {
  it('runs mise tasks with mise run, separating extra args with --', () => {
    expect(commandFor({ runner: 'mise', name: 'db:migrate' }, [])).toEqual({ bin: 'mise', args: ['run', 'db:migrate'] })
    expect(commandFor({ runner: 'mise', name: 'test' }, ['--watch', 'x']))
      .toEqual({ bin: 'mise', args: ['run', 'test', '--', '--watch', 'x'] })
  })

  it('uses the Node package manager for package.json scripts', () => {
    expect(commandFor({ runner: 'pnpm', name: 'dev' }, [], '../..'))
      .toEqual({ bin: 'pnpm', args: ['--dir', '../..', 'run', 'dev'] })
  })
})

describe('commandFor with Gradle', () => {
  const gradle = (target: string, wrapper = true) => ({ runner: 'gradle' as const, name: target.split(':').pop()!, gradle: { target, wrapper } })

  it("runs through the build's wrapper from the root", () => {
    expect(commandFor(gradle(':app:run'), [])).toEqual({ bin: './gradlew', args: [':app:run'] })
    expect(commandFor(gradle('build'), [], '.')).toEqual({ bin: './gradlew', args: ['build'] })
  })

  it('passes extra args straight to Gradle', () => {
    expect(commandFor(gradle(':app:test'), ['--tests', 'demo.*'])).toEqual({ bin: './gradlew', args: [':app:test', '--tests', 'demo.*'] })
  })

  it('reaches the wrapper from a subfolder; module paths need nothing else', () => {
    expect(commandFor(gradle(':app:run'), [], '../..')).toEqual({ bin: '../../gradlew', args: [':app:run'] })
  })

  it('runs an all-module task from the root project dir, or Gradle would only run the current module', () => {
    expect(commandFor(gradle('build'), [], '..')).toEqual({ bin: '../gradlew', args: ['-p', '..', 'build'] })
  })

  it('uses gradle from PATH when the build has no wrapper', () => {
    expect(commandFor(gradle(':app:run', false), [])).toEqual({ bin: 'gradle', args: [':app:run'] })
    expect(commandFor(gradle(':app:run', false), [], '..')).toEqual({ bin: 'gradle', args: [':app:run'] })
    expect(commandFor(gradle('build', false), [], '..')).toEqual({ bin: 'gradle', args: ['-p', '..', 'build'] })
  })
})

describe('handoffDir', () => {
  const task = (over: Partial<Parameters<typeof handoffDir>[0]>) => ({ runner: 'pnpm' as const, scope: 'local' as const, cwd: '/r', ...over })

  it('leaves local Node and mise tasks to the runner, which finds them by walking up', () => {
    expect(handoffDir(task({ cwd: '/r' }), '/r/src')).toBeUndefined()
    expect(handoffDir(task({ runner: 'mise' }), '/r/src')).toBeUndefined()
  })

  it('spells out the directory for root and package tasks', () => {
    expect(handoffDir(task({ scope: 'root' }), '/r/packages/web')).toBe('../..')
    expect(handoffDir(task({ scope: 'package', cwd: '/r/packages/api' }), '/r')).toBe('packages/api')
  })

  it('always gives Gradle tasks the way back to the build root', () => {
    expect(handoffDir(task({ runner: 'gradle' }), '/r/app/src')).toBe('../..')
    expect(handoffDir(task({ runner: 'gradle' }), '/r')).toBe('.')
  })
})
