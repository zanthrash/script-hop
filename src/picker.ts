import { emitKeypressEvents } from 'node:readline'
import { styleText } from 'node:util'
import search from '@inquirer/search'
import type { IO } from './app.ts'
import type { Ranked } from './rank.ts'
import type { Task } from './tasks.ts'

function highlight(name: string, positions: number[]): string {
  const hit = new Set(positions)
  return [...name].map((ch, i) => (hit.has(i) ? styleText(['bold', 'cyan'], ch) : ch)).join('')
}

function label({ task, positions }: Ranked): string {
  const tags = [task.scope === 'root' && 'root', task.package, task.source === 'deno' && 'deno'].filter(Boolean)
  const suffix = tags.length > 0 ? styleText('dim', ` (${tags.join(', ')})`) : ''
  return highlight(task.name, positions) + suffix
}

/** Line shown under the list for the highlighted task. */
export function footer(task: Task): string {
  const text = task.description ?? task.command
  if (!task.hooks) return text
  const chain = [
    task.hooks.pre !== undefined && `pre${task.name}`,
    task.name,
    task.hooks.post !== undefined && `post${task.name}`,
  ].filter(Boolean)
  return `${text}  ·  runs ${chain.join(' → ')}`
}

/** Interactive picker on stderr, so stdout stays clean. Ctrl-C or Esc cancels. */
export const pick: IO['pick'] = async (rank, query) => {
  const controller = new AbortController()
  const onKey = (_: string, key: { name?: string } | undefined) => {
    if (key?.name === 'escape') controller.abort()
  }
  emitKeypressEvents(process.stdin)
  process.stdin.on('keypress', onKey)

  try {
    return await search(
      {
        message: 'Run script',
        initialValue: query,
        pageSize: 12,
        source: (term) =>
          rank(term ?? '').map((r) => ({
            value: r.task,
            name: label(r),
            short: r.task.name,
            description: footer(r.task),
          })),
      },
      { output: process.stderr, signal: controller.signal, clearPromptOnDone: true },
    )
  } catch (error) {
    const name = (error as Error).name
    if (name === 'ExitPromptError' || name === 'AbortPromptError') return undefined
    throw error
  } finally {
    process.stdin.off('keypress', onKey)
  }
}
