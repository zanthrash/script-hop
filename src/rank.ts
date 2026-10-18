import * as fzf from 'fzf'
import { Fzf, type FzfResultItem } from 'fzf'
import { entryFor, frecency, type Usage } from './history.ts'
import { mixesRunners } from './tags.ts'
import type { Task } from './tasks.ts'

// fzf's typings re-export its matchers with `export *`, which TypeScript doesn't pick up
// for this package; the runtime export is there.
const { extendedMatch } = fzf as unknown as {
  extendedMatch: <U>(this: unknown, query: string) => FzfResultItem<U>[]
}

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
  const entryOf = (t: Task) => entryFor(usage, t)
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

  // workspace package names are searchable too ("api test"), and runner names when the
  // list mixes runners ("mise lint"); terms separated by spaces must all match, as in
  // fzf's extended mode. The name comes first so highlight positions index into it.
  const showRunner = mixesRunners(tasks)
  const byName: FzfResultItem<Task>[] = new Fzf(tasks, {
    selector: (t: Task) => [t.name, t.package, showRunner ? t.runner : undefined].filter(Boolean).join(' '),
    match: extendedMatch,
  }).find(query)
  const nameMatched = new Set(byName.map((m) => m.item))
  const commandOnly = tasks.filter((t) => !nameMatched.has(t))
  const byCommand: FzfResultItem<Task>[] = new Fzf(commandOnly, { selector: (t: Task) => t.command, match: extendedMatch })
    .find(query)

  const order = (a: FzfResultItem<Task>, b: FzfResultItem<Task>) =>
    b.score - a.score ||
    Number(b.item.name === query) - Number(a.item.name === query) ||
    scoreOf(b.item) - scoreOf(a.item) ||
    a.item.name.localeCompare(b.item.name)

  return [
    ...byName.sort(order).map((m) => ({
      task: m.item,
      // only highlight within the script name, not the package name after it
      positions: [...m.positions].filter((p) => p < m.item.name.length).sort((x, y) => x - y),
    })),
    ...byCommand.sort(order).map((m) => ({ task: m.item, positions: [] })),
  ]
}
