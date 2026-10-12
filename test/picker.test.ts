import { describe, expect, it } from 'vitest'
import { footer } from '../src/picker.ts'
import type { Task } from '../src/tasks.ts'

const task = (over: Partial<Task>): Task =>
  ({ name: 'build', command: 'tsc', source: 'pkg', scope: 'local', cwd: '/repo', ...over })

describe('picker footer', () => {
  it('shows the command', () => {
    expect(footer(task({}))).toBe('tsc')
  })

  it('prefers the description', () => {
    expect(footer(task({ description: 'Production build' }))).toBe('Production build')
  })

  it('adds the hook chain the runner will run', () => {
    expect(footer(task({ hooks: { pre: 'rimraf dist', post: 'echo done' } })))
      .toBe('tsc  ·  runs prebuild → build → postbuild')
    expect(footer(task({ description: 'Production build', hooks: { post: 'echo done' } })))
      .toBe('Production build  ·  runs build → postbuild')
  })
})
