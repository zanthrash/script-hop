import type { PM, Task } from './tasks.ts'

export interface Command {
  bin: string
  args: string[]
}

/**
 * Arguments that run script `name`, optionally in another directory. Flag placement
 * differs per runner (bun only accepts `--cwd` after `run`); each was checked by hand.
 */
const runArgs: Record<PM, (name: string, dir?: string) => string[]> = {
  npm: (name, dir) => [...(dir ? ['--prefix', dir] : []), 'run', name],
  pnpm: (name, dir) => [...(dir ? ['--dir', dir] : []), 'run', name],
  yarn: (name, dir) => [...(dir ? ['--cwd', dir] : []), name],
  bun: (name, dir) => ['run', ...(dir ? ['--cwd', dir] : []), name],
  deno: (name, dir) => ['task', ...(dir ? ['--cwd', dir] : []), name],
}

/** The command that runs `task`, optionally from another directory (for shell history). */
export function commandFor(task: Pick<Task, 'runner' | 'name'>, extraArgs: string[], dir?: string): Command {
  if (task.runner === 'mise') {
    // `--` keeps flags meant for the task away from `mise run`'s own options
    const extra = extraArgs.length > 0 ? ['--', ...extraArgs] : []
    return { bin: 'mise', args: [...(dir ? ['--cd', dir] : []), 'run', task.name, ...extra] }
  }
  return buildCommand(task.runner, task.name, extraArgs, dir)
}

export function buildCommand(pm: PM, name: string, extraArgs: string[], dir?: string): Command {
  // npm treats args after the script name as its own flags unless separated by `--`
  const extra = pm === 'npm' && extraArgs.length > 0 ? ['--', ...extraArgs] : extraArgs
  return { bin: pm, args: [...runArgs[pm](name, dir), ...extra] }
}

// characters safe unquoted in both fish and zsh
const SAFE = /^[\w@%+=:,./-]+$/

/** Quote one word for fish or POSIX shells. `'\''` closes, escapes and reopens in both. */
function quote(word: string): string {
  return SAFE.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`
}

/** Render a command as a line a user could type, e.g. for shell history. */
export function toShell(command: Command): string {
  return [command.bin, ...command.args].map(quote).join(' ')
}
