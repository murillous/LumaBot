// Peças de teste de quem usa o `ai-context`: um bot que responde pelo `respond` sem ser a Luma, e
// um PDF de texto. Só os testes importam este módulo.

import { type AuditEvent, definePlugin, type PluginDefinition } from '@usebridger/core';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Um bot qualquer, que não é a Luma: responde pelo `respond` quando a fala começa com "eco". */
export const eco: PluginDefinition = definePlugin({
  name: 'eco',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { 'ai-context': '^0.1.0' },
  setup: (ctx) => {
    ctx.events.on('message', async (e) => {
      if (!e.text?.toLowerCase().startsWith('eco')) return;
      await ctx.services.get('aiContext').respond({
        message: e.message,
        reply: e.reply,
        signal: e.signal,
        log: e.log,
        instructions: '# Quem você é\nVocê é o Eco.',
        name: 'Eco',
      });
    });
  },
});

/** PDF com uma página por texto (só ASCII: a fonte padrão do pdf-lib não codifica acento). */
export async function textPdf(pages: readonly string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage();
    // Uma linha por trecho de 90 caracteres, para caber na página.
    (text.match(/.{1,90}/g) ?? []).forEach((line, i) => {
      page.drawText(line, { x: 20, y: 800 - i * 10, font, size: 6 });
    });
  }
  return Buffer.from(await doc.save());
}

/**
 * Lê o log de auditoria (`ctx.audit.query` exige `adminPlugins: [reader.plugin.name]`). Cópia do
 * `auditReader` do app: o plugin genérico não importa o app, e o `@usebridger/testing` ainda não
 * tem um leitor de auditoria.
 */
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
