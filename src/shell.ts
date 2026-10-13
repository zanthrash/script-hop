/**
 * Shell integration: a `hop` wrapper function that lets the user's shell run the chosen
 * script, so the real command (e.g. `pnpm run dev`) lands in shell history.
 *
 * Protocol: the wrapper sets HOP_CMD_FILE to a temp file. When a script is chosen, hop
 * writes the command line there instead of running it; the wrapper adds that line to
 * history and evals it. If nothing is written (--list, --help, cancel), hop's own exit
 * code is returned.
 */

const fish = `# hop shell integration for fish
# Load in ~/.config/fish/config.fish with:  hop --init fish | source
function hop --description 'Fuzzy-find and run package.json scripts'
    set -l cmd_file (command mktemp -t hop.XXXXXX); or return 1
    HOP_CMD_FILE=$cmd_file command hop $argv
    set -l code $status
    set -l cmd (command cat $cmd_file)
    command rm -f -- $cmd_file
    if test -z "$cmd"
        return $code
    end
    builtin history append -- "$cmd" 2>/dev/null
    printf '› %s\\n' "$cmd" >&2
    eval $cmd
end
`

const zsh = `# hop shell integration for zsh
# Load in ~/.zshrc with:  eval "$(hop --init zsh)"
hop() {
  local cmd_file code cmd
  cmd_file=$(command mktemp -t hop.XXXXXX) || return 1
  trap 'command rm -f -- "$cmd_file"' EXIT
  HOP_CMD_FILE=$cmd_file command hop "$@"
  code=$?
  cmd=$(<"$cmd_file")
  [[ -z $cmd ]] && return $code
  print -s -- "$cmd"
  print -r -- "› $cmd" >&2
  eval "$cmd"
}
`

export const SHELLS = { fish, zsh } as const
export type Shell = keyof typeof SHELLS

export function isShell(name: string): name is Shell {
  return Object.hasOwn(SHELLS, name)
}
