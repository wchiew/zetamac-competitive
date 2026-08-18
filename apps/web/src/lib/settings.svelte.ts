/**
 * Local-first settings.
 *
 * Everything here is presentation-only and maps onto CSS custom properties, so
 * changes apply without a re-render and without a network round trip. When
 * accounts land (M2) this object syncs to `profiles.settings` jsonb,
 * last-write-wins, with localStorage still the source of truth for first paint.
 */

const STORAGE_KEY = 'zmc:settings';

export interface Palette {
  background: string;
  foreground: string;
  accent: string;
}

export interface Settings extends Palette {
  fontKey: string;
  fontFamily: string;
  themeKey: string;
  /**
   * The custom palette, remembered separately from the active one so that
   * switching to a preset and back does not discard it.
   */
  custom: Palette;
  showTimer: boolean;
  showScore: boolean;
}

export const FONTS: ReadonlyArray<{ key: string; label: string; stack: string }> = [
  { key: 'system', label: 'System', stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' },
  { key: 'mono', label: 'Mono', stack: 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace' },
  { key: 'serif', label: 'Serif', stack: 'ui-serif, Georgia, "Times New Roman", serif' },
];

export const THEMES: ReadonlyArray<{
  key: string;
  label: string;
  background: string;
  foreground: string;
  accent: string;
}> = [
  { key: 'light', label: 'Light', background: '#fafafa', foreground: '#1a1a1a', accent: '#2563eb' },
  { key: 'dark', label: 'Dark', background: '#111214', foreground: '#e8e8e8', accent: '#7aa2f7' },
  { key: 'paper', label: 'Paper', background: '#f4efe6', foreground: '#2b2620', accent: '#b4632f' },
  { key: 'midnight', label: 'Midnight', background: '#0b1020', foreground: '#cdd6f4', accent: '#89b4fa' },
];

export const CUSTOM_THEME_KEY = 'custom';

/** A factory, not a constant, so no caller can mutate the shared `custom` object. */
function defaults(): Settings {
  const base = THEMES[0]!;
  return {
    fontKey: 'system',
    fontFamily: FONTS[0]!.stack,
    themeKey: base.key,
    background: base.background,
    foreground: base.foreground,
    accent: base.accent,
    custom: { background: base.background, foreground: base.foreground, accent: base.accent },
    showTimer: true,
    showScore: true,
  };
}

function load(): Settings {
  const fallback = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    // Spread over defaults so settings added in later versions get a value.
    // `custom` is merged separately because a nested spread would not reach it.
    const stored = JSON.parse(raw) as Partial<Settings>;
    return { ...fallback, ...stored, custom: { ...fallback.custom, ...stored.custom } };
  } catch {
    return fallback;
  }
}

export const settings = $state<Settings>(load());

export function applyTheme(key: string): void {
  const theme = THEMES.find((t) => t.key === key);
  if (!theme) return;
  settings.themeKey = theme.key;
  settings.background = theme.background;
  settings.foreground = theme.foreground;
  settings.accent = theme.accent;
}

/** Switch to the remembered custom palette. */
export function applyCustomTheme(): void {
  settings.themeKey = CUSTOM_THEME_KEY;
  settings.background = settings.custom.background;
  settings.foreground = settings.custom.foreground;
  settings.accent = settings.custom.accent;
}

/**
 * Edit one colour by hand. Doing so switches to the custom theme and seeds it
 * from whatever is currently on screen, so nudging one channel of a preset
 * carries the other two across rather than reverting them.
 */
export function setColor(channel: keyof Palette, value: string): void {
  settings[channel] = value;
  settings.custom = {
    background: settings.background,
    foreground: settings.foreground,
    accent: settings.accent,
  };
  settings.themeKey = CUSTOM_THEME_KEY;
}

export function applyFont(key: string): void {
  const font = FONTS.find((f) => f.key === key);
  if (!font) return;
  settings.fontKey = font.key;
  settings.fontFamily = font.stack;
}

export function resetSettings(): void {
  Object.assign(settings, defaults());
}

/** Mirrors settings onto the document and localStorage whenever they change. */
export function initSettingsEffects(): void {
  $effect(() => {
    const root = document.documentElement.style;
    root.setProperty('--bg', settings.background);
    root.setProperty('--fg', settings.foreground);
    root.setProperty('--accent', settings.accent);
    root.setProperty('--font', settings.fontFamily);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  });

  // Without this, a second tab holds stale settings in memory and silently
  // writes them back over anything the first tab changed. Fires only for
  // other tabs, so adopting the value here cannot loop.
  $effect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        Object.assign(settings, JSON.parse(event.newValue) as Partial<Settings>);
      } catch {
        // Ignore a corrupt write from another tab rather than wedging this one.
      }
    };
    addEventListener('storage', onStorage);
    return () => removeEventListener('storage', onStorage);
  });
}
