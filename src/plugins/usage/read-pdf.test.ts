// O `usage` conta a leitura de PDF do `ai-context` pelo ponto `ai-context.observers`.

import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, scripted } from '#plugins/ai/testing.ts';
import { aiToolsProbe } from '#plugins/ai/tools-probe.ts';
import { aiContext } from '#plugins/ai-context/ai-context.ts';
import { textPdf } from '#plugins/ai-context/testing.ts';
import { usage } from './usage.ts';
import { usageProbe } from './usage-testing.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

const group = { id: 'grupo@fake', isGroup: true };
const CONTRATO = ['O contrato vale 12 meses.', 'A multa por atraso e de 10 por cento.'];

async function start() {
  const probe = usageProbe();
  bot = await createTestBot({
    plugins: [
      ai,
      fakeProvider({ a: scripted('ok') }),
      aiContext,
      aiToolsProbe,
      usage,
      probe.plugin,
    ],
    pluginConfig: { ai: { models: [{ model: 'fake:a' }] } },
  });
  return { b: bot, usage: probe.entries };
}

const pdf = async () => ({
  document: { data: await textPdf(CONTRATO), mimetype: 'application/pdf' },
  fileName: 'contrato.pdf',
});

describe('read_pdf no usage', () => {
  it('registra o uso de quem pediu como pdf/read, com o resultado', async () => {
    const { b, usage: entries } = await start();
    await b.receive({ ...(await pdf()), chat: group });

    await b.receive({ text: '!tool read_pdf {"ids":["m1"]}', chat: group });
    await b.receive({ text: '!tool read_pdf {"ids":["m7"]}', chat: group });

    const reads = entries.filter((e) => e.action === 'pdf');
    expect(reads.map((e) => [e.kind, e.outcome])).toEqual([
      ['read', 'ok'],
      ['read', 'refused'],
    ]);
  });
});
