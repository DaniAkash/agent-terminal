<script lang="ts">
import { ArrowDown, ArrowUpRight } from 'phosphor-svelte'
import type { PageData } from './$types'

let { data }: { data: PageData } = $props()
const releases = 'https://github.com/DaniAkash/agent-terminal/releases/latest'
const options = [
  {
    platform: 'macOS',
    status: 'STABLE',
    label: 'Apple Silicon',
    detail: 'M1, M2, M3 and newer · DMG',
    patterns: [/^agent-terminal-aarch64\.dmg$/i, /_aarch64\.dmg$/i],
  },
  {
    platform: 'macOS',
    status: 'STABLE',
    label: 'Intel Mac',
    detail: 'Intel x86-64 · DMG',
    patterns: [/^agent-terminal-x64\.dmg$/i, /_x64\.dmg$/i],
  },
  {
    platform: 'Linux',
    status: 'EXPERIMENTAL',
    label: 'AppImage',
    detail: 'x86-64 · portable download',
    patterns: [/^agent-terminal-amd64\.appimage$/i, /_amd64\.appimage$/i],
  },
  {
    platform: 'Linux',
    status: 'EXPERIMENTAL',
    label: 'Debian / Ubuntu',
    detail: 'x86-64 · DEB package',
    patterns: [
      /^agent-terminal-amd64\.deb$/i,
      /^agent-terminal_[\w.-]+_amd64\.deb$/i,
    ],
  },
  {
    platform: 'Linux',
    status: 'EXPERIMENTAL',
    label: 'Fedora and RPM',
    detail: 'x86-64 · RPM package',
    patterns: [/^agent-terminal-x86_64\.rpm$/i, /\.x86_64\.rpm$/i],
  },
  {
    platform: 'Linux',
    status: 'EXPERIMENTAL',
    label: 'Snap package',
    detail: 'x86-64 · local installation',
    patterns: [/^agent-terminal_[\w.-]+_amd64\.snap$/i],
  },
]
function asset(patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = data.release?.assets.find((item) => pattern.test(item.name))
    if (match) return match
  }
  return undefined
}
</script>

