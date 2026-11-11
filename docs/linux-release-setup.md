# Linux release setup

Configure the Snap Store and Arch User Repository (AUR) publishers for Agent Terminal.

Keep credentials private. Do not paste them into issues, pull requests, terminal screenshots, or this repository. The Snap and AUR workflows stay disabled until their repository variables are enabled.

## 1. How the release works

- Merge the release workflows into the repository's default branch. GitHub runs release-published workflows from that branch.
- Set the matching version in the desktop package, the Tauri configuration and the Rust package, then push the corresponding `vX.Y.Z` tag.
- GitHub Actions builds the Linux and macOS artifacts and creates a draft release. Review and test the artifacts before publishing the draft.
- When a stable release is published, the separate Linux publishing workflow runs whichever publishers are enabled. Prereleases are excluded.

After a successful publication, installation is `yay -S agent-terminal-bin` and `sudo snap install agent-terminal --classic`.

## 2. Register the Snap and request classic confinement

- Sign in to the Snap Store with the intended publisher account and register `agent-terminal`. The name has to be available to that account.
- Request classic confinement approval, explaining that the terminal runs host shells and tools and accesses project files. Wait for Store approval before enabling publishing.
- Install Snapcraft, sign in locally with `snapcraft login`, and export a credential restricted to this package and the stable channel:

```sh
snapcraft export-login --snaps=agent-terminal --channels=stable \
  --acls=package_access,package_push,package_update,package_release \
  snap-login.txt
```

Add the entire contents of `snap-login.txt` to the repository secret `SNAPCRAFT_STORE_CREDENTIALS`. From a secure local shell:

```sh
gh secret set SNAPCRAFT_STORE_CREDENTIALS --repo OWNER/REPO < snap-login.txt
```

Replace `OWNER/REPO` with the repository that runs the workflow. Store or delete the local credential file according to your own policy.

## 3. Set up the AUR account and SSH key

> **AUR registration is closed upstream at the time of writing.** Arch disabled new account creation in June 2026 during an [active malicious packages incident](https://archlinux.org/news/active-aur-malicious-packages-incident/) and has announced no reopening date. Until it reopens, leave `PUBLISH_AUR` unset. The AUR job is skipped and the rest of the Linux release is unaffected, so nothing here blocks shipping. The steps below are what to do once an account can be created. An alternative, if you want AUR sooner, is to ask an existing AUR maintainer to create and co-maintain `agent-terminal-bin`, which needs no new account.

- Create or sign in to an AUR account and confirm it may create or maintain `agent-terminal-bin`. The `-bin` package consumes the published Debian release asset.
- Generate a dedicated key locally. This writes a private key and a matching `.pub` file, so choose a passphrase policy that still works unattended in CI:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/agent-terminal-aur -C "agent-terminal-aur"
```

- Add the contents of `~/.ssh/agent-terminal-aur.pub` to the AUR account's SSH public keys. Never upload the private key to AUR.
- Obtain the AUR SSH host keys and verify their fingerprints independently against the official AUR authentication documentation. Save the verified `known_hosts` entries to a local file. Do not trust an unverified `ssh-keyscan` result.
- Add the private key as `AUR_SSH_PRIVATE_KEY` and the verified host key entries as `AUR_KNOWN_HOSTS`. The workflow needs a key that works non-interactively; it does not prompt for a passphrase.

```sh
gh secret set AUR_SSH_PRIVATE_KEY --repo OWNER/REPO < ~/.ssh/agent-terminal-aur
gh secret set AUR_KNOWN_HOSTS --repo OWNER/REPO < /path/to/verified-aur-known-hosts
```

## 4. Configure GitHub Actions

In GitHub, open the repository, then Settings, then Secrets and variables, then Actions. Add each secret under Secrets and each variable under Variables. Configure these on the repository that owns the release, not on a fork.

| Type | Name | Value |
| --- | --- | --- |
| Secret | `SNAPCRAFT_STORE_CREDENTIALS` | Contents of the restricted exported Snapcraft login. |
| Secret | `AUR_SSH_PRIVATE_KEY` | The dedicated AUR private key. |
| Secret | `AUR_KNOWN_HOSTS` | Independently verified AUR host key entries. |
| Variable | `AUR_MAINTAINER` | Public maintainer name used in the package and the Git commit. |
| Variable | `AUR_GIT_EMAIL` | Public email for AUR Git commits. |
| Variable | `PUBLISH_SNAP` | Set to `true` only after Snap testing and Store approval. |
| Variable | `PUBLISH_AUR` | Set to `true` only after the AUR account and key are set up. |

The workflow uses GitHub's built-in `GITHUB_TOKEN` to download release assets, so no personal access token is required. The existing macOS signing secrets are still required by the macOS jobs.

## 5. Validate and publish

- Run the Linux build and inspect the AppImage, Debian and RPM artifacts, then review the draft release's Linux artifacts and Snap.
- On a test Ubuntu system, install the generated Snap with `sudo snap install --dangerous --classic ./agent-terminal_*.snap`. Check desktop launch, shell startup, host commands, Codex, project access and notifications.
- Confirm AUR package ownership, the verified SSH host key and both AUR author variables. Review the generated `PKGBUILD` and its checksums.
- Enable only the publishers that are configured. Publish the reviewed stable GitHub release, then check Actions, then Publish Linux packages. A failed job can be retried once its configuration is corrected.
- After publication, test installation from the Store and from AUR on separate machines. Keep the previous version available for rollback.

The Snap build and Store publication need end-to-end validation. Classic confinement approval is controlled by the Snap Store: installing an unapproved local build does not grant it.
