// Teste de tipo do aceite do M1-9: o merging é feito contra `@zapforge/core` — o mesmo
// especificador que um plugin usa —, não contra `#services/types.ts`. Se o re-export do
// index deixar de levar a interface original, este arquivo para de compilar no `pnpm typecheck`.
import type { ServiceAccess } from '@zapforge/core';
import { describe, expectTypeOf, it } from 'vitest';
import { createServiceRegistry } from '#services/registry.ts';

interface AiService {
  complete(prompt: string): Promise<string>;
}

declare module '@zapforge/core' {
  interface Services {
    ai: AiService;
  }
}

declare const services: ServiceAccess;

describe('Services por declaration merging', () => {
  it('get devolve o tipo declarado pelo plugin que provê', () => {
    expectTypeOf(services.get('ai')).toEqualTypeOf<AiService>();
    expectTypeOf(createServiceRegistry().forPlugin('x').get('ai')).toEqualTypeOf<AiService>();
  });

  it('provide exige a implementação com o tipo declarado', () => {
    services.provide('ai', { complete: async (prompt) => prompt });
    // @ts-expect-error implementação não bate com AiService
    services.provide('ai', { complete: 42 });
  });

  it('nome não declarado não compila', () => {
    // @ts-expect-error 'nao-declarado' não está em Services
    services.get('nao-declarado');
    // @ts-expect-error idem em provide
    services.provide('nao-declarado', {});
    // @ts-expect-error idem em has
    services.has('nao-declarado');
  });
});
