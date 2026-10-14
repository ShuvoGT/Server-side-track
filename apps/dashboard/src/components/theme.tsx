'use client';

import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'sst-theme';

/**
 * Runs in <head> before the page paints, so a saved light or dark choice never flashes the other theme.
 * Kept as a string: it is inlined, not bundled.
 */
export const themeBootScript = `try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private window): the choice lasts until reload.
  }
}

const ICONS: Record<Theme, string> = {
  light:
    'M12 3v2m0 14v2M5.6 5.6 7 7m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  dark: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z',
  system: 'M4 5h16v11H4zM9 20h6m-3-4v4',
};
const LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const saved = document.documentElement.dataset.theme;
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);

  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      {(['light', 'dark', 'system'] as const).map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={theme === t}
          title={`${LABELS[t]} theme`}
          onClick={() => {
            setTheme(t);
            applyTheme(t);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={ICONS[t]} />
          </svg>
          <span className="visually-hidden">{LABELS[t]}</span>
        </button>
      ))}
    </div>
  );
}
