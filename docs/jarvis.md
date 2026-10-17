# Jarvis provider usage

Open **Jarvis** in the desktop status bar, choose **Settings**, enable Jarvis,
and select your providers. Sources stay off until selected. Settings are saved
in `~/.config/agent-terminal/jarvis.json` (`agent-terminal-dev` for dev builds).

Hover or focus the status-bar Jarvis button for a compact provider strip. Each
gauge has an outer weekly arc and an inner dotted hourly/session arc, both
showing allowance remaining. Unknown windows stay empty with a dash. Installed
or selected agents appear side by side; additional agents wrap into rows.
Click the button to open details and settings.

The terminal status bar follows the agent detected in the active tab. Codex,
Claude Code and OpenCode each show their own remaining allowance or account
status, and their provider appears first in the hover strip and usage dialog.
Switching tabs or projects updates this immediately. Shell tabs keep the overall
usage summary. This changes presentation; provider usage access still follows
your saved settings.

Jarvis reports account quotas returned by providers. These can include activity
on other devices. It does not measure GPU usage, scan token history, or estimate
model spending. Missing data is shown as unavailable, never as zero usage.

The terminal dialog stacks provider cards vertically, with provider names and
status above quota readings. Dot meters accompany larger percentages;
reset times sit beneath each reading and capture age appears in the card footer.
A compact notice highlights low remaining quota. Settings separate controls
from provider choices. The tray uses the same cards in a compact stacked layout.
Stale readings remain explicitly labeled.

| Agent | Usage source | Reported limits |
| --- | --- | --- |
| Codex | `$CODEX_HOME/auth.json`, default `~/.codex/auth.json` | Session, weekly, and reported model-specific windows |
| Claude Code | `$CLAUDE_CONFIG_DIR/.credentials.json`, default `~/.claude/.credentials.json`; existing authorized macOS `Claude Code-credentials` Keychain item | Session, weekly, Sonnet and Opus windows when reported |
| OpenCode | `$XDG_DATA_HOME/opencode/auth.json`, default `~/.local/share/opencode/auth.json`; `OPENCODE_API_KEY` | OpenCode Go rolling, weekly, monthly quotas |
| Amp | Installed `amp usage` command | Free and subscription allowances |
| Kilo | `$XDG_DATA_HOME/kilo/auth.json`, default `~/.local/share/kilo/auth.json`; `KILO_API_KEY` | Kilo Pass allowance |
| Kimi | `$KIMI_CODE_HOME/credentials/kimi-code.json`, default `~/.kimi-code/credentials/kimi-code.json`; `KIMI_CODE_API_KEY` | Kimi Code session, weekly and monthly windows when reported |
| Mastra | Local executable detection | No shared Mastra quota source; usage belongs to the configured model provider |

OpenCode agents configured with other model providers need that provider's own
usage source. Jarvis tries OpenCode's environment key and saved Go/Zen API keys
against its own usage endpoint; an expired or unentitled key can fall back to
another saved key. A `403 EntitlementError` means that key has no Go subscription
quota and is shown as unavailable, rather than asking you to sign in again.
Zen pay-as-you-go credits cannot produce weekly or hourly quota percentages.
Refreshing rereads credentials, including keys changed after login.
Kilo accounts without Kilo Pass may have a credit balance but no
quota. Amp can omit reset timestamps; Jarvis keeps those resets unknown.
For Kimi CLI sessions, the CLI must have initialized `device_id`; CLI credentials
are reused only against the default China Code endpoint. Provider home overrides
must be absolute paths. Environment keys must be available to the desktop process.

Credentials are read only for enabled providers and are never saved by Jarvis or
sent to the frontend. HTTPS requests use fixed provider hosts, refuse redirects,
and have bounded responses and timeouts. Jarvis does not import browser cookies
or refresh/write CLI credentials. Open the provider CLI to renew an expired login,
then click **Refresh**. Background macOS Keychain reads skip items requiring
authentication. If Claude Code access is unavailable, click **Authorize Keychain
access** in its usage card to request access through the native macOS prompt.
Allow persistent access there to keep background refreshes silent. Jarvis never
prompts for Keychain access automatically.

Refresh defaults to five minutes. Manual, one-minute and fifteen-minute modes
are also available. Concurrent manual clicks are coalesced, with at least fifteen
seconds between refresh rounds. Temporary errors preserve a last-known reading
only when the current credential fingerprint matches the reading's owner. Amp
CLI readings have no independently verified owner, so they are cleared on failure.
Last-known readings keep their original capture time and do not drive a live meter.
Usage snapshots stay in memory; settings persist across restarts.

## Installed agents

Jarvis detects supported coding-agent executables at startup and every minute,
including when usage collection is disabled. **Rescan** in Settings updates this
list immediately. Installed agents appear first. Installation status is separate
from account status: an installed agent may still need sign-in, and an existing
account session may report usage without a CLI executable present.

Discovery checks the app's PATH and common native, Homebrew, npm, Bun, Cargo,
Volta, mise, asdf, NVM, FNM and Windows user installation locations. It does not
launch shells or agents, inspect credentials, or treat old configuration folders
as proof of installation. **Not found** means no executable was found in those
locations; custom installations should be added to the desktop process's PATH.
Usage access still requires enabling Jarvis and selecting providers.

## Native indicators

