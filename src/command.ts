import { relative, sep } from 'node:path'
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

/**
 * The command that runs `task`, optionally from another directory (for shell history).
 * `dir` is relative to where the command will be typed.
 */
export function commandFor(task: Pick<Task, 'runner' | 'name' | 'gradle' | 'maven'>, extraArgs: string[], dir?: string): Command {
  if (task.runner === 'gradle') {
    if (!task.gradle) throw new Error(`Gradle task "${task.name}" has no Gradle path`)
    return gradleCommand(task.gradle, extraArgs, dir)
  }
  if (task.runner === 'maven') {
    if (!task.maven) throw new Error(`Maven task "${task.name}" has no goals`)
    return mavenCommand(task.maven, extraArgs, dir)
  }
  if (task.runner === 'mise') {
    // `--` keeps flags meant for the task away from `mise run`'s own options
    const extra = extraArgs.length > 0 ? ['--', ...extraArgs] : []
    return { bin: 'mise', args: [...(dir ? ['--cd', dir] : []), 'run', task.name, ...extra] }
  }
  return buildCommand(task.runner, task.name, extraArgs, dir)
}

/**
 * Gradle runs through the build root's wrapper. A module path (`:app:run`) means the same
 * from any folder of the build; a bare name (`build`) means "in every module" only from the
 * root, so from elsewhere `-p` points Gradle back at it. Each form was checked by hand.
 */
function gradleCommand({ target, wrapper }: NonNullable<Task['gradle']>, extraArgs: string[], dir?: string): Command {
  const atRoot = !dir || dir === '.'
  const bin = !wrapper ? 'gradle' : atRoot ? './gradlew' : `${dir}/gradlew`
  const project = !atRoot && !target.startsWith(':') ? ['-p', dir] : []
  return { bin, args: [...project, target, ...extraArgs] }
}

/**
 * Maven runs through the build root's wrapper. Away from the root, `-f` points it at the
 * root POM. A module's tasks run with `-pl <module>`, and `-am` where that's safe, to also
 * build the modules it depends on. Each form was checked against a real multi-module build.
 */
function mavenCommand({ goals, module, alsoMake, wrapper }: NonNullable<Task['maven']>, extraArgs: string[], dir?: string): Command {
  const atRoot = !dir || dir === '.'
  const bin = !wrapper ? 'mvn' : atRoot ? './mvnw' : `${dir}/mvnw`
  const project = module ? ['-pl', module, ...(alsoMake ? ['-am'] : [])] : []
  return { bin, args: [...(atRoot ? [] : ['-f', dir]), ...project, ...goals, ...extraArgs] }
}

/**
 * Directory to spell out when handing `task` to the user's shell from `from`, so the line
 * works as typed there (and from history). Local Node and mise tasks need none: their
 * runners find them by walking up. Gradle and Maven always need the way back to the
 * build root.
 */
export function handoffDir(task: Pick<Task, 'runner' | 'scope' | 'cwd'>, from: string): string | undefined {
  if (task.scope === 'local' && task.runner !== 'gradle' && task.runner !== 'maven') return undefined
  // forward slashes: the line is for fish/zsh/bash, and runners accept them on Windows too
  return relative(from, task.cwd).split(sep).join('/') || '.'
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
