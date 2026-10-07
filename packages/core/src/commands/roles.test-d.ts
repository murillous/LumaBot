// Papéis por declaration merging contra `@zapforge/core`, como um plugin faz (ADR 0035).
import type { CommandRole, PluginContext } from '@zapforge/core';
import { describe, expectTypeOf, it } from 'vitest';
import { command } from '#commands/command.ts';

declare module '@zapforge/core' {
  interface Roles {
    'tipo.curador': true;
  }
}

declare const ctx: PluginContext;

describe('Roles por declaration merging', () => {
  it('role aceita os embutidos e o papel declarado', () => {
    expectTypeOf<'owner' | 'group-admin' | 'everyone' | 'tipo.curador'>().toExtend<CommandRole>();
    command({ name: 'a', role: 'tipo.curador', run: () => undefined });
    command({ name: 'b', role: 'group-admin', run: () => undefined });
  });

  it('nome não declarado não compila', () => {
    // @ts-expect-error 'nao-declarado' não está em Roles
    command({ name: 'c', role: 'nao-declarado', run: () => undefined });
    // @ts-expect-error idem em define
    ctx.roles.define('nao-declarado', () => true);
  });

  it('define recebe o contexto da checagem e exige boolean', () => {
    ctx.roles.define('tipo.curador', (c) => {
      expectTypeOf(c.signal).toEqualTypeOf<AbortSignal>();
      expectTypeOf(c.command).toEqualTypeOf<string>();
      return c.message.sender.id === 'x';
    });
    ctx.roles.define('tipo.curador', async () => true);
    // @ts-expect-error check precisa devolver boolean
    ctx.roles.define('tipo.curador', () => 'sim');
  });
});
