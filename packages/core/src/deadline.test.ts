// `Deadline` com pai (#200): a execução expira também quando o contexto do plugin é descartado.

import { describe, expect, it } from 'vitest';
import { Deadline } from './deadline.ts';

describe('Deadline com pai', () => {
  it('expira quando o pai expira, com o motivo do pai, lido o signal antes ou depois', () => {
    const parent = new Deadline();
    const before = new Deadline(parent);
    const signalBefore = before.signal;
    const after = new Deadline(parent);
    const discarded = new Error('descartado');

    parent.expire(discarded);

    for (const child of [before, after]) {
      expect(child.expired).toBe(true);
      expect(child.reason).toBe(discarded);
    }
    expect(signalBefore.aborted).toBe(true);
    expect(signalBefore.reason).toBe(discarded);
    expect(after.signal.aborted).toBe(true);
    expect(after.signal.reason).toBe(discarded);
  });

  it('a primeira expiração vale: o filho que expirou antes mantém o próprio motivo', () => {
    const parent = new Deadline();
    const child = new Deadline(parent);
    const signal = child.signal;
    const timeout = new Error('timeout');

    child.expire(timeout);
    parent.expire(new Error('descartado'));

    expect(child.reason).toBe(timeout);
    expect(signal.reason).toBe(timeout);
  });

  it('o filho que expira depois do pai não troca o motivo', () => {
    const parent = new Deadline();
    const child = new Deadline(parent);
    const discarded = new Error('descartado');

    parent.expire(discarded);
    child.expire(new Error('timeout'));

    expect(child.reason).toBe(discarded);
    expect(child.signal.reason).toBe(discarded);
  });

  it('o filho expirar não afeta o pai nem os irmãos', () => {
    const parent = new Deadline();
    const child = new Deadline(parent);
    const sibling = new Deadline(parent);

    child.expire(new Error('timeout'));

    expect(parent.expired).toBe(false);
    expect(parent.signal.aborted).toBe(false);
    expect(sibling.expired).toBe(false);
    expect(sibling.signal.aborted).toBe(false);
  });
});
