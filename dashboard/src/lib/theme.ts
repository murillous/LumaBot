export type Theme = 'auto' | 'light' | 'dark';

const KEY = 'luma-dashboard-theme';

export const THEMES: readonly Theme[] = ['auto', 'light', 'dark'];

/** Preferência guardada; sem storage (modo privado, bloqueio) cai em `auto`. */
export function loadTheme(storage?: Pick<Storage, 'getItem'>): Theme {
  try {
    const value = (storage ?? localStorage).getItem(KEY);
    return THEMES.includes(value as Theme) ? (value as Theme) : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveTheme(
  theme: Theme,
  storage?: Pick<Storage, 'setItem' | 'removeItem'>,
): boolean {
  try {
    const target = storage ?? localStorage;
    if (theme === 'auto') target.removeItem(KEY);
    else target.setItem(KEY, theme);
    return true;
  } catch {
    // Sem storage a escolha vale só nesta sessão da página.
    return false;
  }
}

/** `auto` remove o atributo e devolve o controle ao `prefers-color-scheme`. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
