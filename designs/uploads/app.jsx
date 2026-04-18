// Terminal workspace app — clickable prototype
// Minimal/Linear-esque aesthetic, macOS window frame, light + dark themes

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ───────────────────────────────────────────────────────────
// Theme tokens
// ───────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    windowBg: '#0e0f10',
    windowBorder: 'rgba(255,255,255,0.08)',
    windowShadow: '0 0 0 0.5px rgba(0,0,0,0.6), 0 40px 80px -20px rgba(0,0,0,0.55), 0 16px 40px -12px rgba(0,0,0,0.4)',
    titleBar: '#18191b',
    titleBarBorder: 'rgba(255,255,255,0.06)',
    titleText: 'rgba(255,255,255,0.55)',

    sidebarBg: '#141517',
    sidebarBorder: 'rgba(255,255,255,0.06)',
    sidebarText: 'rgba(255,255,255,0.55)',
    sidebarTextStrong: 'rgba(255,255,255,0.9)',
    sidebarHover: 'rgba(255,255,255,0.04)',
    sidebarActive: 'rgba(255,255,255,0.07)',
    sidebarAccentText: '#ffffff',
    sidebarSectionLabel: 'rgba(255,255,255,0.35)',

    tabBarBg: '#141517',
    tabBarBorder: 'rgba(255,255,255,0.06)',
    tabBg: 'transparent',
    tabActiveBg: '#0e0f10',
    tabText: 'rgba(255,255,255,0.5)',
    tabTextActive: 'rgba(255,255,255,0.95)',
    tabBorder: 'rgba(255,255,255,0.08)',

    termBg: '#0e0f10',
    termText: 'rgba(230,232,235,0.92)',
    termDim: 'rgba(230,232,235,0.5)',
    termMuted: 'rgba(230,232,235,0.35)',
    termPrompt: '#7aa2f7',
    termGreen: '#9ece6a',
    termYellow: '#e0af68',
    termRed: '#f7768e',
    termMagenta: '#bb9af7',
    termCyan: '#7dcfff',

    accent: '#7aa2f7',
    accentSoft: 'rgba(122,162,247,0.14)',
    runningDot: '#9ece6a',

    statusBar: '#141517',
    statusBorder: 'rgba(255,255,255,0.06)',
    statusText: 'rgba(255,255,255,0.45)',
  },
  light: {
    windowBg: '#ffffff',
    windowBorder: 'rgba(0,0,0,0.08)',
    windowShadow: '0 0 0 0.5px rgba(0,0,0,0.15), 0 40px 80px -20px rgba(0,0,0,0.25), 0 16px 40px -12px rgba(0,0,0,0.15)',
    titleBar: '#f6f6f7',
    titleBarBorder: 'rgba(0,0,0,0.06)',
    titleText: 'rgba(0,0,0,0.55)',

    sidebarBg: '#fafafa',
    sidebarBorder: 'rgba(0,0,0,0.06)',
    sidebarText: 'rgba(0,0,0,0.55)',
    sidebarTextStrong: 'rgba(0,0,0,0.88)',
    sidebarHover: 'rgba(0,0,0,0.03)',
    sidebarActive: 'rgba(0,0,0,0.05)',
    sidebarAccentText: '#000000',
    sidebarSectionLabel: 'rgba(0,0,0,0.4)',

    tabBarBg: '#fafafa',
    tabBarBorder: 'rgba(0,0,0,0.06)',
    tabBg: 'transparent',
    tabActiveBg: '#ffffff',
    tabText: 'rgba(0,0,0,0.5)',
    tabTextActive: 'rgba(0,0,0,0.88)',
    tabBorder: 'rgba(0,0,0,0.08)',

    termBg: '#ffffff',
    termText: 'rgba(20,22,25,0.9)',
    termDim: 'rgba(20,22,25,0.55)',
    termMuted: 'rgba(20,22,25,0.4)',
    termPrompt: '#3b6ed8',
    termGreen: '#2e8b3d',
    termYellow: '#a3741d',
    termRed: '#c23648',
    termMagenta: '#7a4dbf',
    termCyan: '#1e7a9e',

    accent: '#3b6ed8',
    accentSoft: 'rgba(59,110,216,0.10)',
    runningDot: '#2e8b3d',

    statusBar: '#fafafa',
    statusBorder: 'rgba(0,0,0,0.06)',
    statusText: 'rgba(0,0,0,0.45)',
  },
};

const UI_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif';
const MONO_FONTS = {
  'JetBrains Mono': '"JetBrains Mono", ui-monospace, Menlo, monospace',
  'SF Mono': 'ui-monospace, "SF Mono", Menlo, monospace',
  'IBM Plex Mono': '"IBM Plex Mono", ui-monospace, Menlo, monospace',
};

Object.assign(window, { THEMES, UI_FONT, MONO_FONTS });
