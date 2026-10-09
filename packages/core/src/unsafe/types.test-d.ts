// Teste de tipo (aceite do M1-15): verificado pelo `pnpm typecheck`, não pelo `pnpm test`.
import { describe, expectTypeOf, it } from 'vitest';
import type { Message } from '#message/types.ts';
import type { PluginContext } from '#plugin/types.ts';
import type { UnsafeAccess } from './access.ts';
import type { Unsafe } from './types.ts';

declare const ctx: PluginContext;
declare const access: UnsafeAccess;

describe('ctx.unsafe.native', () => {
  it('é unknown: o plugin precisa estreitar antes de usar', () => {
    expectTypeOf(ctx.unsafe.native).toBeUnknown();
    expectTypeOf(access.forPlugin({ name: 'p' })).toEqualTypeOf<Unsafe>();
  });
});

describe('ctx.unsafe.raw (ADR 0066)', () => {
  it('recebe a mensagem e devolve unknown', () => {
    expectTypeOf(ctx.unsafe.raw).parameter(0).toEqualTypeOf<Message>();
    expectTypeOf(ctx.unsafe.raw).returns.toBeUnknown();
  });
});
