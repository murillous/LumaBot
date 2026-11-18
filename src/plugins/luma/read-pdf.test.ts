import { type Capability, MediaExpiredError } from '@usebridger/core';
import { createTestBot, fixtures, type TestBot } from '@usebridger/testing';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, promptText, scripted } from '#plugins/ai-testing.ts';
import { aiToolsProbe, toolResult } from '#plugins/ai-tools-probe.ts';
import { usage } from '#plugins/usage/usage.ts';
import { usageProbe } from '#plugins/usage/usage-testing.ts';
import { luma } from './luma.ts';
import { MAX_PDF_TEXT, pageRange } from './read-pdf.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

const group = { id: 'grupo@fake', isGroup: true };

/** PDF com uma página por texto (só ASCII: a fonte padrão do pdf-lib não codifica acento). */
async function textPdf(pages: readonly string[]): Promise<Buffer> {
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

const pdf = (data: Buffer, fileName = 'contrato.pdf') => ({
  document: { data, mimetype: 'application/pdf' },
  fileName,
});

const CONTRATO = ['O contrato vale 12 meses.', 'A multa por atraso e de 10 por cento.'];

interface StartOptions {
  readonly vision?: boolean;
  readonly capabilities?: Iterable<Capability>;
  readonly withUsage?: boolean;
}

async function start(options: StartOptions = {}) {
  const main = scripted('resumo: contrato de 12 meses, multa de 10%');
  const vision = scripted('[p. 1]\nRecibo de 50 reais');
  const probe = usageProbe();
  bot = await createTestBot({
    plugins: [
      ai,
      fakeProvider({ a: main, v: vision }),
      luma,
      aiToolsProbe,
      ...(options.withUsage ? [usage, probe.plugin] : []),
    ],
    pluginConfig: {
      ai: { models: [{ model: 'fake:a' }] },
      luma: {
        thinkingDelayMs: { min: 0, max: 0 },
        ...(options.vision !== false && { visionModels: [{ model: 'fake:v' }] }),
      },
    },
    ...(options.capabilities && { capabilities: options.capabilities }),
  });
  return { b: bot, main, vision, usage: probe.entries };
}

describe('read_pdf', () => {
  it('lê o PDF pelo ID e devolve o texto por página, sem chamar modelo', async () => {
    const { b, main, vision } = await start();
    await b.receive({ ...pdf(await textPdf(CONTRATO)), chat: group });

    await b.receive({ text: '!tool read_pdf {"ids":["#m1"]}', chat: group });

    const result = toolResult(b) as { ok: boolean; pdfs: unknown; text: string };
    expect(result.ok).toBe(true);
    expect(result.pdfs).toEqual([{ id: '#m1', name: 'contrato.pdf', totalPages: 2, pages: '1-2' }]);
    expect(result.text).toContain('--- #m1 contrato.pdf, p. 1-2 de 2 ---');
    expect(result.text).toMatch(/\[p\. 1\]\nO contrato vale 12 meses\./);
    expect(result.text).toMatch(/\[p\. 2\]\nA multa por atraso/);
    expect(main.doGenerateCalls).toHaveLength(0);
    expect(vision.doGenerateCalls).toHaveLength(0);
  });

  it('com pages, lê só a faixa pedida', async () => {
    const { b } = await start();
    await b.receive({ ...pdf(await textPdf(CONTRATO)), chat: group });

    await b.receive({ text: '!tool read_pdf {"ids":["m1"],"pages":"2"}', chat: group });

    const result = toolResult(b) as { pdfs: { pages: string }[]; text: string };
    expect(result.pdfs[0]?.pages).toBe('2-2');
    expect(result.text).toContain('A multa');
    expect(result.text).not.toContain('12 meses');
  });

  it('faixa fora do PDF volta como invalid-pages, com o total de páginas', async () => {
    const { b } = await start();
    await b.receive({ ...pdf(await textPdf(CONTRATO)), chat: group });

    await b.receive({ text: '!tool read_pdf {"ids":["m1"],"pages":"9"}', chat: group });

    expect(toolResult(b)).toEqual({
      ok: false,
      error: 'invalid-pages',
      detail: '#m1 tem 2 páginas',
    });
  });

  it('sem ids, lê o PDF da mensagem citada', async () => {
    const { b } = await start();

    await b.receive({
      text: '!tool read_pdf {}',
      chat: group,
      quoted: pdf(await textPdf(CONTRATO), 'acordo.pdf'),
    });

    const result = toolResult(b) as { pdfs: { name: string }[]; text: string };
    expect(result.pdfs[0]?.name).toBe('acordo.pdf');
    expect(result.text).toContain('12 meses');
  });

  it('sem ids e sem PDF na mensagem, devolve no-pdf', async () => {
    const { b } = await start();

    await b.receive({ text: '!tool read_pdf {}', chat: group });

    expect(toolResult(b)).toEqual({ ok: false, error: 'no-pdf' });
  });

  it('PDF grande volta resumido pela cadeia principal, com o total de páginas', async () => {
    const { b, main } = await start();
    const page = 'clausula '.repeat(400);
    const pages = Array.from({ length: Math.ceil(MAX_PDF_TEXT / page.length) + 2 }, () => page);
    await b.receive({ ...pdf(await textPdf(pages)), chat: group });

    await b.receive({
      text: '!tool read_pdf {"ids":["m1"],"question":"qual a multa?"}',
      chat: group,
    });

    const result = toolResult(b) as { ok: boolean; pdfs: { totalPages: number }[] };
    expect(result).toMatchObject({
      ok: true,
      summary: 'resumo: contrato de 12 meses, multa de 10%',
      note: expect.stringContaining('passe pages'),
    });
    expect(result.pdfs[0]?.totalPages).toBe(pages.length);
    expect(result).not.toHaveProperty('text');
    const prompt = promptText(main);
    expect(prompt).toContain('[p. 1]');
    expect(prompt).toContain('Pergunta: qual a multa?');
  });

  it('PDF escaneado (sem texto) vai para a cadeia de visão como PDF', async () => {
    const { b, vision } = await start();
    await b.receive({ ...pdf(fixtures.document().data, 'recibo.pdf'), chat: group });

    await b.receive({ text: '!tool read_pdf {"ids":["m1"]}', chat: group });

    const result = toolResult(b) as { ok: boolean; text: string };
    expect(result.ok).toBe(true);
    expect(result.text).toContain('(PDF escaneado, lido como imagem)');
    expect(result.text).toContain('Recibo de 50 reais');
    const prompt = promptText(vision);
    expect(prompt).toContain('"type":"file"');
    expect(prompt).toContain('application/pdf');
  });

  it('PDF escaneado sem cadeia de visão devolve no-text', async () => {
    const { b, main } = await start({ vision: false });
    await b.receive({ ...pdf(fixtures.document().data), chat: group });

    await b.receive({ text: '!tool read_pdf {"ids":["m1"]}', chat: group });

    expect(toolResult(b)).toEqual({ ok: false, error: 'no-text', detail: '#m1' });
    expect(main.doGenerateCalls).toHaveLength(0);
  });

  it('recusa ID desconhecido, mídia que não é PDF e PDF corrompido, dizendo qual', async () => {
    const { b } = await start();
    await b.receive({ sticker: fixtures.sticker(), chat: group });
    await b.receive({
      document: { data: Buffer.from('oi'), mimetype: 'text/plain' },
      fileName: 'nota.txt',
      chat: group,
    });
    await b.receive({ ...pdf(Buffer.from('isto não é um pdf')), chat: group });

    await b.receive({ text: '!tool read_pdf {"ids":["m9"]}', chat: group });
    expect(toolResult(b)).toEqual({ ok: false, error: 'unknown', detail: 'm9' });
    await b.receive({ text: '!tool read_pdf {"ids":["m1"]}', chat: group });
    expect(toolResult(b)).toEqual({ ok: false, error: 'not-pdf', detail: 'm1' });
    await b.receive({ text: '!tool read_pdf {"ids":["m2"]}', chat: group });
    expect(toolResult(b)).toEqual({ ok: false, error: 'not-pdf', detail: 'm2' });
    await b.receive({ text: '!tool read_pdf {"ids":["m3"]}', chat: group });
    expect(toolResult(b)).toEqual({ ok: false, error: 'invalid', detail: '#m3' });
  });

  it('PDF que saiu da plataforma volta como expired', async () => {
    const { b } = await start();
    await b.receive({ ...pdf(await textPdf(CONTRATO)), chat: group });
    vi.spyOn(b.transport, 'mediaFromRef').mockReturnValue({
      download: () => Promise.reject(new MediaExpiredError('sumiu')),
      stream: () => Promise.reject(new MediaExpiredError('sumiu')),
    });

    await b.receive({ text: '!tool read_pdf {"ids":["m1"]}', chat: group });

    expect(toolResult(b)).toEqual({ ok: false, error: 'expired', detail: '#m1' });
  });

  it('registra o uso de quem pediu como pdf/read, com o resultado', async () => {
    const { b, usage: entries } = await start({ withUsage: true });
    await b.receive({ ...pdf(await textPdf(CONTRATO)), chat: group });

    await b.receive({ text: '!tool read_pdf {"ids":["m1"]}', chat: group });
    await b.receive({ text: '!tool read_pdf {"ids":["m7"]}', chat: group });

    const reads = entries.filter((e) => e.action === 'pdf');
    expect(reads.map((e) => [e.kind, e.outcome])).toEqual([
      ['read', 'ok'],
      ['read', 'refused'],
    ]);
  });
});

describe('na conversa', () => {
  it('a Luma vê o nome do PDF na transcrição e tem a read_pdf', async () => {
    const { b, main } = await start();
    await b.receive({ ...pdf(await textPdf(CONTRATO)), chat: group, sender: { name: 'Ana' } });

    await b.receive({ text: 'luma, o que esse pdf fala?', chat: group, sender: { name: 'Bia' } });

    const prompt = promptText(main);
    expect(prompt).toMatch(/#m1 \d\d:\d\d\] Ana: \[documento: contrato\.pdf\]/);
    expect(prompt).toContain('leia com a ferramenta de ler pdf');
    const tools = main.doGenerateCalls[0]?.tools ?? [];
    expect(tools.map((t) => t.name)).toContain('read_pdf');
  });
});

describe('pageRange', () => {
  it('entende página, faixa e faixa aberta, e recusa o que não cabe', () => {
    expect(pageRange(undefined, 5)).toEqual({ from: 1, to: 5 });
    expect(pageRange('3', 5)).toEqual({ from: 3, to: 3 });
    expect(pageRange('2-4', 5)).toEqual({ from: 2, to: 4 });
    expect(pageRange('4-', 5)).toEqual({ from: 4, to: 5 });
    expect(pageRange('2-99', 5)).toEqual({ from: 2, to: 5 });
    expect(pageRange('0', 5)).toBeNull();
    expect(pageRange('6', 5)).toBeNull();
    expect(pageRange('4-2', 5)).toBeNull();
    expect(pageRange('primeira', 5)).toBeNull();
  });
});
