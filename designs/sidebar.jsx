// Sidebar — project tree with collapse/expand, running dots

function Chevron({ open, color }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" style={{
      flexShrink: 0,
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 140ms ease',
    }}>
      <path d="M3.5 2.5 L6.5 5 L3.5 7.5" stroke={color} strokeWidth="1.25" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function FolderIcon({ color }) {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1.5 3.5 a1 1 0 0 1 1-1 h2.5 l1 1 h5 a1 1 0 0 1 1 1 v5 a1 1 0 0 1 -1 1 h-8.5 a1 1 0 0 1 -1 -1 z" stroke={color} strokeWidth="1" fill="none"/>
    </svg>
  );
}

function TabIcon({ color }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0 }}>
      <rect x="1.5" y="2.5" width="8" height="6.5" rx="1" stroke={color} strokeWidth="1" fill="none"/>
      <path d="M3 4.5 h2" stroke={color} strokeWidth="0.9" strokeLinecap="round"/>
    </svg>
  );
}

function RunningDot({ color }) {
  return (
    <span style={{ position: 'relative', width: 6, height: 6, display: 'inline-block', flexShrink: 0 }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: color, opacity: 0.3, animation: 'pulseRing 1.6s ease-out infinite',
      }}/>
      <span style={{
        position: 'absolute', inset: 1, borderRadius: '50%', background: color,
      }}/>
    </span>
  );
}

function Sidebar({ theme, projects, activeProjectId, activeTabId, expanded, onToggle, onSelect, density, onNewProject }) {
  const rowH = density === 'compact' ? 22 : 26;
  const pad = density === 'compact' ? '0 10px' : '0 12px';

  return (
    <div style={{
      width: 232, minWidth: 232, height: '100%', background: theme.sidebarBg,
      borderRight: `0.5px solid ${theme.sidebarBorder}`,
      display: 'flex', flexDirection: 'column',
      fontFamily: UI_FONT, fontSize: 12.5,
    }}>
      {/* window chrome area (reserves space for traffic lights painted in title bar) */}
      <div style={{ height: 38, display: 'flex', alignItems: 'center', padding: '0 12px 0 78px', borderBottom: `0.5px solid ${theme.sidebarBorder}` }}>
        <span style={{ color: theme.sidebarText, fontSize: 12, fontWeight: 500, letterSpacing: 0.1 }}>Workspaces</span>
      </div>

      {/* tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {projects.map(p => {
          const isOpen = expanded[p.id];
          const isProjectActive = activeProjectId === p.id;
          const anyRunning = p.tabs.some(t => t.running);
          return (
            <div key={p.id}>
              <div
                onClick={() => onToggle(p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  height: rowH, padding: pad, margin: '0 6px',
                  borderRadius: 6, cursor: 'pointer',
                  color: isProjectActive ? theme.sidebarTextStrong : theme.sidebarText,
                  background: isProjectActive ? theme.sidebarActive : 'transparent',
                  userSelect: 'none',
                }}
                onMouseEnter={e => { if (!isProjectActive) e.currentTarget.style.background = theme.sidebarHover; }}
                onMouseLeave={e => { if (!isProjectActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <Chevron open={isOpen} color={theme.sidebarText}/>
                <FolderIcon color={isProjectActive ? theme.sidebarTextStrong : theme.sidebarText}/>
                <span style={{ flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                {anyRunning && !isOpen && <RunningDot color={theme.runningDot}/>}
              </div>

              {/* tabs */}
              <div style={{
                overflow: 'hidden',
                maxHeight: isOpen ? p.tabs.length * rowH + 8 : 0,
                transition: 'max-height 220ms cubic-bezier(.4,.1,.2,1)',
              }}>
                {p.tabs.map(t => {
                  const active = isProjectActive && activeTabId === t.id;
                  return (
                    <div
                      key={t.id}
                      onClick={(e) => { e.stopPropagation(); onSelect(p.id, t.id); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        height: rowH, padding: '0 10px 0 34px', margin: '0 6px',
                        borderRadius: 6, cursor: 'pointer',
                        color: active ? theme.sidebarAccentText : theme.sidebarText,
                        background: active ? theme.sidebarActive : 'transparent',
                        position: 'relative',
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = theme.sidebarHover; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {active && <div style={{
                        position: 'absolute', left: 14, top: 6, bottom: 6, width: 2,
                        borderRadius: 1, background: theme.accent,
                      }}/>}
                      <TabIcon color={active ? theme.sidebarAccentText : theme.sidebarText}/>
                      <span style={{ flex: 1, fontWeight: active ? 500 : 400, fontFamily: MONO_FONTS['SF Mono'], fontSize: 11.5 }}>{t.label}</span>
                      {t.running && <RunningDot color={theme.runningDot}/>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div
          onClick={onNewProject}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            height: rowH, padding: pad, margin: '4px 6px 0',
            borderRadius: 6, cursor: 'pointer',
            color: theme.sidebarText, opacity: 0.7,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = theme.sidebarHover; e.currentTarget.style.opacity = 1; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = 0.7; }}
        >
          <span style={{ width: 10, display: 'inline-flex', justifyContent: 'center', fontSize: 13, lineHeight: 1 }}>+</span>
          <span style={{ fontSize: 12 }}>Add project…</span>
        </div>
      </div>

      {/* footer: user / status */}
      <div style={{
        borderTop: `0.5px solid ${theme.sidebarBorder}`,
        padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
        color: theme.sidebarText, fontSize: 11.5,
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: '50%',
          background: `linear-gradient(135deg, ${theme.accent}, ${theme.termMagenta})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 10, fontWeight: 600, letterSpacing: 0.2,
        }}>JP</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span style={{ color: theme.sidebarTextStrong, fontWeight: 500 }}>june.park</span>
          <span style={{ fontSize: 10, color: theme.sidebarText, opacity: 0.7 }}>3 sessions running</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, RunningDot });
