import { describe, expect, it } from 'vitest';
import { recordingLogger } from '#bot/harness.test-support.ts';
import { createDeferredLogger } from './deferred.ts';
import { createNoopLogger } from './logger.ts';
import type { Logger } from './types.ts';

describe('createDeferredLogger', () => {
  it('cada chamada vai ao destino atual, inclusive nos filhos', () => {
    const first = recordingLogger();
    const second = recordingLogger();
    let target: Logger = first;
    const log = createDeferredLogger(() => target);
    const child = log.child({ plugin: 'p' });

    child.info('um');
    target = second;
    child.info('dois');
    log.error('três');

    expect(first.lines).toEqual([{ level: 'info', message: 'um', fields: { plugin: 'p' } }]);
    expect(second.lines).toEqual([
      { level: 'info', message: 'dois', fields: { plugin: 'p' } },
      { level: 'error', message: 'três', fields: {} },
    ]);
  });

  it('o nível é o do destino atual', () => {
    let target: Logger = createNoopLogger();
    const log = createDeferredLogger(() => target);
    expect(log.level).toBe('silent');
    target = recordingLogger();
    expect(log.level).toBe('trace');
  });

  it('o filho só é recriado quando o destino muda', () => {
    const target = recordingLogger();
    let children = 0;
    const counting: Logger = {
      ...target,
      child: (bindings) => {
        children += 1;
        return target.child(bindings);
      },
    };
    const child = createDeferredLogger(() => counting).child({ chatId: 'c' });
    child.info('a');
    child.info('b');
    expect(children).toBe(1);
  });
});
