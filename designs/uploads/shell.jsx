// Main shell — window chrome, state, tweaks, keyboard shortcuts

const { useState: useStateM, useEffect: useEffectM, useRef: useRefM, useMemo: useMemoM } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "monoFont": "JetBrains Mono",
  "density": "comfortable",
  "tabStyle": "pills",
  "showStatusBar": true,
  "accentHue": 225
}/*EDITMODE-END*/;

function TrafficLights({ theme }) {
  const dot = (bg, ring) => (
    <div style={{
      width: 12, height: 12, borderRadius: '50%', background: bg,
      border: `0.5px solid ${ring}`,
    }}/>
  );
  const dark = theme === THEMES.dark;
  const ring = dark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.15)';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {dot('#ff5f57', ring)}{dot('#febc2e', ring)}{dot('#28c840', ring)}
    </div>
  );
}

function StatusBar({ theme, project, tab, monoFont, sessionsRunning, onTweaks, tweaksOpen }) {
  return (
    <div style={{
      height: 24, background: theme.statusBar,
      borderTop: `0.5px solid ${theme.statusBorder}`,
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '0 10px 0 12px', fontFamily: MONO_FONTS['SF Mono'], fontSize: 10.5,
      color: theme.statusText, flexShrink: 0,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: theme.runningDot }}/>
        {sessionsRunning} running
      </span>
      <span>{project ? project.name : '—'}</span>
      <span style={{ opacity: 0.6 }}>{tab ? `· ${tab.label} · ${tab.cmd}` : ''}</span>
      <span style={{ flex: 1 }}/>
      <span style={{ opacity: 0.6 }}>UTF-8</span>
      <span style={{ opacity: 0.6 }}>zsh</span>
      <span
        onClick={onTweaks}
        style={{
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
          padding: '2px 8px', borderRadius: 4,
          background: tweaksOpen ? theme.sidebarActive : 'transparent',
          color: tweaksOpen ? theme.sidebarTextStrong : theme.statusText,
          fontFamily: UI_FONT, fontSize: 10.5,
        }}
        onMouseEnter={e => { if (!tweaksOpen) e.currentTarget.style.background = theme.sidebarHover; }}
        onMouseLeave={e => { if (!tweaksOpen) e.currentTarget.style.background = 'transparent'; }}
      >
        <svg width="9" height="9" viewBox="0 0 10 10"><circle cx="5" cy="5" r="1.3" fill="currentColor"/><circle cx="5" cy="1.4" r="0.95" fill="currentColor"/><circle cx="5" cy="8.6" r="0.95" fill="currentColor"/></svg>
        Tweaks
      </span>
    </div>
  );
}

