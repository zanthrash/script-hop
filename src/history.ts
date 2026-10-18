import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface Entry {
  count: number
  /** Frecency score as of `lastRun`. */
  score: number
  /** Epoch milliseconds. */
  lastRun: number
}

const HALF_LIFE = 7 * 24 * 60 * 60 * 1000

/** Entry score decayed to `now`, halving every week. */
export function frecency(entry: Entry, now: number): number {
  return entry.score * 0.5 ** ((now - entry.lastRun) / HALF_LIFE)
}

/** Usage history keyed by task cwd, then task name. */
export type Usage = Record<string, Record<string, Entry>>

export interface History {
  usage(): Usage
  record(cwd: string, name: string, now: number): Promise<void>
  reset(): Promise<void>
  /** Set when the file existed but couldn't be read; history then starts empty. */
  warning?: string
}

const MAX_AGE = 90 * 24 * 60 * 60 * 1000

async function load(file: string): Promise<{ usage: Usage; warning?: string }> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { usage: {} }
    return { usage: {}, warning: `Could not read history at ${file}; ranking disabled` }
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { usage: parsed as Usage }
  } catch {}
  return { usage: {}, warning: `Ignoring corrupt history at ${file}` }
}

function prune(usage: Usage, now: number): Usage {
  const kept: Usage = {}
  for (const [cwd, entries] of Object.entries(usage)) {
    const fresh = Object.entries(entries).filter(([, e]) => now - e.lastRun <= MAX_AGE)
    if (fresh.length > 0) kept[cwd] = Object.fromEntries(fresh)
  }
  return kept
}

async function save(file: string, usage: Usage): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  // write-then-rename so a concurrent reader never sees a half-written file
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, JSON.stringify(usage))
  await rename(temp, file)
}

export async function openHistory(file: string): Promise<History> {
  const loaded = await load(file)
  let usage = loaded.usage

  return {
    warning: loaded.warning,
    usage: () => usage,
    async record(cwd, name, now) {
      const previous = usage[cwd]?.[name]
      const entry: Entry = {
        count: (previous?.count ?? 0) + 1,
        score: (previous ? frecency(previous, now) : 0) + 1,
        lastRun: now,
      }
      usage = prune({ ...usage, [cwd]: { ...usage[cwd], [name]: entry } }, now)
      await save(file, usage)
    },
    async reset() {
      usage = {}
      await save(file, usage)
    },
  }
}

type Keyed = { name: string; runner: string; source: string; gradle?: { target: string } }

/**
 * A task's key within its directory's history. package.json and deno.json scripts use the
 * bare name, as they always have (so history survives switching npm <-> pnpm); other
 * runners are prefixed, so `build (mise)` and `build (pnpm)` in one folder stay apart.
 * Gradle tasks all run from the build root, so they're keyed by Gradle path (`:app:run`).
 */
export function historyKey(task: Keyed): string {
  if (task.source === 'pkg' || task.source === 'deno') return task.name
  return `@${task.runner}:${task.gradle?.target ?? task.name}`
}

/** A task's history entry, if it has been run. */
export function entryFor(usage: Usage, task: Keyed & { cwd: string }): Entry | undefined {
  return usage[task.cwd]?.[historyKey(task)]
}