<main class="downloads wrap">
  <div class="downloads-heading">
    <div class="section-kicker">GET AGENT TERMINAL / 01</div>
    <h1>Find your<br><em>starting point.</em></h1>
    <p>
      Download Agent Terminal for macOS or Linux and bring your coding agents,
      projects, and terminal sessions together.
    </p>
    <div class="release-line">
      <span class="release-dot"></span>
      {#if data.release}
        LATEST STABLE RELEASE <strong>{data.release.version}</strong>
      {:else}
        RELEASE INFORMATION UNAVAILABLE ·
        <a href={releases}>VIEW ON GITHUB <ArrowUpRight size={14} /></a>
      {/if}
    </div>
  </div>

  <section aria-labelledby="builds-heading" class="builds">
    <div class="builds-heading">
      <div>
        <div class="section-kicker">CHOOSE YOUR BUILD / 02</div>
        <h2 id="builds-heading">Your machine, your terminal.</h2>
      </div>
      <p>Official downloads from the latest stable GitHub release.</p>
    </div>
    <div class="build-list">
      {#each options as option}
        {@const file = asset(option.patterns)}
        <div
          class="build-row"
          id={option.label === 'Apple Silicon'
            ? 'macos'
            : option.label === 'AppImage'
              ? 'linux'
              : undefined}
        >
          <div class="build-platform">
            <span>{option.platform}</span><small>{option.status}</small>
          </div>
          <div class="build-name">
            <h3>{option.label}</h3>
            <p>{option.detail}</p>
          </div>
          {#if file}
            <a
              class="build-link"
              href={file.browser_download_url}
              aria-label={`Download ${option.label} for ${option.platform}`}
              >Download <ArrowDown size={16} /></a
            >
          {:else}
            <a class="build-link muted" href={releases}
              >View releases <ArrowUpRight size={16} /></a
            >
          {/if}
        </div>
      {/each}
      <div class="build-row">
        <div class="build-platform">
          <span>Mobile</span><small>COMPANION</small>
        </div>
        <div class="build-name">
          <h3>Android</h3>
          <p>Pair with your desktop · Google Play</p>
        </div>
        <a
          class="build-link"
          href="https://play.google.com/store/apps/details?id=com.daniakash.agent_terminal"
          >Google Play <ArrowUpRight size={16} /></a
        >
      </div>
    </div>
    {#if data.release}
      <p class="download-note">
        A link appears when that package is included in {data.release.version}.
        <a href={releases}>View all release files on GitHub ↗</a>
      </p>
    {:else}
      <p class="download-note">
        We couldn’t load the release from GitHub. Use the links above to find
        available files directly.
      </p>
    {/if}
  </section>

  <section class="getting-started" aria-labelledby="getting-started-heading">
    <div>
      <div class="section-kicker">BEFORE YOU BEGIN / 03</div>
      <h2 id="getting-started-heading">A little more<br><em>to know.</em></h2>
    </div>
    <div class="getting-copy">
      <div>
        <h3>macOS</h3>
        <p>
          Agent Terminal is stable on macOS 13 and later. You can also install
          it with Homebrew:
        </p>
        <code>brew install --cask daniakash/tap/agent-terminal</code>
      </div>
      <div>
        <h3>Linux is experimental</h3>
        <p>
          Linux x86-64 packages are available for testing. Choose an AppImage,
          Debian or RPM package for your distribution. The Snap file is for
          local installation; Store availability depends on approval.
        </p>
        <p>
          Launch your account’s default shell and install your preferred coding
          agent separately.
          <a href="/docs#installation">Read the installation guide ↗</a>
        </p>
        <p>
          For an AppImage, make the downloaded file executable before opening it
          (replace the filename below with the one you downloaded):
        </p>
        <code>chmod +x ./your-downloaded-file.AppImage</code>
      </div>
      <div>
        <h3>Looking for another platform?</h3>
        <p>
          The iOS companion is coming soon, and Windows support needs
          contributors. Find earlier releases and additional files on
          <a href="https://github.com/DaniAkash/agent-terminal/releases"
            >GitHub Releases ↗</a
          >.
        </p>
      </div>
    </div>
  </section>
</main>

<style>
.downloads {
  padding-top: 150px;
  padding-bottom: 130px;
}
.downloads-heading {
  max-width: 850px;
  padding-bottom: 90px;
}
.downloads h1 {
  font-size: clamp(48px, 6.5vw, 86px);
  line-height: 1.02;
  margin: 28px 0;
}
.downloads h1 em,
.downloads h2 em {
  font-style: normal;
  color: #797c74;
}
.downloads-heading > p {
  max-width: 550px;
  color: #aaa;
  font-size: 1.15rem;
  line-height: 1.7;
}
.release-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 32px;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  color: #999;
}
.release-line strong {
  color: #eee;
}
.release-line a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #eee;
}
.release-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e78a51;
}
.builds {
  border-top: 1px solid #383838;
  padding-top: 36px;
}
.builds-heading {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 24px;
  margin-bottom: 32px;
}
.downloads h2 {
  font-size: clamp(2rem, 4vw, 3.5rem);
  letter-spacing: -0.045em;
  line-height: 1.1;
  margin: 18px 0 0;
}
.builds-heading > p,
.download-note {
  color: #999;
  font-size: 0.9rem;
  line-height: 1.6;
}
.build-list {
  border-top: 1px solid #383838;
}
.build-row {
  display: grid;
  grid-template-columns: 1fr 2fr auto;
  gap: 24px;
  align-items: center;
  padding: 25px 0;
  border-bottom: 1px solid #383838;
}
.build-platform {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.9rem;
}
.build-platform small {
  color: #aaa;
  font-size: 0.62rem;
  letter-spacing: 0.1em;
}
.build-name h3,
.getting-copy h3 {
  margin: 0;
  font-size: 1.1rem;
}
.build-name p {
  margin: 6px 0 0;
  color: #999;
  font-size: 0.85rem;
}
.build-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-width: 144px;
  padding: 12px 15px;
  border: 1px solid #666;
  color: #fff;
  font-size: 0.85rem;
  text-decoration: none;
}
.build-link:hover,
.build-link:focus-visible {
  background: #eee;
  color: #111;
}
.muted {
  color: #ccc;
}
.download-note a,
.getting-copy a {
  color: #eee;
  text-underline-offset: 3px;
}
.getting-started {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 60px;
  border-top: 1px solid #383838;
  margin-top: 110px;
  padding-top: 36px;
}
.getting-copy {
  display: grid;
  gap: 32px;
}
.getting-copy p {
  color: #aaa;
  line-height: 1.7;
}
.getting-copy code {
  display: block;
  overflow-x: auto;
  border: 1px solid #383838;
  padding: 16px;
  font-size: 0.83rem;
}
@media (max-width: 700px) {
  .downloads {
    padding-top: 110px;
    padding-bottom: 80px;
  }
  .downloads-heading {
    padding-bottom: 60px;
  }
  .builds-heading {
    display: block;
  }
  .build-row {
    grid-template-columns: 1fr auto;
    gap: 14px;
  }
  .build-platform {
    grid-column: 1 / -1;
    flex-direction: row;
    align-items: center;
  }
  .build-link {
    min-width: 120px;
  }
  .getting-started {
    grid-template-columns: 1fr;
    gap: 35px;
    margin-top: 75px;
  }
}
</style>
