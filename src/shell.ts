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
    # \`history append\` arrived in fish 4.0; older fish would treat it as a search. Writing
    # the history file directly isn't safe (fish tracks its own file offsets), so older
    # fish just runs the command and says once why it isn't in history.
    if test (string split -f1 . -- $FISH_VERSION) -ge 4
        builtin history append -- "$cmd"
    else if not set -q __hop_history_warned
        set -g __hop_history_warned 1
        printf 'hop: fish %s cannot add commands to history; upgrade to fish 4.0+ for that\\n' $FISH_VERSION >&2
    end
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
