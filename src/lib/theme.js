// Tiny theme helper: light / dark / system, persisted in localStorage.
// Keeps [data-theme] on <html>, respects system preference when set to "system".
const STORAGE_KEY = 'ys-theme';

export function readStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* storage unavailable */ }
  return 'system';
}

export function writeStoredTheme(theme) {
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
}

export function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(theme) {
  return theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme;
}

export function applyTheme(theme) {
  const resolved = resolveTheme(theme);
  document.documentElement.setAttribute('data-theme', resolved);
  // Keep meta theme-color in sync for browser UI / PWA.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#1f1a28' : '#8263bc');
  return resolved;
}

// Inline bootstrap (called ASAP from index.html) to avoid a flash of wrong theme.
export function bootstrapTheme() {
  applyTheme(readStoredTheme());
}

// Cycle through light -> dark -> system for quick-toggle button.
export function nextTheme(theme) {
  return theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
}
