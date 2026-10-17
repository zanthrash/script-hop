import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The `hop` the end-to-end and shell tests run: the npm build by default, or a compiled
 * standalone executable when HOP_BIN points at one (the release workflow tests each
 * platform's executable this way before publishing it).
 */
const bin = process.env.HOP_BIN ? resolve(process.env.HOP_BIN) : undefined
const npmBuild = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url))

/** Executable to put on PATH as `hop` (the npm build runs via its node shebang). */
export const hopExecutable = bin ?? npmBuild

/** Command and leading args to spawn hop directly. */
export const hopCommand: [string, string[]] = bin ? [bin, []] : [process.execPath, [npmBuild]]

export const testingStandaloneBinary = bin !== undefined
