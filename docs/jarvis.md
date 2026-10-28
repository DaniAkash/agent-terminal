# Jarvis provider usage

Open **Jarvis** in the desktop status bar, choose **Settings**, enable Jarvis,
and select your providers. Sources stay off until selected. Settings are saved
in `~/.config/agent-terminal/jarvis.json` (`agent-terminal-dev` for dev builds).

Hover or focus the status-bar Jarvis button for a compact provider strip. Each
gauge has an outer weekly arc and an inner dotted hourly/session arc, both
showing allowance remaining. Unknown windows stay empty with a dash. Installed
or selected agents appear side by side; additional agents wrap into rows.
Click the button to open details and settings.

The terminal status bar follows the agent detected in the active tab and shows
its hourly/session allowance remaining. Weekly limits stay in the hover panel
and usage dialog. When no hourly/session limit is reported, the status bar shows
the provider's account status rather than substituting a weekly limit. Codex,
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
from provider choices. Stale readings remain explicitly labeled.

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

## Code structure

The Rust `usage` module owns preferences, executable discovery, credentials,
provider adapters and collection scheduling. It is independent of the PTY mod
engine and mobile WSS protocol. React receives normalized usage DTOs through
`jarvis_snapshot`, `jarvis_refresh`, `jarvis_rescan_agents`,
`jarvis_set_preferences`, the explicit `jarvis_authorize_claude_keychain` action
and `jarvis:updated`. The frontend separates IPC and state from presentation in
`modules/jarvis` and `components/Jarvis`.

Add providers to the usage registry and supply an adapter with fixture tests.
Avoid deriving quotas from installed agent names or command-line model flags.
Provider response formats can change: treat unknown schemas as unavailable and
test against new source fixtures before updating an adapter.

Codex and Claude quota responses are collected with `agentstat` 0.1.1;
Jarvis continues to own credential access and refresh scheduling. OpenCode Go
uses the Jarvis collector to retain support for partial quota responses and
entitlement-specific errors. Other providers also use Jarvis collectors. The integration uses these reference contracts:
[Codex](https://github.com/steipete/CodexBar/blob/main/docs/codex.md),
[Claude](https://github.com/steipete/CodexBar/blob/main/docs/claude.md),
[OpenCode](https://github.com/steipete/CodexBar/blob/main/docs/opencode.md),
[Amp](https://github.com/steipete/CodexBar/blob/main/docs/amp.md),
[Kilo](https://github.com/steipete/CodexBar/blob/main/docs/kilo.md), and
[Kimi](https://github.com/steipete/CodexBar/blob/main/docs/kimi.md).
