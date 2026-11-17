import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

const DAY = 24 * 60 * 60 * 1000

const SETUP: Record<string, { line: string; file: string }> = {
  fish: { line: 'hop --init fish | source', file: '~/.config/fish/config.fish' },
  zsh: { line: 'eval "$(hop --init zsh)"', file: '~/.zshrc' },
  bash: { line: 'eval "$(hop --init bash)"', file: '~/.bashrc' },
}

/** The note shown when a task runs without the shell wrapper, for the shell in $SHELL. */
export function initHint(shellPath: string | undefined): string {
  const setup = shellPath ? SETUP[basename(shellPath)] : undefined
  const how = setup
    ? `Add \`${setup.line}\` to ${setup.file}`
    : 'Run `hop --init fish|zsh|bash` and load it in your shell config'
  return (
    "hop: shell integration isn't loaded, so this won't be saved to shell history.\n" +
    `     ${how} (silence: HOP_NO_INIT_HINT=1)\n`
  )
}

/**
 * Whether the hint is due (not shown in the last day), recording that it was shown.
 * `file` holds the last time; if it can't be read or written the hint is simply shown.
 */
export async function hintDue(file: string, now: number): Promise<boolean> {
  try {
    const last = Number(await readFile(file, 'utf8'))
    if (now - last < DAY) return false
  } catch {
    // never shown, or unreadable: show it
  }
  await writeFile(file, String(now)).catch(() => {})
  return true
}
