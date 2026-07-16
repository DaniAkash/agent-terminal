import Image from "next/image";

export default function Solution() {
  return (
    <section id="solution" className="w-full py-28 md:py-36">
      <div className="mx-auto max-w-[900px] px-6 sm:px-8 lg:px-12 text-center">
        <Image
          src="/logo.png"
          alt=""
          width={48}
          height={48}
          className="mx-auto mb-8 opacity-70"
        />
        <h2 className="text-3xl md:text-5xl font-medium tracking-tight leading-[1.1] text-text-primary">
          A terminal that reads the room.
        </h2>
        <p className="mx-auto mt-8 max-w-[65ch] text-lg leading-relaxed text-text-muted">
          Agent Terminal watches your shell&rsquo;s output the same way your
          agent does, then turns what it sees into signal. It groups your tabs
          by project so a workspace&rsquo;s three shells stay together,
          remembers each tab&rsquo;s working directory so a restart drops you
          back where you were, recognises when Claude Code or Codex is running
          and switches into agent-aware mode, and surfaces process, git, and
          network state on the status bar without you asking. When an agent
          finishes or hits a permission prompt, your phone knows before you do.
        </p>
        <p className="mx-auto mt-6 max-w-[52ch] text-[15px] text-text-faint">
          The rest of the page is just showing you the specific ways this
          plays out day to day.
        </p>
      </div>
    </section>
  );
}