Enable **Show in menu bar / system tray** for a macOS menu bar meter or a Linux
application indicator. The meter shows the remaining percentage of the most
constrained current quota. On macOS, hover for a compact quota panel; click to
keep it open for keyboard navigation. Move away to dismiss a hover panel, or
press Escape, click the close button, or click outside a pinned panel to dismiss
it. The panel shares the app's theme and quota cards and updates from the same
in-memory snapshot. Viewing usage and refreshing never opens the main app.
**Sign-in help**, **View details**, and **Settings** open Agent Terminal.

The native menu shows quota meters, resets, capture age, Refresh, Settings and
Quit directly, without provider submenus. **Jarvis · Usage overview** opens the
same compact panel on Linux. Provider rows needing attention are clickable and
open Agent Terminal for help. With a usable native indicator enabled,
closing the window hides it and leaves terminal sessions running. Disabling the
indicator restores a hidden window; **Quit Agent Terminal** exits the app.

Linux AppIndicator does not expose hover events or tooltips to Tauri, so usage
is available in the native tray menu and its **Usage overview** panel. Linux
tray visibility depends on the desktop shell. GNOME may need an
AppIndicator extension; the in-app Jarvis panel works without one. Jarvis checks
for a registered desktop indicator host through D-Bus in the background. A
missing host or failure to create the indicator is shown in the panel and
preserves ordinary window closing behavior. If the host disappears while the
window is hidden through Jarvis, Jarvis restores that window. Host availability
is checked every five seconds, including in Manual usage-refresh mode, so bar
restarts recover automatically. Menu text updates preserve the existing native
menu where possible, and the icon is rewritten only when its appearance changes.

On Linux, **Usage overview** opens a decorated, resizable window managed by the
desktop compositor. Close it with its window controls, Escape, or the panel's
close button. It stays open when another window receives focus. Wayland does not
provide the global cursor coordinates needed for macOS-style anchored popovers;
Linux quick views therefore do not depend on cursor placement or hover events.

### Arch / Hyprland / illogical-impulse

Jarvis uses the StatusNotifier tray provided by your bar (for example Quickshell
or Waybar). The bar must have its tray enabled. The GTK backend requires an
AppIndicator library, such as `libayatana-appindicator` or `libappindicator`, plus
GTK 3 and WebKitGTK 4.1. Existing illogical-impulse settings need no Jarvis-specific
window rules. To check the running host without changing desktop configuration:

```sh
busctl --user get-property org.kde.StatusNotifierWatcher /StatusNotifierWatcher org.kde.StatusNotifierWatcher IsStatusNotifierHostRegistered
```

`b true` means a host is registered. If no watcher exists, start or enable your
bar's tray. Arch should use the AppImage or a native Arch build rather than the
Debian package. See [Tauri's Linux tray limitations](https://v2.tauri.app/learn/system-tray/#listen-to-tray-events)
and [Linux dependencies](https://v2.tauri.app/start/prerequisites/#linux).

Linux x86_64 releases include Debian and AppImage bundles. Build on Linux with
`bun run tauri:build`; Tauri automatically merges `tauri.linux.conf.json`. Build
prerequisites include WebKitGTK 4.1, GTK 3 and Ayatana AppIndicator development
packages, as listed in the CI workflow. Debian bundles depend on
`libayatana-appindicator3-1`. The release workflow keeps macOS and Linux artifacts
in a draft release and includes signed AppImage payloads in the updater manifest.

## Code structure

The Rust `usage` module owns preferences, executable discovery, credentials, provider adapters,
collection scheduling, native tray rendering and popover window lifecycle.
The tray renderer runs through `#jarvis-tray`, subscribes only to usage, and
shares quota cards with the main dialog. Its capability grants only event
subscriptions; it does not bootstrap terminal, mod or WSS listeners. Hover
creation is delayed, pointer tracking runs only while a hover panel is visible,
and the panel is destroyed when the indicator becomes unavailable or disabled.
It is independent of the PTY mod engine and mobile WSS protocol. React receives normalized usage DTOs through
`jarvis_snapshot`, `jarvis_refresh`, `jarvis_rescan_agents`, `jarvis_set_preferences`, the explicit
`jarvis_authorize_claude_keychain` action and
`jarvis:updated`; `jarvis:open` opens the panel from native menu actions.
The compact tray panel uses `jarvis_open_main` for help/settings and
`jarvis_dismiss_tray` for dismissal. Window positioning, hover delays, focus and
tray availability remain in Rust.

Add providers to the usage registry and supply an adapter with fixture tests.
Avoid deriving quotas from installed agent names or command-line model flags.
Provider response formats can change: treat unknown schemas as unavailable and
test against new source fixtures before updating an adapter.

The integration uses these reference contracts, with independent Rust parsers:
[Codex](https://github.com/steipete/CodexBar/blob/main/docs/codex.md),
[Claude](https://github.com/steipete/CodexBar/blob/main/docs/claude.md),
[OpenCode](https://github.com/steipete/CodexBar/blob/main/docs/opencode.md),
[Amp](https://github.com/steipete/CodexBar/blob/main/docs/amp.md),
[Kilo](https://github.com/steipete/CodexBar/blob/main/docs/kilo.md), and
[Kimi](https://github.com/steipete/CodexBar/blob/main/docs/kimi.md).
