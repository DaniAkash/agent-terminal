<script lang="ts">
  import { ArrowUpRight, TerminalWindow, PlugsConnected } from 'phosphor-svelte';
  import claude from '@lobehub/icons-static-svg/icons/claudecode-color.svg';
  import codex from '@lobehub/icons-static-svg/icons/codex-color.svg';
  import opencode from '@lobehub/icons-static-svg/icons/opencode.svg';
  import amp from '@lobehub/icons-static-svg/icons/amp-color.svg';
  import kilo from '@lobehub/icons-static-svg/icons/kilocode.svg';
  import kimi from '@lobehub/icons-static-svg/icons/kimi-color.svg';
  import mastra from '@lobehub/icons-static-svg/icons/mastra.svg';
  import cursor from '@lobehub/icons-static-svg/icons/cursor.svg';
  import copilot from '@lobehub/icons-static-svg/icons/githubcopilot.svg';
  import qoder from '@lobehub/icons-static-svg/icons/qoder-color.svg';
  const agents = [
    { name: 'Claude Code', logo: claude, status: 'Supported', command: 'claude', integration: 'Native hooks + terminal signals', url: 'https://code.claude.com/docs/en/quickstart' },
    { name: 'Codex CLI', logo: codex, status: 'Supported', command: 'codex', integration: 'Native hooks + terminal signals', url: 'https://developers.openai.com/codex/cli' },
    { name: 'opencode', logo: opencode, status: 'Supported', command: 'opencode', integration: 'Session plugin', url: 'https://opencode.ai/docs/' },
    { name: 'Amp', logo: amp, status: 'Experimental', command: 'amp', integration: 'Terminal title signals', url: 'https://ampcode.com/manual' },
    { name: 'Kilo Code', logo: kilo, status: 'Experimental', command: 'kilo', integration: 'Session plugin', url: 'https://kilo.ai/docs/code-with-ai/platforms/cli' },
    { name: 'Kimi CLI', logo: kimi, status: 'Experimental', command: 'kimi', integration: 'Lifecycle hooks', url: 'https://www.kimi.com/en/help/kimi-code/code-docs-index' },
    { name: 'Mastra', logo: mastra, status: 'Experimental', command: 'mastracode', integration: 'Lifecycle hooks', url: 'https://mastra.ai/docs' }
  ];
  const planned = [
    { name: 'Cursor', logo: cursor, mono: true },
    { name: 'GitHub Copilot CLI', logo: copilot, mono: true },
    { name: 'Factory Droid', logo: 'https://agentery.com/logos/CP-35C3EX.svg', mono: false },
    { name: 'Qoder', logo: qoder, mono: false }
  ];
</script>
<main class="agents-page">

  <section class="agent-directory" id="agent-support"><div class="agents-section-head"><div><span class="agents-kicker">THE LINEUP</span><h1>Agents we know.</h1><p>Integration status reflects the current Agent Terminal project. Install an agent separately, then run it in a terminal tab.</p></div><div class="agent-totals"><span><strong>03</strong> SUPPORTED</span><span><strong>04</strong> EXPERIMENTAL</span></div></div>
    <div class="agent-table-wrap"><table class="agent-table"><thead><tr><th scope="col">AGENT</th><th scope="col">STATUS</th><th scope="col">INTEGRATION</th><th scope="col">RUN</th><th scope="col"><span class="sr-only">Setup guide</span></th></tr></thead><tbody>{#each agents as agent}<tr><td data-label="Agent"><div class="agent-name"><span class="agent-table-icon"><img src={agent.logo} alt="" class:brand-color={['Claude Code', 'Codex', 'Codex CLI', 'Amp', 'Kimi', 'Kimi CLI'].includes(agent.name)} /></span><strong>{agent.name}</strong></div></td><td data-label="Status"><span class:experimental={agent.status === 'Experimental'} class="agent-status"><i></i>{agent.status}</span></td><td data-label="Integration" class="agent-integration">{agent.integration}</td><td data-label="Run"><code>{agent.command}</code></td><td class="agent-guide"><a href={agent.url} target="_blank" rel="noreferrer" aria-label={`Open ${agent.name} setup documentation`}>Setup guide <ArrowUpRight size={15} /></a></td></tr>{/each}</tbody></table></div>
    <div class="agent-legend"><span><i></i> <strong>Supported</strong> — primary, well-tested integrations</span><span><i></i> <strong>Experimental</strong> — detection works; still being tested</span></div>
  </section>
  <section class="agent-getting-started"><div class="agent-start-copy"><span class="agents-kicker">GETTING STARTED</span><h2>Already have<br /><em>a favorite?</em></h2><p>There’s no new agent to learn. Install your preferred CLI using its setup guide, open Agent Terminal, and start it in a project tab.</p><a href="https://github.com/DaniAkash/agent-terminal#supported-agents" target="_blank" rel="noreferrer">Read the project documentation <ArrowUpRight size={15} /></a></div><div class="agent-steps"><div><span>01</span><div><strong>Install your agent</strong><p>Follow the agent’s own setup guide and sign in if needed.</p></div></div><div><span>02</span><div><strong>Open a project</strong><p>Launch Agent Terminal and choose a workspace.</p></div></div><div><span>03</span><div><strong>Start a session</strong><p>Run the agent’s command in a tab. Its identity and state appear in your workspace.</p></div></div></div></section>
  <section class="agents-planned"><div><span class="agents-kicker">ON THE ROADMAP</span><h2>More agents ahead.</h2><p>These integrations are planned and aren’t supported yet.</p></div><div class="planned-marquee" aria-label="Planned integrations: Cursor, GitHub Copilot CLI, Factory Droid, and Qoder"><div class="planned-track">{#each [0, 1] as copy}<div class="planned-group" aria-hidden={copy === 1 ? 'true' : undefined}>{#each planned as agent}<span class="planned-agent"><img src={agent.logo} alt="" class:planned-mono={agent.mono} /><strong>{agent.name}</strong></span>{/each}</div>{/each}</div></div></section>
  <section class="agents-request"><TerminalWindow size={25} /><h2>Missing your agent?</h2><p>Help shape what comes next. Suggest an integration or contribute one to the project.</p><div><a class="button button-primary" href="https://github.com/DaniAkash/agent-terminal/issues/new" target="_blank" rel="noreferrer">Request an agent <ArrowUpRight size={15} /></a><a class="agents-contribute" href="https://github.com/DaniAkash/agent-terminal/blob/main/CONTRIBUTING.md" target="_blank" rel="noreferrer">Contribute an integration <ArrowUpRight size={14} /></a></div></section>
</main>
