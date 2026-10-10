// Contrato da trava com validade (ADR 0074). Dois donos no mesmo port fazem o papel de dois
// processos: o que se verifica é a decisão atômica do adapter, não o transporte até o banco.

import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { StorageClosedError } from '#storage/errors.ts';
import type { StoragePort } from '#storage/types.ts';
import type { ContractCase, ContractTestApi } from './harness.ts';

const TTL_MS = 60_000;

type LeasePort = StoragePort & Required<Pick<StoragePort, 'acquireLease' | 'releaseLease'>>;

/** O adapter sem a trava falha aqui, com a saída que a suíte oferece (`processLocal`). */
function leasePort(port: StoragePort): LeasePort {
  assert.ok(
    port.acquireLease !== undefined && port.releaseLease !== undefined,
    'adapter sem acquireLease/releaseLease: implemente a trava ou, se o storage vive num ' +
      'processo só, declare `processLocal: true` nas opções da suíte',
  );
  return port as LeasePort;
}

export function leaseContract(api: ContractTestApi, test: ContractCase): void {
  api.describe('trava com validade', () => {
    test('trava livre é adquirida', async (port) => {
      assert.equal(await leasePort(port).acquireLease('sessao', 'a', TTL_MS), true);
    });

    test('outro dono não adquire a trava válida; o mesmo dono renova', async (port) => {
      const leases = leasePort(port);
      await leases.acquireLease('sessao', 'a', TTL_MS);
      assert.equal(await leases.acquireLease('sessao', 'b', TTL_MS), false);
      assert.equal(await leases.acquireLease('sessao', 'a', TTL_MS), true);
      assert.equal(await leases.acquireLease('sessao', 'b', TTL_MS), false);
    });

    test('trava vencida passa para outro dono', async (port) => {
      const leases = leasePort(port);
      await leases.acquireLease('sessao', 'a', 1);
      await delay(20);
      assert.equal(await leases.acquireLease('sessao', 'b', TTL_MS), true);
      assert.equal(await leases.acquireLease('sessao', 'a', TTL_MS), false);
    });

    test('a renovação estende a validade', async (port) => {
      const leases = leasePort(port);
      await leases.acquireLease('sessao', 'a', 1);
      await leases.acquireLease('sessao', 'a', TTL_MS);
      await delay(20);
      assert.equal(await leases.acquireLease('sessao', 'b', TTL_MS), false);
    });

    test('releaseLease do dono libera; o de outro dono não', async (port) => {
      const leases = leasePort(port);
      await leases.acquireLease('sessao', 'a', TTL_MS);
      await leases.releaseLease('sessao', 'b');
      assert.equal(await leases.acquireLease('sessao', 'b', TTL_MS), false);
      await leases.releaseLease('sessao', 'a');
      assert.equal(await leases.acquireLease('sessao', 'b', TTL_MS), true);
      // Liberar o que não existe não é erro.
      await leases.releaseLease('outra', 'a');
    });

    test('nomes distintos são travas distintas', async (port) => {
      const leases = leasePort(port);
      await leases.acquireLease('vendas', 'a', TTL_MS);
      assert.equal(await leases.acquireLease('suporte', 'b', TTL_MS), true);
    });

    test('depois do close, a trava rejeita com StorageClosedError', async (port) => {
      const leases = leasePort(port);
      await port.close();
      await assert.rejects(leases.acquireLease('sessao', 'a', TTL_MS), StorageClosedError);
      await assert.rejects(leases.releaseLease('sessao', 'a'), StorageClosedError);
    });
  });
}
