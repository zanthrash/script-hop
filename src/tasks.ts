import { resolve } from 'node:path'
import { gradleSource } from './sources/gradle.ts'
import { mavenSource } from './sources/maven.ts'
import { miseSource } from './sources/mise.ts'
import { nodeSource } from './sources/node.ts'
import type { LoadOptions, Project, SourceResult, TaskSource } from './types.ts'

export * from './types.ts'

/** Every kind of task definition hop understands. */
const SOURCES: TaskSource[] = [nodeSource, miseSource, gradleSource, mavenSource]

/**
 * Tasks for the project hop was started in: each source finds its own nearest project
 * from `cwd`, and their tasks are merged.
 */
export async function loadProject(cwd: string, opts: LoadOptions = {}): Promise<Project> {
  const found = (await Promise.all(SOURCES.map((s) => s.load(cwd, opts))))
    .filter((r): r is SourceResult => r !== undefined)
  if (found.length === 0) {
    throw new Error(`No package.json, deno.json, mise tasks, Gradle or Maven build found in ${resolve(cwd)} or any parent directory`)
  }

  // the project directory is the nearest one any source found
  const nearest = found.reduce((a, b) => (b.dir.length > a.dir.length ? b : a))
  return {
    pm: found.find((r) => r.pm)?.pm ?? 'npm',
    dir: nearest.dir,
    root: nearest.root,
    tasks: found.flatMap((r) => r.tasks),
    warnings: found.flatMap((r) => r.warnings ?? []),
  }
}
