import { describe, expect, it } from 'vitest';
import { createLogger, type LogDestination } from './logger.ts';
import { createSecretSet } from './secrets.ts';

function capture(secrets: ReturnType<typeof createSecretSet>) {
  const raw: string[] = [];
  const destination: LogDestination = { write: (line) => raw.push(line) };
  return { log: createLogger({ destination, secrets }), raw };
}

describe('createSecretSet', () => {
  it('agrupa por dono, ignora vazios e muda a versão a cada mudança', () => {
    const set = createSecretSet();
    const v0 = set.version;
    set.set('plugin:a', ['x', '', 'y']);
    set.set('plugin:b', ['y', 'z']);
    expect(set.values()).toEqual(['x', 'y', 'z']);
    expect(set.version).toBeGreaterThan(v0);

    const v1 = set.version;
    set.set('plugin:a', ['w']);
    expect(set.values()).toEqual(['w', 'y', 'z']);
    expect(set.version).toBeGreaterThan(v1);

    set.delete('plugin:b');
    set.set('plugin:a', []);
    expect(set.values()).toEqual([]);
  });

  it('não muda a versão quando nada muda', () => {
    const set = createSecretSet();
    const v0 = set.version;
    set.delete('ninguém');
    set.set('ninguém', ['']);
    expect(set.version).toBe(v0);
  });
});

describe('createLogger com SecretSet', () => {
  it('censura segredo adicionado depois da criação do logger, inclusive em filhos', () => {
    const secrets = createSecretSet();
    const { log, raw } = capture(secrets);
    const child = log.child({ plugin: 'ai' });

    child.info('antes: sk-123');
    secrets.set('plugin:ai', ['sk-123']);
    child.info('depois: sk-123', { apiKey: 'sk-123', err: new Error('falhou com sk-123') });

    expect(raw[0]).toContain('sk-123');
    expect(raw[1]).not.toContain('sk-123');
    expect(raw[1]).toContain('[REDACTED]');
  });

  it('censura o valor novo de um segredo alterado (reload)', () => {
    const secrets = createSecretSet();
    secrets.set('plugin:ai', ['velho']);
    const { log, raw } = capture(secrets);

    secrets.set('plugin:ai', ['novo"com aspas']);
    log.info('chave novo"com aspas');
    expect(raw.join('')).not.toContain('novo\\"com aspas');
    expect(raw.join('')).toContain('[REDACTED]');
  });
});
