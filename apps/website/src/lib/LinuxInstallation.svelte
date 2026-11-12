<section class="docs-section" id="linux-installation">
  <span class="docs-kicker">LINUX / INSTALLATION</span>
  <h2>Install on Linux</h2>
  <p>
    Linux support is experimental. The published desktop builds target x86-64
    (also called amd64); check your machine with <code>uname -m</code>. Choose
    one package below and download it from <a href="/downloads">Downloads</a>
    or
    <a href="https://github.com/DaniAkash/agent-terminal/releases/latest"
      >GitHub Releases</a
    >. The examples assume your terminal is in the directory containing the
    downloaded file. Files may have versioned names; use the name you actually
    downloaded.
  </p>
  <h3>AppImage · Ubuntu, Arch Linux and Fedora</h3>
  <p>
    The AppImage runs without installing a system package. Download
    <code>agent-terminal-amd64.AppImage</code>, make it executable, and start
    it:
  </p>
  <div class="docs-code">
    <div>APPIMAGE</div>
    <code
      >chmod +x ./agent-terminal-amd64.AppImage<br>./agent-terminal-amd64.AppImage</code
    >
  </div>
  <p>
    Keep the file in a location you can access. To update, download a newer
    AppImage and replace the old file after closing the app. An AppImage does
    not automatically add a desktop menu entry.
  </p>
  <h3>Ubuntu and Debian · DEB</h3>
  <p>
    Download <code>agent-terminal-amd64.deb</code>, then install the local file
    with APT so it can resolve dependencies:
  </p>
  <div class="docs-code">
    <div>UBUNTU / DEBIAN</div>
    <code>sudo apt install ./agent-terminal-amd64.deb</code>
  </div>
  <p>
    Launch Agent Terminal from the application menu or run
    <code>agent-terminal</code>. To update, download and install the newer DEB
    in the same way.
  </p>
  <h3>Fedora · RPM</h3>
  <p>
    Download <code>agent-terminal-x86_64.rpm</code>, then install it with DNF:
  </p>
  <div class="docs-code">
    <div>FEDORA</div>
    <code>sudo dnf install ./agent-terminal-x86_64.rpm</code>
  </div>
  <p>
    For a newer downloaded RPM, use
    <code>sudo dnf upgrade ./agent-terminal-x86_64.rpm</code>. On an immutable
    Fedora variant, follow its package installation guidance or use the
    AppImage.
  </p>
  <h3>Arch Linux · AppImage</h3>
  <p>
    Use the AppImage instructions above to run Agent Terminal on Arch Linux.
  </p>
  <h3>Linux troubleshooting</h3>
  <ul>
    <li>
      <strong>AppImage asks for FUSE:</strong>
      use your distribution’s FUSE 2 compatibility library. Ubuntu 24.04 calls
      it <code>libfuse2t64</code>; Arch calls it <code>fuse2</code>.
      Alternatively, run
      <code>./agent-terminal-amd64.AppImage --appimage-extract</code>, then
      <code>./squashfs-root/AppRun</code>
      from the same directory. See the
      <a href="https://docs.appimage.org/user-guide/troubleshooting/fuse.html"
        >AppImage FUSE guide</a
      >.
    </li>
    <li>
      <strong>Command or coding agent not found:</strong>
      install and sign in to the agent separately. Compare
      <code>command -v codex</code>
      and <code>command -v node</code> in Agent Terminal and your usual shell.
      Initialize version managers in the shell startup files, then reopen the
      tab. For custom paths, see the
      <a
        href="https://github.com/DaniAkash/agent-terminal/blob/main/CONTRIBUTING.md#linux-development-and-packages"
        >Linux environment configuration</a
      >.
    </li>
    <li>
      <strong>Library errors mentioning <code>/tmp/.mount_</code>:</strong>
      download the latest AppImage and check whether shell startup files
      reintroduce AppImage library paths. Launching from a system terminal may
      show more details.
    </li>
    <li>
      <strong>Prompt icons show as boxes:</strong>
      install a compatible Nerd Font and restart Agent Terminal. Shell themes
      that use extra glyphs need a font containing those glyphs.
    </li>
    <li>
      <strong>Package or graphical startup fails:</strong>
      confirm the x86-64 architecture, install the package with your
      distribution’s package manager, and inspect errors by launching from a
      terminal. Linux desktop and compositor compatibility is still
      experimental; report the distribution, version, package format, and error
      on
      <a href="https://github.com/DaniAkash/agent-terminal/issues"
        >GitHub Issues</a
      >.
    </li>
  </ul>
</section>
