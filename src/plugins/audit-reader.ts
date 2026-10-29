// Só para testes: lê o log de auditoria. `ctx.audit.query` exige `adminPlugins`, então o teste
// passa `adminPlugins: [reader.plugin.name]`.

import { type AuditEvent, definePlugin, type PluginDefinition } from '@usebridger/core';

export function auditReader(): {
  readonly plugin: PluginDefinition;
  /** Eventos da ação; espera o dreno de 1 s do kernel gravar `count` deles. */
  events(action: string, count?: number): Promise<readonly AuditEvent[]>;
} {
  let query: ((action: string) => Promise<readonly AuditEvent[]>) | undefined;
  const plugin = definePlugin({
    name: 'audit-reader',
    version: '0.0.0',
    engine: '<1.0.0',
    setup: (ctx) => {
      query = async (action) => (await ctx.audit.query({ action })).events;
    },
  });
  return {
    plugin,
    events: async (action, count = 1) => {
      for (let i = 0; i < 40; i += 1) {
        const found = (await query?.(action)) ?? [];
        if (found.length >= count) return found;
        await new Promise((r) => setTimeout(r, 100));
      }
      return (await query?.(action)) ?? [];
    },
  };
}
