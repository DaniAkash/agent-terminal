<script lang="ts">
import { ArrowUpRight } from 'phosphor-svelte'
import { siGithub, siX } from 'simple-icons'
</script>
<footer class="site-footer">
  <div class="wrap footer-main">
    <div class="footer-brand">
      <a class="brand" href="/"
        ><img src="/agent-terminal-icon.svg" alt="">
        <span>agent terminal<span class="brand-dot">.</span></span></a
      >
      <p>A better home for the way you build.</p>
      <div class="footer-socials">
        <a
          href="https://github.com/DaniAkash/agent-terminal"
          aria-label="Agent Terminal on GitHub"
          ><span class="simple-icon">{@html siGithub.svg}</span></a
        ><a href="https://x.com/dani_akash_" aria-label="Dani Akash on X"
          ><span class="simple-icon">{@html siX.svg}</span></a
        >
      </div>
      <div class="footer-location">SHIPPED FROM CHENNAI</div>
      <a
        class="footer-product-hunt"
        href="https://www.producthunt.com/products/agent-terminal?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-agent-terminal"
        target="_blank"
        rel="noreferrer"
        ><img
          src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1136595&amp;theme=dark&amp;t=1777623264721"
          alt="Agent Terminal featured on Product Hunt"
          width="150"
          height="32"
          loading="lazy"
        ></a
      >
    </div>
    <div class="footer-links">
      <div>
        <span>PRODUCT</span><a href="/#features">Features</a
        ><a href="/downloads">Downloads</a
        ><a href="https://github.com/DaniAkash/agent-terminal/releases"
          >Releases</a
        ><a href="/changelog">Changelog</a><a href="/docs">Documentation</a>
      </div>
      <div>
        <span>COMMUNITY</span
        ><a
          href="https://github.com/DaniAkash/agent-terminal/blob/main/CONTRIBUTING.md"
          >Contributing</a
        ><a href="https://github.com/DaniAkash/agent-terminal/blob/main/LICENSE"
          >License</a
        ><a href="https://github.com/DaniAkash/agent-terminal/issues/new/choose"
          >Issue</a
        >
      </div>
      <div>
        <span>GET IN TOUCH</span
        ><a href="https://x.com/dani_akash_"
          >Enquiry <ArrowUpRight size={13} /></a
        ><a href="https://github.com/DaniAkash/agent-terminal"
          >GitHub <ArrowUpRight size={13} /></a
        ><a href="https://x.com/dani_akash_">X <ArrowUpRight size={13} /></a>
      </div>
    </div>
  </div>
  <div class="wrap footer-bottom">
    <span>© 2026 AGENT TERMINAL CONTRIBUTORS · OPEN SOURCE UNDER MIT</span>
  </div>
</footer>
