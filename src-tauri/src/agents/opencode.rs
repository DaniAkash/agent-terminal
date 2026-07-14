//! opencode agent profile.
//!
//! opencode runs under a JS runtime, so identity walks argv (`runtime_wrapped`).
//! It emits no OSC state, so it is a hooks + floor agent. Its hook is a JS
//! plugin installed into `~/.config/opencode/plugin/`; the plugin asset and
//! event mapping are wired in the hook-install step.

use super::AgentProfile;

pub static PROFILE: AgentProfile = AgentProfile {
    id: "opencode",
    display_name: "opencode",
    process_names: &["opencode"],
    runtime_wrapped: true,
    hook: None,
    osc: None,
};
