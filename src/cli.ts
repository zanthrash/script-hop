#!/usr/bin/env node
import { join } from 'node:path'
import envPaths from 'env-paths'
import { main } from './app.ts'
import { pick } from './picker.ts'
import { exec } from './run.ts'
import { spinner } from './spinner.ts'

const paths = envPaths('script-hop', { suffix: '' })
const historyFile = process.env.HOP_HISTORY ?? join(paths.data, 'history.json')
const cacheDir = process.env.HOP_CACHE ?? paths.cache

// `hop --list | head`: once the reader has gone there's nothing left to say, so stop
// quietly instead of crashing on the next write
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error
  process.exit(0)
})

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  now: Date.now,
  isTTY: Boolean(process.stdin.isTTY && process.stderr.isTTY),
  env: process.env,
  historyFile,
  cacheDir,
  progress: spinner(process.stderr),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  pick,
  exec,
})
