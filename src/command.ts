import type { PM } from './tasks.ts'

export interface Command {
  bin: string
  args: string[]
}

const prefix: Record<PM, string[]> = {
  npm: ['run'],
  pnpm: ['run'],
  yarn: [],
  bun: ['run'],
  deno: ['task'],
}

export function buildCommand(pm: PM, name: string, extraArgs: string[]): Command {
  // npm treats args after the script name as its own flags unless separated by `--`
  const extra = pm === 'npm' && extraArgs.length > 0 ? ['--', ...extraArgs] : extraArgs
  return { bin: pm, args: [...prefix[pm], name, ...extra] }
}
