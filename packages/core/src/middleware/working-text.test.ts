import { describe, expect, it } from 'vitest';
import type { MessageContext } from '#context.ts';
import { MiddlewarePipeline } from './pipeline.ts';
import { type SanitizedContext, sanitize } from './sanitize.ts';
import { fakeContext } from './test-helpers.ts';

describe('sanitize e o texto de trabalho ctx.text (M1-16.2)', () => {
  it('grava o texto truncado em ctx.text, sem alterar message.text', async () => {
    const ctx: SanitizedContext = fakeContext({ text: 'x'.repeat(10) });
    const pipeline = new MiddlewarePipeline<SanitizedContext>();
    pipeline.use(sanitize({ maxTextLength: 4 }));

    await pipeline.run(ctx);

    expect(ctx.text).toBe('xxxx');
    expect(ctx.sanitized?.text).toBe('xxxx');
    expect(ctx.message.text).toHaveLength(10);
  });

  it('trunca o ctx.text que um middleware anterior reescreveu', async () => {
    const ctx: SanitizedContext = fakeContext({ text: 'original' });
    const pipeline = new MiddlewarePipeline<SanitizedContext>();
    pipeline.use(
      (c: MessageContext, next) => {
        c.text = 'reescrito pelo middleware';
        return next();
      },
      { priority: 10 },
    );
    pipeline.use(sanitize({ maxTextLength: 9 }));

    await pipeline.run(ctx);

    expect(ctx.text).toBe('reescrito');
  });
});
