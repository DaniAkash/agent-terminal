//! Agent Terminal shell integration scripts.
//!
//! These scripts are written to `~/.config/<NAMESPACE>/` (see `identity::NAMESPACE`
//! — `agent-terminal` for prod builds, `agent-terminal-dev` for dev builds) on
//! first launch and injected into each new PTY session via ZDOTDIR (zsh) or
//! --init-file (bash). They emit OSC 7 (cwd) and OSC 133 (shell marks) sequences
//! that the MOD engine parses to track directories and process lifecycle.

// zsh dotfile load order (login shell):
//   /etc/zshenv → $ZDOTDIR/.zshenv → /etc/zprofile → $ZDOTDIR/.zprofile →
//   /etc/zshrc → $ZDOTDIR/.zshrc → /etc/zlogin → $ZDOTDIR/.zlogin
//
// We redirect ZDOTDIR to ~/.config/<NAMESPACE>/zsh/, which means by default
// zsh would NOT load the user's real .zshenv / .zprofile / .zshrc. We supply
// shim files in our ZDOTDIR that source the user's real ones — otherwise PATH
// (set in .zshenv / .zprofile / via Homebrew's path_helper) is missing in
// production GUI launches where launchd starts the app with a minimal env.

const ZSH_ZSHENV_SHIM: &str = r#"# Agent Terminal — load the user's real .zshenv if present
export ZDOTDIR_ORIG="${ZDOTDIR_ORIG:-$HOME}"
[[ -f "$ZDOTDIR_ORIG/.zshenv" ]] && source "$ZDOTDIR_ORIG/.zshenv"
"#;

const ZSH_ZPROFILE_SHIM: &str = r#"# Agent Terminal — load the user's real .zprofile if present
export ZDOTDIR_ORIG="${ZDOTDIR_ORIG:-$HOME}"
[[ -f "$ZDOTDIR_ORIG/.zprofile" ]] && source "$ZDOTDIR_ORIG/.zprofile"
"#;

const ZSH_SCRIPT: &str = r#"# Agent Terminal shell integration
# Source the user's real .zshrc first
export ZDOTDIR_ORIG="${ZDOTDIR_ORIG:-$HOME}"
[[ -f "$ZDOTDIR_ORIG/.zshrc" ]] && source "$ZDOTDIR_ORIG/.zshrc"

# OSC 7 — emit cwd on every prompt
_at_osc7() { printf '\033]7;file://%s%s\007' "${HOST:-localhost}" "$PWD"; }

# OSC 133 — shell integration marks
_at_osc133_exit() { printf '\033]133;D;%s\007' "$?"; }
_at_osc133_prompt() { printf '\033]133;A\007'; }
_at_osc133_preexec() { printf '\033]133;B\007'; }

