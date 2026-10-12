import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Create a throwaway project tree. Object values are written as JSON, strings verbatim. */
export async function makeProject(files: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hop-'))
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, typeof content === 'string' ? content : JSON.stringify(content))
  }
  return root
}
