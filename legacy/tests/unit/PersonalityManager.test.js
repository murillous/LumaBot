import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Testes de caracterização do PersonalityManager.
 *
 * Mocka o DatabaseService para isolar o PersonalityManager do SQLite —
 * aqui testamos a lógica de seleção e fallback de personalidades,
 * não a persistência em si.
 */

// Controla o retorno do DB a cada teste via closure
let mockGetPersonality = vi.fn().mockReturnValue(null);

vi.mock('../../src/services/Database.js', () => ({
  DatabaseService: {
    get getPersonality() { return mockGetPersonality; },
    setPersonality: vi.fn(),
  },
}));

import { PersonalityManager } from '../../src/managers/PersonalityManager.js';
import { LUMA_CONFIG } from '../../src/config/lumaConfig.js';

describe('PersonalityManager.getPersonaConfig — resolução de personalidade', () => {
  beforeEach(() => {
    // Reseta o mock para simular que não há personalidade salva no DB
    mockGetPersonality = vi.fn().mockReturnValue(null);
  });

  it('retorna a personalidade padrão quando não há nada salvo no DB', () => {
    const config = PersonalityManager.getPersonaConfig('jid@s.whatsapp.net');

    const defaultPersona = LUMA_CONFIG.PERSONALITIES[LUMA_CONFIG.DEFAULT_PERSONALITY];
    expect(config.name).toBe(defaultPersona.name);
  });

  it('retorna a personalidade salva quando o DB tem um valor', () => {
    mockGetPersonality = vi.fn().mockReturnValue('agressiva');

    const config = PersonalityManager.getPersonaConfig('jid@s.whatsapp.net');

    expect(config.name).toBe(LUMA_CONFIG.PERSONALITIES.agressiva.name);
  });

  it('cai no padrão se a key salva no DB não existe mais no config', () => {
    // Simula uma personalidade antiga que foi removida do config
    mockGetPersonality = vi.fn().mockReturnValue('personalidade_removida');

    const config = PersonalityManager.getPersonaConfig('jid@s.whatsapp.net');

    const defaultPersona = LUMA_CONFIG.PERSONALITIES[LUMA_CONFIG.DEFAULT_PERSONALITY];
    expect(config.name).toBe(defaultPersona.name);
  });

  it('config retornada tem as propriedades obrigatórias', () => {
    const config = PersonalityManager.getPersonaConfig('jid@s.whatsapp.net');

    expect(config).toHaveProperty('name');
    expect(config).toHaveProperty('context');
    expect(config).toHaveProperty('style');
    expect(config).toHaveProperty('traits');
    expect(Array.isArray(config.traits)).toBe(true);
  });
});

describe('PersonalityManager.setPersonality — persistência', () => {
  it('retorna true para chave de personalidade válida', () => {
    const result = PersonalityManager.setPersonality('jid@s.whatsapp.net', 'pensadora');
    expect(result).toBe(true);
  });

  it('retorna false para chave inexistente no config', () => {
    const result = PersonalityManager.setPersonality('jid@s.whatsapp.net', 'nao_existe');
    expect(result).toBe(false);
  });
});

describe('PersonalityManager.getActiveName — nome da personalidade ativa', () => {
  it('retorna string não vazia', () => {
    mockGetPersonality = vi.fn().mockReturnValue(null);
    const name = PersonalityManager.getActiveName('jid@s.whatsapp.net');
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });

  it('retorna nome correto para personalidade salva', () => {
    mockGetPersonality = vi.fn().mockReturnValue('amigavel');
    const name = PersonalityManager.getActiveName('jid@s.whatsapp.net');
    expect(name).toBe(LUMA_CONFIG.PERSONALITIES.amigavel.name);
  });
});

describe('PersonalityManager.getList — listagem de personalidades', () => {
  it('retorna array não vazio', () => {
    const list = PersonalityManager.getList();
    expect(list.length).toBeGreaterThan(0);
  });

  it('cada item da lista tem key, name e desc', () => {
    const list = PersonalityManager.getList();
    list.forEach(item => {
      expect(item).toHaveProperty('key');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('desc');
    });
  });

  it('lista contém todas as personalidades do LUMA_CONFIG', () => {
    const configKeys = Object.keys(LUMA_CONFIG.PERSONALITIES);
    const listKeys = PersonalityManager.getList().map(p => p.key);
    expect(listKeys.sort()).toEqual(configKeys.sort());
  });
});
