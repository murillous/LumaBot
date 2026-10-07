import { describe, expect, it } from 'vitest';
import {
  createServiceRegistry,
  ServiceConflictError,
  ServiceNotFoundError,
} from '#services/registry.ts';
import type { ServiceAccess } from '#services/types.ts';

interface Counter {
  next(): number;
}

// Nomes só destes testes; em runtime o registry não conhece tipos.
declare module '@zapforge/core' {
  interface Services {
    'test.counter': Counter;
    'test.other': string;
  }
}

function counter(): Counter {
  let n = 0;
  return { next: () => ++n };
}

describe('createServiceRegistry', () => {
  it('get devolve a mesma instância provida por outro plugin', () => {
    const registry = createServiceRegistry();
    const impl = counter();
    registry.forPlugin('provider').provide('test.counter', impl);

    const consumer = registry.forPlugin('consumer');
    expect(consumer.has('test.counter')).toBe(true);
    expect(consumer.get('test.counter')).toBe(impl);
  });

  it('serviço ausente lança erro citando serviço, quem pediu e o dependsOn', () => {
    const registry = createServiceRegistry();
    const get = () => registry.forPlugin('resumo').get('test.counter');

    expect(get).toThrow(ServiceNotFoundError);
    expect(get).toThrow(/"test\.counter"/);
    expect(get).toThrow(/nenhum plugin carregado o provê/);
    expect(get).toThrow(/"resumo"/);
    expect(get).toThrow(/dependsOn/);
    expect(get).toThrow(
      expect.objectContaining({ service: 'test.counter', requestedBy: 'resumo' }),
    );
  });

  it('has é false para serviço ausente, sem lançar', () => {
    expect(createServiceRegistry().forPlugin('p').has('test.counter')).toBe(false);
  });

  it('dois plugins provendo o mesmo nome: erro cita ambos e mantém o primeiro', () => {
    const registry = createServiceRegistry();
    const first = counter();
    registry.forPlugin('ai-openai').provide('test.counter', first);

    const provide = () => registry.forPlugin('ai-gemini').provide('test.counter', counter());
    expect(provide).toThrow(ServiceConflictError);
    expect(provide).toThrow(/"ai-openai"/);
    expect(provide).toThrow(/"ai-gemini"/);
    expect(registry.forPlugin('x').get('test.counter')).toBe(first);
  });

  it('o mesmo plugin não re-provê o mesmo nome', () => {
    const registry = createServiceRegistry();
    const access = registry.forPlugin('ai');
    access.provide('test.counter', counter());

    expect(() => access.provide('test.counter', counter())).toThrow(
      /provido duas vezes pelo plugin "ai"/,
    );
  });

  it('get funciona no setup do consumidor quando a dependência proveu no dela', () => {
    // Simula o boot em ordem topológica: setup do provedor, depois o do consumidor.
    const registry = createServiceRegistry();
    const setupAi = (ctx: { services: ServiceAccess }) =>
      ctx.services.provide('test.counter', counter());
    const setupResumo = (ctx: { services: ServiceAccess }) =>
      ctx.services.get('test.counter').next();

    setupAi({ services: registry.forPlugin('ai') });
    expect(setupResumo({ services: registry.forPlugin('resumo') })).toBe(1);
  });

  it('removePlugin tira só o que o plugin proveu e permite re-prover (reload)', () => {
    const registry = createServiceRegistry();
    registry.forPlugin('a').provide('test.counter', counter());
    registry.forPlugin('b').provide('test.other', 'b');

    registry.removePlugin('a');

    const access = registry.forPlugin('x');
    expect(access.has('test.counter')).toBe(false);
    expect(access.get('test.other')).toBe('b');

    const reloaded = counter();
    registry.forPlugin('a').provide('test.counter', reloaded);
    expect(access.get('test.counter')).toBe(reloaded);
  });

  it('list mostra serviço e plugin dono', () => {
    const registry = createServiceRegistry();
    registry.forPlugin('b').provide('test.other', 'b');
    expect(registry.list()).toEqual([{ plugin: 'b', name: 'test.other', service: 'b' }]);
  });

  it('registries são independentes (um por bot, sem estado global)', () => {
    const one = createServiceRegistry();
    const two = createServiceRegistry();
    one.forPlugin('p').provide('test.other', 'one');

    expect(two.forPlugin('p').has('test.other')).toBe(false);
    expect(() => two.forPlugin('p').provide('test.other', 'two')).not.toThrow();
  });
});
