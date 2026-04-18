// Tab bar — rounded pills sitting on the terminal bg, active tab is lifted

function TabBar({ theme, project, activeTabId, onSelect, onClose, onNewTab }) {
  if (!project) return null;

  return (
    <div style={{
      height: 38, display: 'flex', alignItems: 'flex-end',
      background: theme.tabBarBg,
      borderBottom: `0.5px solid ${theme.tabBarBorder}`,
      padding: '0 8px 0 8px',
      fontFamily: UI_FONT, fontSize: 12,
      gap: 2,
      flexShrink: 0,
    }}>
      {project.tabs.map(t => {
        const active = t.id === activeTabId;
        return (
          <div
            key={t.id}
            onClick={() => onSelect(t.id)}
            style={{
              position: 'relative',
              height: 28, display: 'flex', alignItems: 'center', gap: 7,
              padding: '0 10px 0 12px',
              borderRadius: '7px 7px 0 0',
              background: active ? theme.tabActiveBg : 'transparent',
              color: active ? theme.tabTextActive : theme.tabText,
              cursor: 'pointer',
              marginBottom: -0.5,
              borderLeft: active ? `0.5px solid ${theme.tabBorder}` : '0.5px solid transparent',
              borderRight: active ? `0.5px solid ${theme.tabBorder}` : '0.5px solid transparent',
              borderTop: active ? `0.5px solid ${theme.tabBorder}` : '0.5px solid transparent',
              transition: 'color 120ms',
              minWidth: 90,
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.color = theme.tabTextActive; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.color = theme.tabText; }}
          >
            {t.running ? (
              <RunningDot color={theme.runningDot}/>
            ) : (
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: active ? theme.tabText : theme.tabText, opacity: 0.35, flexShrink: 0,
              }}/>
            )}
            <span style={{ fontFamily: MONO_FONTS['SF Mono'], fontSize: 11.5, letterSpacing: 0.1 }}>{t.label}</span>
            <span
              onClick={e => { e.stopPropagation(); onClose(t.id); }}
              style={{
                width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 3, opacity: 0.4, fontSize: 13, lineHeight: 1,
                marginLeft: 2,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = theme.sidebarHover; e.currentTarget.style.opacity = 1; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = 0.4; }}
            >
              <svg width="7" height="7" viewBox="0 0 7 7"><path d="M1 1 L6 6 M6 1 L1 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            </span>
          </div>
        );
      })}
      <div
        onClick={onNewTab}
        style={{
          height: 28, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: theme.tabText, cursor: 'pointer', fontSize: 14, lineHeight: 1, marginBottom: -0.5,
          borderRadius: 6,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = theme.sidebarHover; e.currentTarget.style.color = theme.tabTextActive; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.tabText; }}
      >
        <svg width="11" height="11" viewBox="0 0 11 11"><path d="M5.5 1.5 V9.5 M1.5 5.5 H9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
      </div>
      <div style={{ flex: 1 }}/>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 28,
        color: theme.tabText, fontFamily: MONO_FONTS['SF Mono'], fontSize: 10.5, paddingRight: 6,
      }}>
        <span style={{ opacity: 0.5 }}>{project.path}</span>
      </div>
    </div>
  );
}

Object.assign(window, { TabBar });
