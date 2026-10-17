import { describe, expect, it } from 'vitest'
import { formula, parseChecksums } from '../scripts/homebrew-formula.ts'

const sums = {
  'darwin-arm64': 'a'.repeat(64),
  'darwin-x64': 'b'.repeat(64),
  'linux-arm64': 'c'.repeat(64),
  'linux-x64': 'd'.repeat(64),
}

describe('homebrew formula', () => {
  const rb = formula('0.6.0', sums)

  it('points each OS and CPU at its release asset and checksum', () => {
    const base = 'https://github.com/zanthrash/script-hop/releases/download/v0.6.0'
    for (const [target, sha] of Object.entries(sums)) {
      expect(rb).toContain(`url "${base}/hop-v0.6.0-${target}.tar.gz"`)
      expect(rb).toContain(`sha256 "${sha}"`)
    }
    // each url is inside the right on_macos/on_linux + on_arm/on_intel block
    expect(rb).toMatch(/on_macos do\s+on_arm do\s+url "[^"]+darwin-arm64[^"]+"/)
    expect(rb).toMatch(/on_linux do\s+on_arm do\s+url "[^"]+linux-arm64[^"]+"/)
    expect(rb).toMatch(/on_intel do\s+url "[^"]+darwin-x64[^"]+"/)
    expect(rb).toMatch(/on_intel do\s+url "[^"]+linux-x64[^"]+"/)
  })

  it('installs the hop executable and tests it reports the version', () => {
    expect(rb).toContain('class ScriptHop < Formula')
    expect(rb).toContain('version "0.6.0"')
    expect(rb).toContain('bin.install "hop"')
    expect(rb).toContain('shell_output("#{bin}/hop --version")')
  })

  it('refuses to write a formula with a missing checksum', () => {
    const { 'linux-x64': _, ...partial } = sums
    expect(() => formula('0.6.0', partial as typeof sums)).toThrow(/linux-x64/)
  })
})

describe('parseChecksums', () => {
  it('reads sha256sum output into checksums per target', () => {
    const text = Object.entries(sums).map(([t, sha]) => `${sha}  hop-v0.6.0-${t}.tar.gz`).join('\n')
    expect(parseChecksums(text, '0.6.0')).toEqual(sums)
  })
})
