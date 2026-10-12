import { describe, expect, it } from 'vitest'
import { rank, type Usage } from '../src/rank.ts'
import type { Task } from '../src/tasks.ts'

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 9, 11)

const task = (name: string, command = `echo ${name}`, cwd = '/repo'): Task => ({
  name, command, cwd, source: 'pkg', scope: cwd === '/repo' ? 'local' : 'root',
})

const tasks = [task('test'), task('dev'), task('build'), task('lint')]

const usage = (entries: Record<string, { count: number; score: number; daysAgo: number }>, cwd = '/repo'): Usage => ({
  [cwd]: Object.fromEntries(
    Object.entries(entries).map(([name, e]) => [name, { count: e.count, score: e.score, lastRun: now - e.daysAgo * DAY }]),
  ),
})

const names = (u: Usage, query = '') => rank(tasks, u, query, now).map((r) => r.task.name)

describe('rank without a query', () => {
  it('lists never-run tasks alphabetically', () => {
    expect(names({})).toEqual(['build', 'dev', 'lint', 'test'])
  })

  it('orders run tasks by frecency, before never-run ones', () => {
    expect(names(usage({
      dev: { count: 9, score: 9, daysAgo: 1 },
      test: { count: 3, score: 3, daysAgo: 2 },
    }))).toEqual(['dev', 'test', 'build', 'lint'])
  })
  it('pins the most recently run task first, even with a lower score', () => {
    expect(names(usage({
      dev: { count: 9, score: 9, daysAgo: 1 },
      lint: { count: 1, score: 1, daysAgo: 0.01 },
    }))).toEqual(['lint', 'dev', 'build', 'test'])
  })

  it('lets old usage decay below recent usage', () => {
    expect(names(usage({
      build: { count: 1, score: 1, daysAgo: 0.01 }, // pinned
      dev: { count: 40, score: 40, daysAgo: 60 },
      test: { count: 4, score: 4, daysAgo: 2 },
    }))).toEqual(['build', 'test', 'dev', 'lint'])
  })

  it('tracks same-named root and local tasks separately', () => {
    const local = task('dev', 'vite')
    const root = task('dev', 'turbo dev', '/')
    const u: Usage = { '/': { dev: { count: 5, score: 5, lastRun: now - DAY } } }
    expect(rank([local, root], u, '', now).map((r) => r.task)).toEqual([root, local])
  })
})

describe('rank with a query', () => {
  const search = (list: Task[], query: string, u: Usage = {}) =>
    rank(list, u, query, now).map((r) => r.task.name)

  it('keeps only matches and reports matched name positions', () => {
    const result = rank([task('build'), task('lint')], {}, 'bld', now)
    expect(result.map((r) => [r.task.name, r.positions])).toEqual([['build', [0, 3, 4]]])
  })

  it('ranks a better fuzzy match above a more frecent one', () => {
    const u = usage({ 'lib:install-tests': { count: 50, score: 50, daysAgo: 0 } })
    expect(search([task('lib:install-tests'), task('lint')], 'lint', u)).toEqual(['lint', 'lib:install-tests'])
  })

  it('uses frecency to break fuzzy-score ties', () => {
    const u = usage({ 'test:e2e': { count: 5, score: 5, daysAgo: 1 } })
    expect(search([task('test:unit'), task('test:e2e')], 'test', u)).toEqual(['test:e2e', 'test:unit'])
  })

  it('puts an exact name match first among ties', () => {
    const u = usage({ 'docs:dev-server': { count: 5, score: 5, daysAgo: 1 } })
    expect(search([task('docs:dev-server'), task('dev')], 'dev', u)).toEqual(['dev', 'docs:dev-server'])
  })

  it('matches commands too, but below any name match', () => {
    const list = [task('serve', 'vite --port 3000'), task('vite-legacy', 'node old.js'), task('lint', 'eslint')]
    const u = usage({ serve: { count: 50, score: 50, daysAgo: 0 } })
    const result = rank(list, u, 'vite', now)
    expect(result.map((r) => [r.task.name, r.positions])).toEqual([
      ['vite-legacy', [0, 1, 2, 3]],
      ['serve', []],
    ])
  })
})
