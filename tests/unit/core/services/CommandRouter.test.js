import { describe, it, expect } from 'vitest';
import { CommandRouter } from '../../../../src/core/services/CommandRouter.js';

/**
 * Testes de CommandRouter.detect — parsing de texto → constante COMMANDS.
 * O dispatch é responsabilidade do PluginManager (testado em PluginManager.test.js).
 */
describe('CommandRouter.detect — comandos', () => {
  it.each([
    ['!sticker',      '!sticker'],
    ['!s',            '!sticker'],
    ['!image',        '!image'],
    ['!i',            '!image'],
    ['!gif',          '!gif'],
    ['!g',            '!gif'],
    ['!help',         '!help'],
    ['!menu',         '!help'],
    ['!persona',      '!persona'],
    ['!download url', '!download'],
    ['!d url',        '!download'],
    ['!luma clear',   '!luma clear'],
    ['!lc',           '!luma clear'],
    ['!clear',        '!clear'],
    ['!luma stats',   '!luma stats'],
    ['!ls',           '!luma stats'],
    ['!meunumero',    '!meunumero'],
    ['@everyone',     '@everyone'],
    ['@todos',        '@everyone'],
  ])('detecta "%s" como "%s"', (input, expected) => {
    expect(CommandRouter.detect(input)).toBe(expected);
  });

  it('retorna null para texto sem comando', () => {
    expect(CommandRouter.detect('oi luma tudo bem?')).toBeNull();
  });

  it('retorna null para null', () => {
    expect(CommandRouter.detect(null)).toBeNull();
  });

  it('retorna null para string vazia', () => {
    expect(CommandRouter.detect('')).toBeNull();
  });

  it('é case-insensitive', () => {
    expect(CommandRouter.detect('!STICKER')).toBe('!sticker');
    expect(CommandRouter.detect('!Help')).toBe('!help');
  });
});