# `clear` erases the scrollback before it erases the screen. With a prompt
# mark on screen the screen erase scrolls into scrollback rather than wiping
# it, so the scrollback comes straight back holding the screen that was just
# cleared. Erasing the scrollback last leaves nothing behind.
clear() {
  if (( $# )); then command clear "$@"; return; fi
  printf '\033[H\033[2J\033[3J'
}

precmd_functions=(_at_osc133_exit _at_osc7 _at_osc133_prompt ${precmd_functions[@]})
preexec_functions=(_at_osc133_preexec ${preexec_functions[@]})
"#;

const BASH_SCRIPT: &str = r#"# Agent Terminal shell integration
[[ -f "$HOME/.bashrc" ]] && source "$HOME/.bashrc"

_at_osc7() { printf '\033]7;file://%s%s\007' "${HOSTNAME:-localhost}" "$PWD"; }
_at_osc133_exit() { printf '\033]133;D;%s\007' "$?"; }
_at_osc133_prompt() { printf '\033]133;A\007'; }
_at_osc133_preexec() { printf '\033]133;B\007'; }

# `clear` erases the scrollback before it erases the screen. With a prompt
# mark on screen the screen erase scrolls into scrollback rather than wiping
# it, so the scrollback comes straight back holding the screen that was just
# cleared. Erasing the scrollback last leaves nothing behind.
clear() {
  if (( $# )); then command clear "$@"; return; fi
  printf '\033[H\033[2J\033[3J'
}

PROMPT_COMMAND="_at_osc133_exit; _at_osc7; _at_osc133_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
trap '_at_osc133_preexec' DEBUG
"#;

// Loaded with fish --init-command after fish has read its normal configuration.
const FISH_SCRIPT: &str = r#"# Agent Terminal shell integration
function __at_prompt --on-event fish_prompt
    set -l previous_status $status
    printf '\033]133;D;%s\007' $previous_status
    printf '\033]7;file://localhost%s\007' (string escape --style=url -- $PWD | string replace -a '%2F' '/')
    printf '\033]133;A\007'
    return $previous_status
end
function __at_preexec --on-event fish_preexec
    printf '\033]133;B\007'
end
"#;

/// Write shell integration scripts to `~/.config/<NAMESPACE>/`.
///
/// This is called once at application startup. If it fails (e.g. the directory
/// can't be created), the error is logged but the app continues — shell
/// integration is best-effort.
pub fn setup_shell_integration() -> Result<(), String> {
    let config_dir = dirs::home_dir()
        .ok_or_else(|| "cannot determine home directory".to_string())?
        .join(".config")
        .join(crate::identity::NAMESPACE);

    // zsh: ZDOTDIR points to this directory. We write shims for .zshenv,
    // .zprofile, .zshrc — each sources the user's real file if present.
    // This is critical in production GUI launches: launchd starts agent-terminal
    // with a minimal environment (no Homebrew/fnm PATH, etc.), and PATH is
    // typically set in .zshenv / .zprofile rather than .zshrc.
    let zsh_dir = config_dir.join("zsh");
    std::fs::create_dir_all(&zsh_dir)
        .map_err(|e| format!("failed to create zsh config dir: {e}"))?;
    std::fs::write(zsh_dir.join(".zshenv"), ZSH_ZSHENV_SHIM)
        .map_err(|e| format!("failed to write zsh .zshenv shim: {e}"))?;
    std::fs::write(zsh_dir.join(".zprofile"), ZSH_ZPROFILE_SHIM)
        .map_err(|e| format!("failed to write zsh .zprofile shim: {e}"))?;
    std::fs::write(zsh_dir.join(".zshrc"), ZSH_SCRIPT)
        .map_err(|e| format!("failed to write zsh integration script: {e}"))?;

    // bash: sourced via --init-file
    std::fs::write(config_dir.join("bash-integration.bash"), BASH_SCRIPT)
        .map_err(|e| format!("failed to write bash integration script: {e}"))?;

    std::fs::write(config_dir.join("fish-integration.fish"), FISH_SCRIPT)
        .map_err(|e| format!("failed to write fish integration script: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{BASH_SCRIPT, FISH_SCRIPT, ZSH_SCRIPT};

    #[test]
    fn fish_emits_marks_and_preserves_user_handlers() {
        if std::process::Command::new("fish").arg("--version").output().is_err() {
            return;
        }
        let script = format!("{FISH_SCRIPT}\nfunction user_handler --on-event fish_preexec; echo USER_HANDLER; end\nemit fish_preexec test\nfalse\nemit fish_prompt\n");
        let output = std::process::Command::new("fish").arg("-c").arg(script).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("USER_HANDLER"));
        assert!(stdout.contains("\u{1b}]133;B\u{7}"));
        assert!(stdout.contains("\u{1b}]133;D;1\u{7}"));
        assert!(stdout.contains("\u{1b}]7;file://"));
        assert!(stdout.contains("\u{1b}]133;A\u{7}"));
    }

    /// The scrollback erase has to come after the screen erase. A prompt mark
    /// on screen turns the screen erase into a scroll into scrollback, so the
    /// conventional order refills the scrollback it just emptied.
    #[test]
    fn clear_erases_the_scrollback_last() {
        for script in [ZSH_SCRIPT, BASH_SCRIPT] {
            let body = script
                .split_once("clear() {")
                .expect("script defines a clear wrapper")
                .1;
            let sequence = body
                .split_once("printf '")
                .expect("wrapper printfs a sequence")
                .1
                .split_once('\'')
                .expect("sequence is quoted")
                .0;
            assert_eq!(sequence, r"\033[H\033[2J\033[3J");
            assert!(body.contains(r#"command clear "$@""#));
        }
    }
}
