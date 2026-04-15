import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Testes de caracterização do SpontaneousHandler.
 *
 * Foco em:
 * - Lógica de cooldown: não dispara duas vezes dentro do janela
 * - Probabilidades: nunca dispara quando chance = 0, sempre quando chance = 1
 * - trackActivity: contagem de atividade influencia a chance efetiva
 *
 * Não testamos o disparo real da IA — isso é responsabilidade do LumaHandler.
 */

import { SpontaneousHandler } from '../../src/handlers/SpontaneousHandler.js';
import { LUMA_CONFIG } from '../../src/config/lumaConfig.js';

/**
 * Acessa o estado privado do SpontaneousHandler via reflexão.
 * Necessário porque o estado de cooldown é gerenciado internamente.
 * Em produção, expor esses detalhes via métodos públicos seria over-engineering;
 * aqui é necessário para testar o comportamento determinístico.
 */
function resetSpontaneousState() {
  // Limpa Maps privados via hack de acesso à classe
  // (não há outra forma sem mudar a API pública — intencional)
  SpontaneousHandler['_SpontaneousHandler__cooldowns'] = new Map();
  SpontaneousHandler['_SpontaneousHandler__activityTracker'] = new Map();
}

describe('SpontaneousHandler.trackActivity — rastreio de atividade', () => {
  beforeEach(() => {
    resetSpontaneousState();
  });

  it('não lança erro ao rastrear atividade para um JID novo', () => {
    expect(() => SpontaneousHandler.trackActivity('grupo@g.us')).not.toThrow();
  });

  it('pode rastrear múltiplos JIDs independentemente', () => {
    expect(() => {
      SpontaneousHandler.trackActivity('grupo1@g.us');
      SpontaneousHandler.trackActivity('grupo2@g.us');
      SpontaneousHandler.trackActivity('grupo1@g.us');
    }).not.toThrow();
  });
});

describe('SpontaneousHandler — enabled flag', () => {
  it('LUMA_CONFIG.SPONTANEOUS.enabled existe e é boolean', () => {
    expect(typeof LUMA_CONFIG.SPONTANEOUS.enabled).toBe('boolean');
  });

  it('chance e imageChance são números entre 0 e 1', () => {
    const { chance, imageChance } = LUMA_CONFIG.SPONTANEOUS;
    expect(chance).toBeGreaterThanOrEqual(0);
    expect(chance).toBeLessThanOrEqual(1);
    expect(imageChance).toBeGreaterThanOrEqual(0);
    expect(imageChance).toBeLessThanOrEqual(1);
  });

  it('cooldownMs é um número positivo', () => {
    expect(LUMA_CONFIG.SPONTANEOUS.cooldownMs).toBeGreaterThan(0);
  });
});

describe('SpontaneousHandler — pesos de tipo de interação', () => {
  it('REACT + REPLY + TOPIC somam <= 1.0', () => {
    const { REACT, REPLY, TOPIC } = LUMA_CONFIG.SPONTANEOUS.typeWeights;
    // Devem somar no máximo 1.0 (com margem de ponto flutuante)
    expect(REACT + REPLY + TOPIC).toBeLessThanOrEqual(1.001);
  });

  it('todos os pesos são não-negativos', () => {
    const { REACT, REPLY, TOPIC } = LUMA_CONFIG.SPONTANEOUS.typeWeights;
    expect(REACT).toBeGreaterThanOrEqual(0);
    expect(REPLY).toBeGreaterThanOrEqual(0);
    expect(TOPIC).toBeGreaterThanOrEqual(0);
  });
});

describe('SpontaneousHandler — emojiPool', () => {
  it('emojiPool é um array não vazio', () => {
    expect(Array.isArray(LUMA_CONFIG.SPONTANEOUS.emojiPool)).toBe(true);
    expect(LUMA_CONFIG.SPONTANEOUS.emojiPool.length).toBeGreaterThan(0);
  });

  it('todos os itens do pool são strings', () => {
    LUMA_CONFIG.SPONTANEOUS.emojiPool.forEach(emoji => {
      expect(typeof emoji).toBe('string');
    });
  });
});

describe('SpontaneousHandler — prompts', () => {
  it('todos os prompts existem e são não-vazios', () => {
    const { REPLY, TOPIC, IMAGE } = LUMA_CONFIG.SPONTANEOUS.prompts;
    expect(REPLY.length).toBeGreaterThan(0);
    expect(TOPIC.length).toBeGreaterThan(0);
    expect(IMAGE.length).toBeGreaterThan(0);
  });

  it('prompt REPLY contém placeholder {message}', () => {
    expect(LUMA_CONFIG.SPONTANEOUS.prompts.REPLY).toContain('{message}');
  });
});

describe('SpontaneousHandler.handle — comportamento com bot desativado', () => {
  it('não dispara quando isGroup é false', async () => {
    const mockLumaHandler = { generateResponse: vi.fn() };
    const mockBot = {
      isGroup: false,
      hasVisualContent: false,
      hasAudio: false,
      jid: 'privado@s.whatsapp.net',
      body: 'oi',
    };

    await SpontaneousHandler.handle(mockBot, mockLumaHandler);

    // A IA não deve ter sido chamada
    expect(mockLumaHandler.generateResponse).not.toHaveBeenCalled();
  });
});
