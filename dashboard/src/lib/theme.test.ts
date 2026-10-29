// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyTheme, loadTheme, saveTheme } from './theme.ts';

const broken = {
  getItem: () => {
    throw new Error('bloqueado');
  },
  setItem: () => {
    throw new Error('bloqueado');
  },
  removeItem: () => {
    throw new Error('bloqueado');
  },
};

describe('tema', () => {
  it('sem storage (bloqueado ou valor inválido) cai em auto', () => {
    expect(loadTheme(broken)).toBe('auto');
    expect(loadTheme({ getItem: () => 'roxo' })).toBe('auto');
    expect(loadTheme({ getItem: () => 'dark' })).toBe('dark');
  });

  it('saveTheme avisa quando não conseguiu guardar', () => {
    expect(saveTheme('dark', broken)).toBe(false);
  });

  it('auto devolve o controle ao sistema, removendo o atributo', () => {
    const root = document.createElement('html');
    applyTheme('dark', root);
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyTheme('auto', root);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
