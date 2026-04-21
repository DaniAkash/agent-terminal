//! Agent Terminal shell integration scripts.
//!
//! These scripts are written to `~/.config/agent-terminal/` on first launch and
//! injected into each new PTY session via ZDOTDIR (zsh) or --init-file (bash).
//! They emit OSC 7 (cwd) and OSC 133 (shell marks) sequences that the MOD engine
//! parses to track directories and process lifecycle.

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

precmd_functions=(_at_osc133_exit _at_osc7 _at_osc133_prompt ${precmd_functions[@]})
preexec_functions=(_at_osc133_preexec ${preexec_functions[@]})
"#;

const BASH_SCRIPT: &str = r#"# Agent Terminal shell integration
[[ -f "$HOME/.bashrc" ]] && source "$HOME/.bashrc"

_at_osc7() { printf '\033]7;file://%s%s\007' "${HOSTNAME:-localhost}" "$PWD"; }
_at_osc133_exit() { printf '\033]133;D;%s\007' "$?"; }
_at_osc133_prompt() { printf '\033]133;A\007'; }
_at_osc133_preexec() { printf '\033]133;B\007'; }

PROMPT_COMMAND="_at_osc133_exit; _at_osc7; _at_osc133_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
trap '_at_osc133_preexec' DEBUG
"#;

/// Write shell integration scripts to `~/.config/agent-terminal/`.
///
/// This is called once at application startup. If it fails (e.g. the directory
/// can't be created), the error is logged but the app continues — shell
/// integration is best-effort.
pub fn setup_shell_integration() -> Result<(), String> {
    let config_dir = dirs::home_dir()
        .ok_or_else(|| "cannot determine home directory".to_string())?
        .join(".config")
        .join("agent-terminal");

    // zsh: ZDOTDIR points to this directory, so zsh loads .zshrc from here
    let zsh_dir = config_dir.join("zsh");
    std::fs::create_dir_all(&zsh_dir)
        .map_err(|e| format!("failed to create zsh config dir: {e}"))?;
    std::fs::write(zsh_dir.join(".zshrc"), ZSH_SCRIPT)
        .map_err(|e| format!("failed to write zsh integration script: {e}"))?;

    // bash: sourced via --init-file
    std::fs::write(config_dir.join("bash-integration.bash"), BASH_SCRIPT)
        .map_err(|e| format!("failed to write bash integration script: {e}"))?;

    Ok(())
}
