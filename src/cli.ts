#!/usr/bin/env node
import { join } from 'node:path'
import envPaths from 'env-paths'
import { main } from './app.ts'
import { pick } from './picker.ts'
import { exec } from './run.ts'

const historyFile =
  process.env.HOP_HISTORY ?? join(envPaths('script-hop', { suffix: '' }).data, 'history.json')

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  now: Date.now,
  isTTY: Boolean(process.stdin.isTTY && process.stderr.isTTY),
  env: process.env,
  historyFile,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  pick,
  exec,
})
