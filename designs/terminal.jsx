// Terminal pane — plays through a script, supports pause + reattach indicator

const { useState: useStateT, useEffect: useEffectT, useRef: useRefT } = React;

function colorFor(theme, key) {
  return {
    text: theme.termText,
    dim: theme.termDim,
    muted: theme.termMuted,
    green: theme.termGreen,
    yellow: theme.termYellow,
    red: theme.termRed,
    cyan: theme.termCyan,
    magenta: theme.termMagenta,
    prompt: theme.termPrompt,
  }[key] || theme.termText;
}

function Prompt({ theme, project, showCwd = true }) {
  return (
    <span style={{ whiteSpace: 'pre' }}>
      <span style={{ color: theme.termGreen }}>➜</span>
      <span style={{ color: theme.termPrompt }}>{' '}{project}</span>
      {showCwd && <span style={{ color: theme.termDim }}>{' '}git:(</span>}
      {showCwd && <span style={{ color: theme.termRed }}>main</span>}
      {showCwd && <span style={{ color: theme.termDim }}>)</span>}
      <span style={{ color: theme.termText }}>{' '}</span>
    </span>
  );
}

function TerminalPane({ theme, tabKey, project, tab, script, monoFont }) {
  // All output rendered so far. Each item: { text, color, typed, done, replPrompt }
  const [rendered, setRendered] = useStateT([]);
  const [typingText, setTypingText] = useStateT(null); // { text, done, replPrompt }
  const [stepIdx, setStepIdx] = useStateT(0);
  const [finished, setFinished] = useStateT(false);
  const [reattached, setReattached] = useStateT(false);
  const scrollerRef = useRefT(null);
  const timeoutsRef = useRefT([]);

  // Reset when tab changes
  useEffectT(() => {
    // cancel outstanding timers
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setRendered([]);
    setTypingText(null);
    setStepIdx(0);
    setFinished(false);
    setReattached(true);
    const t = setTimeout(() => setReattached(false), 900);
    return () => { clearTimeout(t); timeoutsRef.current.forEach(clearTimeout); };
  }, [tabKey]);

  // Advance through script
  useEffectT(() => {
    if (!script) return;
    if (stepIdx >= script.lines.length) { setFinished(true); return; }
    const line = script.lines[stepIdx];
    const baseDelay = line.delay ?? 120;

    const t = setTimeout(() => {
      if (line.typed) {
        // Animate typing the command (with prompt already above)
        setTypingText({ text: '', full: line.text, replPrompt: line.replPrompt });
        let i = 0;
        const type = () => {
          i += 1;
          setTypingText(prev => prev ? { ...prev, text: line.text.slice(0, i) } : prev);
          if (i < line.text.length) {
            const tt = setTimeout(type, 22 + Math.random() * 42);
            timeoutsRef.current.push(tt);
          } else {
            const done = setTimeout(() => {
              setRendered(r => [...r, { kind: 'cmd', text: line.text, replPrompt: line.replPrompt }]);
              setTypingText(null);
              setStepIdx(n => n + 1);
            }, 240);
            timeoutsRef.current.push(done);
          }
        };
        type();
      } else {
        setRendered(r => [...r, { kind: 'out', text: line.text, color: line.color || 'text' }]);
        setStepIdx(n => n + 1);
      }
    }, baseDelay);
    timeoutsRef.current.push(t);
    return () => clearTimeout(t);
  }, [stepIdx, script]);

  // Auto-scroll
  useEffectT(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rendered, typingText]);

  if (!tab || !script) {
    return <EmptyState theme={theme} monoFont={monoFont}/>;
  }

  return (
    <div style={{
      position: 'relative', flex: 1, background: theme.termBg,
      display: 'flex', flexDirection: 'column', minHeight: 0,
    }}>
      {/* reattach banner */}
      <div style={{
        position: 'absolute', top: 10, right: 14, zIndex: 2,
        fontFamily: MONO_FONTS['SF Mono'], fontSize: 10.5,
        color: theme.termDim,
        display: 'flex', alignItems: 'center', gap: 6,
        opacity: reattached ? 1 : 0,
        transition: 'opacity 300ms',
        pointerEvents: 'none',
      }}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M5 1 A4 4 0 1 1 1 5" stroke={theme.termGreen} strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        <span>reattached — pid {10000 + Math.abs(tabKey.split('').reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0)) % 55000} · uptime {1 + Math.abs(tabKey.length * 37) % 8}h {Math.abs(tabKey.length * 17) % 60}m</span>
      </div>

      <div ref={scrollerRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '14px 18px 18px',
        fontFamily: monoFont, fontSize: 12.5, lineHeight: 1.55,
        color: theme.termText,
      }}>
        {/* scrollback prolog */}
        <div style={{ color: theme.termMuted, fontSize: 11.5, marginBottom: 10 }}>
          Last login: Fri Apr 17 23:41:08 on ttys003 · session resumed
        </div>

        {rendered.map((item, i) => {
          if (item.kind === 'cmd') {
            return (
              <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {item.replPrompt
                  ? <span style={{ color: theme.termMagenta }}>{item.replPrompt === true ? '>' : item.replPrompt}{' '}</span>
                  : <Prompt theme={theme} project={script.prompt} />}
                <span style={{ color: theme.termText }}>{item.text}</span>
              </div>
            );
          }
          return (
            <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: colorFor(theme, item.color) }}>
              {item.text || '\u00A0'}
            </div>
          );
        })}

        {/* active typing line */}
        {typingText && (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {typingText.replPrompt
              ? <span style={{ color: theme.termMagenta }}>{typingText.replPrompt === true ? '>' : typingText.replPrompt}{' '}</span>
              : <Prompt theme={theme} project={script.prompt} />}
            <span style={{ color: theme.termText }}>{typingText.text}</span>
            <span style={{
              display: 'inline-block', width: 7, height: 14, verticalAlign: '-2px',
              background: theme.termText, marginLeft: 1,
              animation: 'blink 1s steps(2) infinite',
            }}/>
          </div>
        )}

        {/* final prompt when script finishes */}
        {finished && !typingText && (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            <Prompt theme={theme} project={script.prompt} />
            <span style={{
              display: 'inline-block', width: 7, height: 14, verticalAlign: '-2px',
              background: theme.termText,
              animation: 'blink 1s steps(2) infinite',
            }}/>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ theme, monoFont }) {
  return (
    <div style={{
      flex: 1, background: theme.termBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 14, color: theme.termDim, fontFamily: UI_FONT,
    }}>
      <div style={{
        fontFamily: monoFont, fontSize: 13, color: theme.termMuted,
        padding: '14px 18px', border: `0.5px dashed ${theme.tabBorder}`, borderRadius: 8,
      }}>
        <span style={{ color: theme.termGreen }}>➜</span>{' '}
        <span style={{ color: theme.termPrompt }}>~</span>{' '}
        <span style={{
          display: 'inline-block', width: 7, height: 13, verticalAlign: '-2px',
          background: theme.termText, animation: 'blink 1s steps(2) infinite',
        }}/>
      </div>
      <div style={{ fontSize: 12, color: theme.termDim, textAlign: 'center', maxWidth: 320 }}>
        No tab open. Press <Kbd theme={theme}>⌘T</Kbd> to start one, or pick a tab from the sidebar.
      </div>
    </div>
  );
}

function Kbd({ theme, children }) {
  return (
    <kbd style={{
      fontFamily: MONO_FONTS['SF Mono'], fontSize: 10.5,
      padding: '1.5px 6px', borderRadius: 4,
      background: theme.sidebarActive, color: theme.sidebarTextStrong,
      border: `0.5px solid ${theme.tabBorder}`,
    }}>{children}</kbd>
  );
}

Object.assign(window, { TerminalPane, EmptyState, Kbd });
