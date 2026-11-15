// Peça de teste de quem registra no `usage`: um observer que guarda cada entrada, para o teste
// de cada plugin conferir o que foi registrado. Só os testes importam este módulo.

import { definePlugin, type PluginDefinition } from '@usebridger/core';
import type { UsageEntry } from './usage.ts';

/** Plugin que guarda em `entries` cada ação registrada no `usage` (carregue junto com ele). */
export function usageProbe(): { plugin: PluginDefinition; entries: UsageEntry[] } {
  const entries: UsageEntry[] = [];
  const plugin = definePlugin({
    name: 'usage-probe',
    version: '0.0.0',
    engine: '<1.0.0',
    setup: (ctx) => {
      ctx.services.contribute('usage.observers', ({ at: _, ...entry }) => {
        entries.push(entry);
      });
    },
  });
  return { plugin, entries };
}
