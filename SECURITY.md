# Security Policy

## Supported versions

Agent Terminal is pre-1.0 and moves fast. Only the most recent release of each component gets security fixes; older tags are not patched, so upgrading is the fix path.

| Component | Tag prefix | Supported |
| --- | --- | --- |
| Desktop app | `v*` | Latest release only |
| Companion app (Android) | `companion-v*` | Latest release only |

## Reporting a vulnerability

Report privately through GitHub, never in a public issue, discussion, or pull request. Open [a new draft advisory](https://github.com/DaniAkash/agent-terminal/security/advisories/new) and the report stays visible only to you and the maintainers until a fix ships.

A useful report says which version you tested, what an attacker gains, and the shortest set of steps that reproduces it. A proof of concept helps but is not required.

## What to expect

You should get an acknowledgement within 3 working days, and an assessment with a rough fix timeline within 10. Fixes ship in the next release of the affected component, and the advisory is published alongside it.

You will be credited in the advisory unless you ask not to be. Please hold off on disclosing publicly until that advisory is out.

## Scope

In scope: the desktop app, the companion Android app, the sidecar, and the release and build workflows in this repository.

Out of scope: vulnerabilities in third party dependencies that are already public and have an upstream fix (open a normal issue instead), findings that need an attacker to already control the machine running the app, and reports produced by a scanner with no demonstrated impact.
