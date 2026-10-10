import { describe, expect, it } from 'vitest';
import { TenantScope } from './scope.ts';

describe('TenantScope (ADR 0072)', () => {
  it('fora de run não há tenant', () => {
    expect(new TenantScope().current).toBeUndefined();
  });

  it('o tenant segue o trabalho assíncrono disparado dentro do run', async () => {
    const scope = new TenantScope();
    const seen = await scope.run('escola-a', async () => {
      await Promise.resolve();
      return new Promise<string | undefined>((resolve) => {
        setTimeout(() => resolve(scope.current), 0);
      });
    });
    expect(seen).toBe('escola-a');
    expect(scope.current).toBeUndefined();
  });

  it('run(undefined) sai do escopo de quem chamou', () => {
    const scope = new TenantScope();
    const inner = scope.run('escola-a', () => scope.run(undefined, () => scope.current));
    expect(inner).toBeUndefined();
  });

  it('dois escopos (dois bots) não veem o tenant um do outro', () => {
    const a = new TenantScope();
    const b = new TenantScope();
    expect(a.run('escola-a', () => b.current)).toBeUndefined();
  });
});
