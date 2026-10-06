import { expect, it, vi } from 'vitest';
import { TestTransport } from '#transport/fake-transport.test-support.ts';

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

interface Snapshot {
  readonly globals: string[];
  readonly listeners: number[];
  readonly resources: string[];
}

function snapshot(): Snapshot {
  return {
    globals: Object.getOwnPropertyNames(globalThis).sort(),
    listeners: watchedEvents.map((event) => process.listenerCount(event)),
    resources: process.getActiveResourcesInfo().filter((resource) => !ipcResources.has(resource)),
  };
}

// Recursos abertos depois de `before` que não existiam nele. Recursos que fecharam no meio
// (timers do próprio Vitest) não contam: o que importa é o core não abrir nada.
function openedSince(before: Snapshot, after: Snapshot): string[] {
  const remaining = [...before.resources];
  return after.resources.filter((resource) => {
    const index = remaining.indexOf(resource);
    if (index === -1) return true;
    remaining.splice(index, 1);
    return false;
  });
}

function expectNoSideEffect(before: Snapshot): void {
  const after = snapshot();
  expect(after.globals).toEqual(before.globals);
  expect(after.listeners).toEqual(before.listeners);
  expect(openedSince(before, after)).toEqual([]);
}

it('importar @zapforge/core não tem side effect', async () => {
  vi.resetModules();
  const before = snapshot();
  const core = await import('@zapforge/core');
  expect(core.createBot).toBeTypeOf('function');
  expectNoSideEffect(before);
});

it('createBot() não tem side effect até o start()', async () => {
  const { createBot } = await import('@zapforge/core');
  const before = snapshot();
  createBot({
    transport: new TestTransport([]),
  });
  expectNoSideEffect(before);
});
