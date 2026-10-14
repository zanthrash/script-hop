/**
 * Shell integration: a `hop` wrapper function that lets the user's shell run the chosen
 * script, so the real command (e.g. `pnpm run dev`) lands in shell history.
 *
 * Protocol: the wrapper sets HOP_CMD_FILE to a temp file. When a script is chosen, hop
 * writes the command line there instead of running it; the wrapper adds that line to
 * history and evals it. If nothing is written (--list, --help, cancel), hop's own exit
 * code is returned.
 *
 * atuin replaces ↑ and Ctrl-R with its own database, fed only by its preexec/postexec
 * hooks for typed commands. When an atuin session is active, the wrapper records the
 * command there too, the same way those hooks do (\`atuin history start\` / \`end\`).
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
    set -l atuin_id
    if set -q ATUIN_SESSION; and test -z "$fish_private_mode"; and command -q atuin
        set atuin_id (ATUIN_SHELL=fish command atuin history start -- "$cmd" 2>/dev/null)
    end
    # \`history append\` arrived in fish 4.0; older fish would treat it as a search. Writing
    # the history file directly isn't safe (fish tracks its own file offsets), so older
    # fish just runs the command and, unless atuin recorded it, says once why.
    if test (string split -f1 . -- $FISH_VERSION) -ge 4
        builtin history append -- "$cmd"
    else if test -z "$atuin_id"; and not set -q __hop_history_warned
        set -g __hop_history_warned 1
        printf 'hop: fish %s cannot add commands to history; upgrade to fish 4.0+ for that\\n' $FISH_VERSION >&2
    end
    printf '› %s\\n' "$cmd" >&2
    eval $cmd
    set -l code $status
    if test -n "$atuin_id"
        command atuin history end --exit $code -- $atuin_id &>/dev/null &
        disown
    end
    return $code
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
  local atuin_id
  if [[ -n $ATUIN_SESSION ]] && (( $+commands[atuin] )); then
    atuin_id=$(ATUIN_SHELL=zsh command atuin history start -- "$cmd" 2>/dev/null)
  fi
  print -s -- "$cmd"
  print -r -- "› $cmd" >&2
  eval "$cmd"
  code=$?
  if [[ -n $atuin_id ]]; then
    (command atuin history end --exit $code -- "$atuin_id" &) >/dev/null 2>&1
  fi
  return $code
}
`

export const SHELLS = { fish, zsh } as const
export type Shell = keyof typeof SHELLS

export function isShell(name: string): name is Shell {
  return Object.hasOwn(SHELLS, name)
}