function TweaksPanel({ theme, tweaks, setTweak, visible, onClose }) {
  if (!visible) return null;
  const Row = ({ label, children }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
      <div style={{ width: 90, fontSize: 11.5, color: theme.sidebarText }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
  const Segmented = ({ value, options, onChange }) => (
    <div style={{ display: 'flex', background: theme.sidebarHover, borderRadius: 6, padding: 2, border: `0.5px solid ${theme.tabBorder}` }}>
      {options.map(o => (
        <div key={o.value} onClick={() => onChange(o.value)} style={{
          flex: 1, textAlign: 'center', padding: '4px 8px', borderRadius: 4, fontSize: 11,
          cursor: 'pointer', fontFamily: UI_FONT,
          background: value === o.value ? theme.windowBg : 'transparent',
          color: value === o.value ? theme.sidebarTextStrong : theme.sidebarText,
          border: value === o.value ? `0.5px solid ${theme.tabBorder}` : '0.5px solid transparent',
        }}>{o.label}</div>
      ))}
    </div>
  );
  return (
    <div style={{
      position: 'absolute', right: 14, bottom: 34, width: 300,
      background: theme.sidebarBg,
      border: `0.5px solid ${theme.tabBorder}`,
      borderRadius: 10, padding: '12px 14px 8px',
      boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
      fontFamily: UI_FONT, color: theme.sidebarTextStrong,
      zIndex: 50,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Tweaks</div>
        <div style={{ flex: 1 }}/>
        <div onClick={onClose} style={{
          cursor: 'pointer', fontSize: 13, color: theme.sidebarText, padding: '0 4px',
        }}>×</div>
      </div>
      <Row label="Theme">
        <Segmented value={tweaks.theme} options={[{value:'dark',label:'Dark'},{value:'light',label:'Light'}]} onChange={v=>setTweak('theme', v)}/>
      </Row>
      <Row label="Density">
        <Segmented value={tweaks.density} options={[{value:'comfortable',label:'Comfortable'},{value:'compact',label:'Compact'}]} onChange={v=>setTweak('density', v)}/>
      </Row>
      <Row label="Mono font">
        <Segmented value={tweaks.monoFont} options={[{value:'JetBrains Mono',label:'JetBrains'},{value:'SF Mono',label:'SF'},{value:'IBM Plex Mono',label:'Plex'}]} onChange={v=>setTweak('monoFont', v)}/>
      </Row>
      <Row label="Status bar">
        <Segmented value={tweaks.showStatusBar ? 'on' : 'off'} options={[{value:'on',label:'On'},{value:'off',label:'Off'}]} onChange={v=>setTweak('showStatusBar', v === 'on')}/>
      </Row>
      <Row label="Accent">
        <input type="range" min="0" max="360" value={tweaks.accentHue}
          onChange={e => setTweak('accentHue', Number(e.target.value))}
          style={{ width: '100%' }}/>
      </Row>
    </div>
  );
}

function App() {
  const [tweaks, setTweaks] = useStateM(() => {
    try {
      const saved = localStorage.getItem('term-tweaks-v1');
      return saved ? { ...TWEAK_DEFAULTS, ...JSON.parse(saved) } : TWEAK_DEFAULTS;
    } catch { return TWEAK_DEFAULTS; }
  });
  const setTweak = (k, v) => setTweaks(prev => {
    const next = { ...prev, [k]: v };
    try { localStorage.setItem('term-tweaks-v1', JSON.stringify(next)); } catch {}
    try { window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [k]: v } }, '*'); } catch {}
    return next;
  });

  // Base theme + accent hue override
  const baseTheme = THEMES[tweaks.theme] || THEMES.dark;
  const theme = useMemoM(() => {
    const h = tweaks.accentHue;
    const accent = `oklch(0.68 0.15 ${h})`;
    const accentSoft = `oklch(0.68 0.15 ${h} / 0.14)`;
    return {
      ...baseTheme,
      accent,
      accentSoft,
      termPrompt: accent,
    };
  }, [baseTheme, tweaks.accentHue]);

  // Projects + state
  const [projects, setProjects] = useStateM(() => JSON.parse(JSON.stringify(PROJECTS)));
  const [expanded, setExpanded] = useStateM({ 'claude-ui': true, 'api-service': true });
  const [activeProjectId, setActiveProjectId] = useStateM('claude-ui');
  const [activeTabId, setActiveTabId] = useStateM('dev');
  const [tweaksOpen, setTweaksOpen] = useStateM(false);

  const activeProject = projects.find(p => p.id === activeProjectId);
  const activeTab = activeProject?.tabs.find(t => t.id === activeTabId);
  const script = activeTab ? SCRIPTS[activeTab.script] : null;
  const tabKey = `${activeProjectId}/${activeTabId}/${activeTab?.script || ''}`;

  // Edit mode wiring
  useEffectM(() => {
    const handler = (e) => {
      const msg = e.data || {};
      if (msg.type === '__activate_edit_mode') setTweaksOpen(true);
      if (msg.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', handler);
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch {}
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleToggle = (pid) => {
    setExpanded(prev => ({ ...prev, [pid]: !prev[pid] }));
    setActiveProjectId(pid);
    // If toggling open and no active tab in this project, pick first
    const proj = projects.find(p => p.id === pid);
    if (proj && proj.tabs.length && (activeProjectId !== pid || !proj.tabs.some(t => t.id === activeTabId))) {
      setActiveTabId(proj.tabs[0].id);
    }
  };

  const handleSelect = (pid, tid) => {
    setActiveProjectId(pid);
    setActiveTabId(tid);
    setExpanded(prev => ({ ...prev, [pid]: true }));
  };

  const handleCloseTab = (tid) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== activeProjectId) return p;
      const tabs = p.tabs.filter(t => t.id !== tid);
      return { ...p, tabs };
    }));
    if (tid === activeTabId) {
      const proj = projects.find(p => p.id === activeProjectId);
      const remaining = proj.tabs.filter(t => t.id !== tid);
      setActiveTabId(remaining[0]?.id || null);
    }
  };

  const handleNewTab = () => {
    const newId = 'tab-' + Math.random().toString(36).slice(2, 7);
    setProjects(prev => prev.map(p => {
      if (p.id !== activeProjectId) return p;
      const label = `shell`;
      return { ...p, tabs: [...p.tabs, { id: newId, label, cmd: 'zsh', script: 'idleShell', running: false }] };
    }));
    setActiveTabId(newId);
  };

  const handleNewProject = () => {
    const id = 'proj-' + Math.random().toString(36).slice(2, 6);
    const newP = { id, name: 'new-project', path: '~/new-project', tabs: [{ id: 'shell', label: 'shell', cmd: 'zsh', script: 'idleShell', running: false }] };
    setProjects(prev => [...prev, newP]);
    setExpanded(prev => ({ ...prev, [id]: true }));
    setActiveProjectId(id);
    setActiveTabId('shell');
  };

  // Keyboard shortcuts
  useEffectM(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === 't') { e.preventDefault(); handleNewTab(); }
      else if (e.key === 'w') {
        e.preventDefault();
        if (activeTabId) handleCloseTab(activeTabId);
      }
      else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const proj = projects.find(p => p.id === activeProjectId);
        if (proj && proj.tabs[idx]) {
          e.preventDefault();
          setActiveTabId(proj.tabs[idx].id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projects, activeProjectId, activeTabId]);

  const sessionsRunning = projects.reduce((acc, p) => acc + p.tabs.filter(t => t.running).length, 0);

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: tweaks.theme === 'dark'
        ? 'radial-gradient(ellipse at top, #1a1c20 0%, #0a0b0c 60%)'
        : 'radial-gradient(ellipse at top, #eaeaec 0%, #d0d2d6 60%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, fontFamily: UI_FONT,
      overflow: 'hidden',
    }}>
      <div
        data-screen-label="Terminal workspace"
        style={{
          width: 'min(1280px, 100%)',
          height: 'min(820px, 100%)',
          borderRadius: 11,
          background: theme.windowBg,
          boxShadow: theme.windowShadow,
          border: `0.5px solid ${theme.windowBorder}`,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
      }}>
        {/* Traffic lights overlay — painted only over the sidebar header area */}
        <div style={{
          position: 'absolute', top: 0, left: 0, width: 232, height: 38,
          display: 'flex', alignItems: 'center', padding: '0 14px',
          zIndex: 3, pointerEvents: 'none',
        }}>
          <div style={{ pointerEvents: 'auto' }}>
            <TrafficLights theme={theme}/>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <Sidebar
            theme={theme}
            projects={projects}
            activeProjectId={activeProjectId}
            activeTabId={activeTabId}
            expanded={expanded}
            onToggle={handleToggle}
            onSelect={handleSelect}
            density={tweaks.density}
            onNewProject={handleNewProject}
          />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <TabBar
              theme={theme}
              project={activeProject}
              activeTabId={activeTabId}
              onSelect={setActiveTabId}
              onClose={handleCloseTab}
              onNewTab={handleNewTab}
            />
            <TerminalPane
              theme={theme}
              tabKey={tabKey}
              project={activeProject}
              tab={activeTab}
              script={script}
              monoFont={MONO_FONTS[tweaks.monoFont]}
            />
          </div>
        </div>

        {tweaks.showStatusBar && (
          <StatusBar theme={theme} project={activeProject} tab={activeTab} monoFont={MONO_FONTS[tweaks.monoFont]} sessionsRunning={sessionsRunning} onTweaks={() => setTweaksOpen(v => !v)} tweaksOpen={tweaksOpen}/>
        )}

        <TweaksPanel theme={theme} tweaks={tweaks} setTweak={setTweak} visible={tweaksOpen} onClose={() => setTweaksOpen(false)}/>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
