//! Per-instance identity constants. Switches values when built with the
//! `dev-instance` Cargo feature so a dev build can coexist with a prod
//! install on the same machine without sharing state, ports, or hook
//! script paths.

/// Filesystem namespace used in `~/.config/<NAMESPACE>/` and
/// `~/.<NAMESPACE>/hooks/<agent>-hook`. Picked so prod and dev never share
/// a config dir or hook-script path.
#[cfg(feature = "dev-instance")]
pub const NAMESPACE: &str = "agent-terminal-dev";
#[cfg(not(feature = "dev-instance"))]
pub const NAMESPACE: &str = "agent-terminal";

/// Port the hook HTTP server binds to. Different per instance so two running
/// instances don't fight for one port and so each instance only receives
/// hooks fired by its own spawned shells (the per-instance hook script bakes
/// this port into the curl URL).
#[cfg(feature = "dev-instance")]
pub const HOOK_PORT: u16 = 47385;
#[cfg(not(feature = "dev-instance"))]
pub const HOOK_PORT: u16 = 47384;
