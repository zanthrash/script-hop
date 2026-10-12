import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openHistory } from '../src/history.ts'
import { makeProject } from './helpers.ts'

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 9, 11)

const historyFile = async () => join(await makeProject({}), 'state', 'history.json')

describe('history', () => {
  it('is empty when no file exists yet', async () => {
    const history = await openHistory(await historyFile())
    expect(history.usage()).toEqual({})
  })

  it('records runs and reads them back from disk', async () => {
    const file = await historyFile()
    await (await openHistory(file)).record('/repo', 'dev', now - DAY)
    await (await openHistory(file)).record('/repo', 'dev', now)

    const entry = (await openHistory(file)).usage()['/repo']?.['dev']
    expect(entry?.count).toBe(2)
    expect(entry?.lastRun).toBe(now)
    // first run decayed by one day, plus one for the new run
    expect(entry?.score).toBeCloseTo(1 + 0.5 ** (1 / 7))
  })

  it('treats a corrupt file as empty and reports it', async () => {
    const file = await historyFile()
    await (await openHistory(file)).record('/repo', 'dev', now)
    await writeFile(file, '{ not json')

    const history = await openHistory(file)
    expect(history.usage()).toEqual({})
    expect(history.warning).toMatch(/history/i)
  })

  it('prunes entries not run in 90 days when writing', async () => {
    const file = await historyFile()
    await (await openHistory(file)).record('/old', 'build', now - 91 * DAY)
    await (await openHistory(file)).record('/repo', 'dev', now)

    expect(Object.keys((await openHistory(file)).usage())).toEqual(['/repo'])
  })

  it('resets all history', async () => {
    const file = await historyFile()
    await (await openHistory(file)).record('/repo', 'dev', now)
    await (await openHistory(file)).reset()
    expect((await openHistory(file)).usage()).toEqual({})
  })

  it('writes atomically, leaving no temp files behind', async () => {
    const file = await historyFile()
    await (await openHistory(file)).record('/repo', 'dev', now)
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveProperty(['/repo', 'dev'])
    expect(await readdir(join(file, '..'))).toEqual(['history.json'])
  })
})
