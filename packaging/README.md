# Publishing Agent Terminal on Linux

The tag-triggered release workflow builds x86-64 AppImage, Debian, RPM and
Snap artifacts along with the macOS builds and attaches them to the same
draft GitHub release. The tag must match `tauri.conf.json`'s version. Publishing
that draft triggers `.github/workflows/linux-publish.yml` for stable releases.
It independently publishes the Snap and AUR package when their repository
variables are enabled. Prereleases are not published. This workflow must be
merged into the repository's default branch before release-published events
can trigger it.

## Account setup

1. Register the name `agent-terminal` in your Snap Store publisher account.
   A terminal needs access to host binaries and files, so this recipe uses
   classic confinement. The Store must approve classic confinement before it
   can be distributed. Installation will require
   `sudo snap install agent-terminal --classic`.
2. Create an AUR account, register a dedicated SSH public key, and ensure the
   `agent-terminal-bin` package name is available to your account. Users can
   install it with `yay -S agent-terminal-bin`. The `-bin` package uses the
   released Debian artifact and checks its SHA-256 before packaging.

   **AUR registration is closed upstream at the time of writing.** Arch
   disabled new account creation in June 2026 during an [active malicious
   packages incident](https://archlinux.org/news/active-aur-malicious-packages-incident/)
   and has announced no reopening date. Leave `PUBLISH_AUR` unset until it
   reopens: the AUR job is skipped and nothing else in the Linux release
   depends on it. If AUR is wanted sooner, an existing AUR maintainer can
   create and co-maintain `agent-terminal-bin`, which needs no new account.
3. Add the following GitHub Actions secrets and variables under repository
   Settings → Secrets and variables → Actions. Do not commit credentials.

| Secret | Value |
| --- | --- |
| `SNAPCRAFT_STORE_CREDENTIALS` | Exported Snapcraft login restricted to this snap. |
| `AUR_SSH_PRIVATE_KEY` | Dedicated private SSH key registered with the AUR account. |
| `AUR_KNOWN_HOSTS` | Verified `aur.archlinux.org` SSH host-key entries. Verify fingerprints against the official AUR documentation. |

| Variable | Value |
| --- | --- |
| `PUBLISH_SNAP` | `true` enables Snap publishing after a stable GitHub release is published. |
| `PUBLISH_AUR` | `true` enables AUR publishing after a stable GitHub release is published. |
| `AUR_MAINTAINER` | Public AUR maintainer name and Git author name. |
| `AUR_GIT_EMAIL` | Public Git author email for AUR commits. |

Generate a restricted Snap credential locally and upload it as a secret:

```sh
snapcraft export-login --snaps=agent-terminal --channels=stable --acls=package_access,package_push,package_update,package_release snap-login.txt
gh secret set SNAPCRAFT_STORE_CREDENTIALS < snap-login.txt
```

Upload the AUR private key and verified host-key file without printing them:

```sh
gh secret set AUR_SSH_PRIVATE_KEY < /path/to/aur-private-key
gh secret set AUR_KNOWN_HOSTS < /path/to/verified-aur-known-hosts
```

Leave publishing variables unset until accounts, permissions, and package
testing are ready. The build does not require Store credentials. Before enabling
publishing, test the built Snap on Ubuntu with `sudo snap install --dangerous
--classic ./agent-terminal_*.snap` and verify shell startup, host commands,
project files, and desktop launch. The AUR job generates `.SRCINFO` with
`makepkg`, builds the package, then pushes PKGBUILD, `.SRCINFO`, and LICENSE;
it does nothing if the package metadata is unchanged. Failed publishing jobs
can be retried after fixing the credentials or Store approval.

References: [Snap Store publication](https://snapcraft.io/docs/releasing-your-app/),
[Snap publish action](https://github.com/snapcore/action-publish), and
[AUR submission guidelines](https://wiki.archlinux.org/title/AUR_submission_guidelines).
