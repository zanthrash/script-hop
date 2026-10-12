import { Fzf, type FzfResultItem } from 'fzf'
import { frecency, type Usage } from './history.ts'
import type { Task } from './tasks.ts'

export type { Usage }

export interface Ranked {
  task: Task
  /** Indices of matched characters in the task name, ascending. Empty when unmatched or no query. */
  positions: number[]
}

/**
 * Order tasks for display.
 *
 * Without a query: last-run task pinned first, then by frecency, then never-run tasks alphabetically.
 * With a query: name matches before command-only matches; within each, fuzzy score, then exact
 * name, then frecency, then name.
 */
export function rank(tasks: Task[], usage: Usage, query: string, now: number): Ranked[] {
  const entryOf = (t: Task) => usage[t.cwd]?.[t.name]
  const scoreOf = (t: Task) => {
    const entry = entryOf(t)
    return entry ? frecency(entry, now) : -1
  }

  if (query.trim() === '') {
    const lastRunAt = (t: Task) => entryOf(t)?.lastRun ?? -Infinity
    const lastRun = tasks.reduce<Task | undefined>(
      (latest, t) => (lastRunAt(t) > (latest ? lastRunAt(latest) : -Infinity) ? t : latest),
      undefined,
    )

    return [...tasks]
      .sort((a, b) =>
        Number(b === lastRun) - Number(a === lastRun) ||
        scoreOf(b) - scoreOf(a) ||
        a.name.localeCompare(b.name))
      .map((task) => ({ task, positions: [] }))
  }

  const byName: FzfResultItem<Task>[] = new Fzf(tasks, { selector: (t: Task) => t.name }).find(query)
  const nameMatched = new Set(byName.map((m) => m.item))
  const commandOnly = tasks.filter((t) => !nameMatched.has(t))
  const byCommand: FzfResultItem<Task>[] = new Fzf(commandOnly, { selector: (t: Task) => t.command })
    .find(query)

  const order = (a: FzfResultItem<Task>, b: FzfResultItem<Task>) =>
    b.score - a.score ||
    Number(b.item.name === query) - Number(a.item.name === query) ||
    scoreOf(b.item) - scoreOf(a.item) ||
    a.item.name.localeCompare(b.item.name)

  return [
    ...byName.sort(order).map((m) => ({ task: m.item, positions: [...m.positions].sort((x, y) => x - y) })),
    ...byCommand.sort(order).map((m) => ({ task: m.item, positions: [] })),
  ]
}
