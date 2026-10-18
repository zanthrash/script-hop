import type { Task } from './types.ts'

/** Whether the list mixes runners, so each task should say which one runs it. */
export const mixesRunners = (tasks: readonly Task[]) => new Set(tasks.map((t) => t.runner)).size > 1

/**
 * Short labels shown after a task's name in the picker and as `--list`'s third column:
 * its runner (only when runners are mixed), `root`, its workspace package, `deno`.
 */
export function tagsFor(task: Task, showRunner: boolean): string[] {
  return [
    showRunner ? task.runner : undefined,
    task.scope === 'root' ? 'root' : undefined,
    task.package,
    // with runners shown, "deno" is already said
    !showRunner && task.source === 'deno' ? 'deno' : undefined,
  ].filter((t): t is string => t !== undefined)
}
