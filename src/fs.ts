import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'

export const exists = (path: string) => access(path).then(() => true, () => false)

/** Nearest path to `file` at or above `from`. */
export async function findUp(file: string, from: string): Promise<string | undefined> {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (await exists(join(dir, file))) return join(dir, file)
    if (dirname(dir) === dir) return undefined
  }
}

/** Nearest directory at or above `from` containing any of `files`. */
export async function findDirUp(files: readonly string[], from: string): Promise<string | undefined> {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    for (const file of files) if (await exists(join(dir, file))) return dir
    if (dirname(dir) === dir) return undefined
  }
}

/** Parse a JSON or JSONC file; undefined if it doesn't exist. */
export async function readJson(path: string): Promise<any | undefined> {
  if (!(await exists(path))) return undefined
  return parseJsonc(await readFile(path, 'utf8'))
}
