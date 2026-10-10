import { randomUUID } from 'node:crypto';
import { defineStorageContract } from '@zapforge/core/storage-contract';
import pg from 'pg';
import { describe, it } from 'vitest';
import { TEST_POSTGRES_URL } from './config/test-env.ts';
import { postgres } from './index.ts';

// Um schema novo por teste isola os dados sem precisar de um banco por teste; o `dispose`
// o apaga. O `reopen` abre outro pool sobre o mesmo schema, como um restart do processo.
describe.skipIf(TEST_POSTGRES_URL === undefined)('postgres', () => {
  const connectionString = TEST_POSTGRES_URL as string;
  let schema = '';

  defineStorageContract(
    { describe, it },
    {
      name: 'postgres',
      create: () => {
        schema = `t_${randomUUID().replaceAll('-', '')}`;
        return postgres({ connectionString, schema });
      },
      reopen: async (port) => {
        await port.close();
        return postgres({ connectionString, schema });
      },
      dispose: async () => {
        const client = new pg.Client({ connectionString });
        await client.connect();
        try {
          await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await client.end();
        }
      },
    },
  );
});
