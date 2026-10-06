import { expect, it, vi } from 'vitest';

// ADR 0004: importar o core não pode abrir recurso, agendar timer, ouvir sinal nem criar global.
const watchedEvents = ['SIGINT', 'SIGTERM', 'exit', 'beforeExit', 'uncaughtException'] as const;

// Escritas no stdio/IPC do worker do Vitest aparecem e somem a qualquer momento: são ruído.
const ipcResources = new Set([
  'PipeWrap',
  'SimpleWriteWrap',
  'WriteWrap',
  'TTYWrap',
  'ShutdownWrap',
]);

function snapshot(): unknown {
  return {
    globals: Object.getOwnPropertyNames(globalThis).sort(),
    listeners: watchedEvents.map((event) => process.listenerCount(event)),
    resources: process
      .getActiveResourcesInfo()
      .filter((resource) => !ipcResources.has(resource))
      .sort(),
  };
}

it('importar @zapforge/core não tem side effect', async () => {
  vi.resetModules();
  const before = snapshot();
  const core = await import('@zapforge/core');
  expect(core.createBot).toBeTypeOf('function');
  expect(snapshot()).toEqual(before);
});

it('createBot() não tem side effect até o start()', async () => {
  const { createBot } = await import('@zapforge/core');
  const before = snapshot();
  createBot({
    transport: {
      name: 'fake',
      connect: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
    },
  });
  expect(snapshot()).toEqual(before);
});
