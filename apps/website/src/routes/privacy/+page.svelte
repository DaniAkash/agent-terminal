<script lang="ts">
import { ArrowUpRight, ShieldCheck } from 'phosphor-svelte'
import { onMount } from 'svelte'
let activeSection = $state('overview')
const LAST_UPDATED = '12 November 2026'
const CONTACT_EMAIL = 'hello@daniakash.com'
const sections = [
  { label: 'Overview', id: 'overview' },
  { label: 'The short version', id: 'short-version' },
  { label: 'What stays on your device', id: 'on-device' },
  { label: 'What leaves your device', id: 'leaves-device' },
  { label: 'Phone to desktop', id: 'pairing' },
  { label: 'What the apps never do', id: 'never' },
  { label: 'Retention and deletion', id: 'retention' },
  { label: 'Children', id: 'children' },
  { label: 'Changes to this policy', id: 'changes' },
  { label: 'Contact', id: 'contact' },
]
onMount(() => {
  const updateActiveSection = () => {
    const atBottom =
      window.scrollY + window.innerHeight >=
      document.documentElement.scrollHeight - 2
    let current = sections[0].id
    for (const section of sections) {
      const element = document.getElementById(section.id)
      if (element && element.getBoundingClientRect().top <= 110)
        current = section.id
    }
    activeSection = atBottom ? sections[sections.length - 1].id : current
  }
  updateActiveSection()
  window.addEventListener('scroll', updateActiveSection, { passive: true })
  window.addEventListener('resize', updateActiveSection)
  return () => {
    window.removeEventListener('scroll', updateActiveSection)
    window.removeEventListener('resize', updateActiveSection)
  }
})
</script>
<main class="docs-page">
  <div class="docs-shell">
    <aside class="docs-sidebar">
      <div class="docs-sidebar-title"><ShieldCheck size={16} /> PRIVACY</div>
      <nav aria-label="Privacy policy sections">
        {#each sections as section}
          <a
            href={`#${section.id}`}
            aria-current={activeSection === section.id ? 'location' : undefined}
            >{section.label}</a
          >
        {/each}
      </nav>
      <a class="docs-source" href="/">← Back to home</a>
    </aside>
    <article class="docs-content">
      <header class="docs-intro" id="overview">
        <span class="docs-kicker">AGENT TERMINAL / PRIVACY POLICY</span>
        <h1>No servers.<br><span>Nothing to collect.</span></h1>
        <p>
          This policy covers the Agent Terminal desktop app for macOS and Linux
          and the iOS and Android companion apps. Last updated {LAST_UPDATED}.
        </p>
        <div class="docs-intro-links">
          <a href="#leaves-device">What leaves your device <span>↓</span></a
          ><a
            href="https://github.com/DaniAkash/agent-terminal"
            target="_blank"
            rel="noreferrer"
            >Read the source <ArrowUpRight size={14} /></a
          >
        </div>
      </header>
      <nav class="docs-mobile-nav" aria-label="Privacy policy sections">
        {#each sections as section}
          <a href={`#${section.id}`}>{section.label}</a>
        {/each}
      </nav>

      <section class="docs-section" id="short-version">
        <span class="docs-kicker">01 / THE SHORT VERSION</span>
        <h2>The short version</h2>
        <p>
          Agent Terminal has no backend. There is no Agent Terminal account, no
          sign-in, no analytics, no crash reporting, no advertising, and no
          third-party tracking SDK in any of the four apps. Nobody behind the
          project operates a server that your data could be sent to, so there is
          no profile of you anywhere to build, sell, or hand over.
        </p>
        <p>
          That is a statement about collection, not a claim that no byte ever
          leaves your machine. A handful of things are network features by
          nature: push notifications, checking for updates, reading your coding
          agent's own account quota, loading the terminal renderer on Android,
          and an is-the-phone-online check on iOS. Every one of them is listed
          below in plain language, including what it carries and whether you
          have to switch it on first.
        </p>
        <p>
          <strong
            >Your terminal output and your keystrokes are never uploaded
            anywhere.</strong
          >
          They travel only between your own devices, directly, over your own
          network.
        </p>
      </section>

      <section class="docs-section" id="on-device">
        <span class="docs-kicker">02 / ON YOUR DEVICE</span>
        <h2>What stays on your device</h2>
        <p>
          Everything the apps need in order to work is stored locally, by the
          operating system, under your control.
        </p>
        <ul>
          <li>
            <strong>Projects, tabs, and terminal history.</strong>
            Your terminal sessions run as ordinary local processes on your own
            machine. Their output lives in memory and in your own files, and the
            desktop app holds it nowhere else.
          </li>
          <li>
            <strong>Settings and preferences.</strong>
            Window layout, projects, agent choices, and feature toggles are
            written to the app's own configuration directory on your computer.
          </li>
          <li>
            <strong>Pairing secrets.</strong>
            The desktop stores paired phones in your system credential store:
            the macOS Keychain, or the Secret Service on Linux. It keeps only a
            SHA-256 hash of each device's token and never the token itself, so
            reading that entry does not grant anyone access. The phone keeps its
            own copy in the platform secure store. On a Linux machine with no
            Secret Service available, the desktop falls back to keeping pairings
            in memory only, so they are forgotten when the app quits rather than
            written to a file.
          </li>
          <li>
            <strong>Your coding agent's credentials.</strong>
            Agent Terminal reads the credential files your agent CLIs already
            wrote, and only for providers you have explicitly enabled. It never
            copies, re-saves, or forwards them, and it never writes to them. On
            macOS it can also read an existing Claude Code Keychain item, but
            only after you click to authorize it, and it never raises that
            prompt on its own.
          </li>
          <li>
            <strong>Which agents are installed.</strong>
            To show the right icons, the app looks for agent executables in the
            usual places on your PATH. That is a local filesystem check and
            involves no network request.
          </li>
        </ul>
      </section>

      <section class="docs-section" id="leaves-device">
        <span class="docs-kicker">03 / OFF YOUR DEVICE</span>
        <h2>What leaves your device, and why</h2>
        <p>
          This is the part a privacy policy exists for, so it is the longest
          section. These are all of them.
        </p>

        <h3>Push notifications, if you switch them on</h3>
        <p>
          The companion app can notify you when an agent finishes or needs an
          answer. Push is <strong>off until you turn it on</strong>, and turning
          it on is the moment you consent to notification text leaving your
          local network, because it has to.
        </p>
        <p>
          When it is on, the desktop sends the notification to Expo's push
          service, which relays it to Apple's APNs or Google's FCM so your phone
          can be woken. These are not blank pings. By default the notification
          carries the same text as the desktop banner: the project and tab it
          came from, the agent's display name, and up to the first 200
          characters of the agent's own message. Apple or Google necessarily
          handle that text in transit, as they do for every push notification on
          every app.
        </p>
        <p>
          If you would rather they did not, the companion has a
          <strong>redact names</strong>
          setting. With it on, the notification becomes a generic prompt with no
          project name, no tab, no agent name, and no message text, and only the
          fact that something needs you survives. That setting is off by
          default, so the notifications are useful out of the box. Turning push
          off removes this entirely.
        </p>

        <h3>Checking for updates</h3>
        <p>
          Once per launch, a few seconds after the window opens, the desktop app
          fetches a small release manifest from GitHub to see whether a newer
          version exists. It is a plain request for a public file. The app
          attaches no account, no licence key, and no identifier it generated
          for you, and it says nothing about your projects, your agents, or your
          terminal. Like any request to any web server, it does reveal your IP
          address to GitHub at the moment it is made.
        </p>
        <p>
          Nothing is downloaded or installed without you clicking to accept it,
          and the app never restarts itself. There is currently no setting to
          switch the check off. On Linux the check still runs, but Linux builds
          are not published through that manifest, so it can never return an
          update there.
        </p>

        <h3>Agent Usage limits, if you enable it</h3>
        <p>
          Agent Terminal can show how much of your Claude Code, Codex, or other
          provider allowance is left. The feature is
          <strong>off until you enable it</strong>, and then each provider stays
          off until you select that one individually. Until you do, nothing is
          read and no request is made.
        </p>
        <p>
          When you enable a provider, the app reads the credentials that
          provider's own CLI already stored on your machine and asks
          <em>that provider's</em>
          own API how much allowance you have left, over HTTPS, to a fixed host,
          refusing redirects and with bounded timeouts. Your credentials are
          never copied, never written back, never passed to one provider's host
          from another's file, and never handed to the app's own interface.
          Nothing goes to us, because there is no us to send it to.
        </p>
        <p>
          One provider is worth calling out: Kimi's usage API expects the same
          device headers its own CLI sends, so enabling Kimi means its API also
          receives a device identifier, your computer's hostname, its operating
          system and architecture, and the app version. No other provider
          receives any of that. If you would rather not send it, leave Kimi
          unselected.
        </p>

        <h3>The terminal renderer on Android</h3>
        <p>
          The Android companion loads its terminal renderer from public package
          CDNs when you open a tab. Those CDNs therefore see your device's IP
          address and which file was requested, as they would for any file
          loaded from any CDN. No account, no identifier, and no terminal
          content is involved. The iOS companion does not do this: it ships the
          renderer inside the app.
        </p>

        <h3>A connectivity check on iOS</h3>
        <p>
          The companion needs to know whether the phone is online so it can
          reconnect to your desktop. On Android the operating system answers
          that question directly. On iOS it does not, so the networking library
          the app uses falls back to its own default: roughly once a minute,
          while the app is connected, it makes an empty request to a well-known
          Google endpoint and treats the reply as a yes or no. It sends no
          cookies, no body, no account, and nothing about you, but that endpoint
          does see your IP address. This comes from a dependency's default
          behaviour rather than from a feature of the app, and it is listed here
          because it is still a request your phone makes.
        </p>

        <h3>The push token itself</h3>
        <p>
          If, and only if, you grant notification permission, the companion asks
          Expo for a push token. That exchange involves your device's platform
          push token, which is what makes a notification deliverable to this
          phone and nothing else. The app never asks for notification permission
          at launch: the question comes only after you have paired a desktop, or
          when you go looking for it in settings.
        </p>
      </section>

      <section class="docs-section" id="pairing">
        <span class="docs-kicker">04 / PHONE TO DESKTOP</span>
        <h2>How your phone talks to your desktop</h2>
        <p>
          The companion app is not a client of a service we run. It is a client
          of <em>your</em> computer.
        </p>
        <ul>
          <li>
            <strong>Direct, over your own network.</strong>
            The phone opens an encrypted WebSocket straight to your desktop
            across your local network. There is no relay, no proxy, and no
            intermediate server. If your desktop is unreachable, nothing
            connects, because there is nowhere else for the connection to go.
          </li>
          <li>
            <strong>Pinned, not merely encrypted.</strong>
            Pairing is done by scanning a code shown on your desktop, which
            carries the exact certificate fingerprint of that machine. Both
            companion apps pin that fingerprint in native code and refuse any
            certificate that does not match it byte for byte. Unencrypted
            connections are rejected outright on both platforms.
          </li>
          <li>
            <strong>Revocable immediately.</strong>
            Removing a paired device on the desktop both deletes its record and
            tears down its live connection on the spot.
          </li>
        </ul>
        <p>
          This is why the iOS app tells you, in the permission prompt, that your
          terminal output and keystrokes never leave your network. That remains
          exactly true. The notification text described above is composed
          separately and is the one thing that travels by any other route, only
          with push switched on.
        </p>
      </section>

      <section class="docs-section" id="never">
        <span class="docs-kicker">05 / NEVER</span>
        <h2>What the apps never do</h2>
        <ul>
          <li>
            No accounts and no sign-in. There is nothing to register for, and no
            email address is collected.
          </li>
          <li>
            No analytics, product telemetry, or usage statistics of any kind.
            There is no Sentry, PostHog, Firebase Analytics, Google Analytics,
            Amplitude, Mixpanel, Segment, Datadog, or anything comparable in any
            of the four apps. The only Google library present at all is Firebase
            Cloud Messaging, which is how an Android phone receives a push
            notification, and it is there for no other purpose.
          </li>
          <li>
            No crash reporting. Crashes are not uploaded anywhere, which also
            means you will have to tell us about them yourself.
          </li>
          <li>
            No advertising, no ad identifiers, and no attribution or
            install-tracking SDKs.
          </li>
          <li>
            No over-the-air code updates in the mobile apps. What you installed
            from the store is what runs.
          </li>
          <li>
            Nothing is sold or shared, because nothing is collected in the first
            place.
          </li>
          <li>
            The desktop does not read your terminal in order to report on it.
            Your agent's output is yours.
          </li>
        </ul>
      </section>

      <section class="docs-section" id="retention">
        <span class="docs-kicker">06 / RETENTION</span>
        <h2>Data retention and deletion</h2>
        <p>
          There is no server holding your data, so there is no account to close
          and no export to request. Deletion is entirely in your hands:
          uninstalling the desktop app or clearing its configuration directory
          removes its settings, and revoking a paired device on the desktop
          removes that pairing from both ends. Uninstalling a companion app
          removes its stored device record and its push registration.
        </p>
        <p>
          Push notifications already delivered are handled by Apple and Google
          under their own policies, and the relay is asked to drop any
          notification it could not deliver within ten minutes rather than
          deliver it late.
        </p>
      </section>

      <section class="docs-section" id="children">
        <span class="docs-kicker">07 / CHILDREN</span>
        <h2>Children</h2>
        <p>
          The apps do not collect data from anyone, including children. They are
          developer tools and are not directed at children.
        </p>
      </section>

      <section class="docs-section" id="changes">
        <span class="docs-kicker">08 / CHANGES</span>
        <h2>Changes to this policy</h2>
        <p>
          If this policy changes, the updated version is posted here with a new
          last-updated date. Agent Terminal is open source, so you do not have
          to take this document's word for any of it. Every claim above is
          something you can verify by reading the code.
        </p>
      </section>

      <section class="docs-section" id="contact">
        <span class="docs-kicker">09 / CONTACT</span>
        <h2>Contact</h2>
        <p>
          Questions about this policy, or something here that does not match
          what you see in the code? Write to
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, or open an
          issue on GitHub.
        </p>
        <div class="docs-end-links">
          <a href={`mailto:${CONTACT_EMAIL}`}
            >Email us <ArrowUpRight size={14} /></a
          ><a
            href="https://github.com/DaniAkash/agent-terminal/issues/new/choose"
            target="_blank"
            rel="noreferrer"
            >Open an issue <ArrowUpRight size={14} /></a
          >
        </div>
      </section>
    </article>
    <aside class="docs-aside">
      <span>VERIFY IT YOURSELF</span>
      <p>
        Agent Terminal is MIT licensed and developed in the open. Every claim on
        this page is checkable in the source.
      </p>
      <a
        href="https://github.com/DaniAkash/agent-terminal"
        target="_blank"
        rel="noreferrer"
        >Repository <ArrowUpRight size={13} /></a
      >
    </aside>
  </div>
</main>
