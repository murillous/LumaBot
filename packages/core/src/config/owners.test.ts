import { describe, expect, it } from 'vitest';
import { BotConfigError, normalizeOwners, normalizePhone } from './owners.ts';

describe('normalizePhone', () => {
  it('tira a pontuação comum e deixa só dígitos', () => {
    expect(normalizePhone('+55 11 99999-9999')).toBe('5511999999999');
    expect(normalizePhone('+55 (11) 99999.9999')).toBe('5511999999999');
    expect(normalizePhone('5511999999999')).toBe('5511999999999');
  });

  it('recusa JID, letras e tamanhos que não são telefone, com erro claro', () => {
    expect(() => normalizePhone('5511999999999@s.whatsapp.net')).toThrow(BotConfigError);
    expect(() => normalizePhone('abc')).toThrow(/não é um telefone válido/);
    expect(() => normalizePhone('1234')).toThrow(BotConfigError);
    expect(() => normalizePhone('1234567890123456')).toThrow(BotConfigError);
    expect(() => normalizePhone('')).toThrow(BotConfigError);
  });
});

describe('normalizeOwners', () => {
  it('normaliza, remove repetidos e mantém a ordem', () => {
    expect(normalizeOwners(['+55 11 99999-9999', '5521988887777', '5511999999999'])).toEqual([
      '5511999999999',
      '5521988887777',
    ]);
  });

  it('aponta o índice do item inválido', () => {
    expect(() => normalizeOwners(['5511999999999', 'dono'])).toThrow(/owners\[1\]: "dono"/);
  });
});
