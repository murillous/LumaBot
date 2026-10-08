import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineStorageContract } from '@zapforge/core/storage-contract';
import { describe, it } from 'vitest';
import { sqlite } from './index.ts';

defineStorageContract(
  { describe, it },
  { name: 'sqlite em memória', create: () => sqlite({ path: ':memory:' }) },
);

// Em arquivo, para exercitar o WAL e a persistência (reabrir sobre os mesmos dados).
let dir = '';
defineStorageContract(
  { describe, it },
  {
    name: 'sqlite em arquivo',
    create: () => {
      dir = mkdtempSync(join(tmpdir(), 'zapforge-sqlite-'));
      return sqlite({ path: join(dir, 'bot.sqlite') });
    },
    reopen: async (port) => {
      await port.close();
      return sqlite({ path: join(dir, 'bot.sqlite') });
    },
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  },
);
