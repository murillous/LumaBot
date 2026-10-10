// Jobs agendados guardam o tenant de quem agendou e rodam no escopo dele (ADR 0072). Relógio
// real: o escopo de tenant segue os timers do Node, não os falsos do Vitest.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '#storage/memory.ts';
import { kernelStorage } from '#storage/namespace.ts';
import { TenantScope } from '#tenant/scope.ts';
import { createSchedulerService, type SchedulerService } from './service.ts';

const services: SchedulerService[] = [];

function create(tenants: TenantScope) {
  const storage = createMemoryStorage();
  const service = createSchedulerService({
    storage,
    tenants,
    onError: (error) => {
      throw error.error;
    },
    onStorageError: (error) => {
      throw error;
    },
  });
  services.push(service);
  return { service, storage };
}

afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
});

describe('scheduler com tenant (ADR 0072)', () => {
  it('o job guarda o tenant de quem agendou e o handler roda no escopo dele', async () => {
    const tenants = new TenantScope();
    const { service, storage } = create(tenants);
    const scheduler = service.forPlugin('lembretes');
    const seen: (string | undefined)[] = [];
    scheduler.on('aviso', () => {
      seen.push(tenants.current);
    });

    await tenants.run('escola-a', () => scheduler.at(Date.now() + 60_000, 'aviso'));
    await scheduler.at(Date.now() + 60_000, 'aviso');
    const stored = await kernelStorage(storage, 'scheduler').collection('jobs').find();
    expect(stored.map((job) => job['tenant'])).toEqual(['escola-a', undefined]);

    // Os dois vencem agora; o loop é acordado no escopo de um tenant e não o empresta ao outro.
    await kernelStorage(storage, 'scheduler').collection('jobs').update({}, { fireAt: 0 });
    tenants.run('escola-b', () => service.start());

    await vi.waitFor(() => expect(seen.sort()).toEqual(['escola-a', undefined]));
  });
});
