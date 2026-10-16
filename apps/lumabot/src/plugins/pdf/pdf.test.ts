import {
  createTestBot,
  FakeTransport,
  fixtures,
  type SentMediaType,
  type TestBot,
} from '@usebridger/testing';
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import { aiToolsProbe, toolResult } from '#plugins/ai-tools-probe.ts';
import { pdf as pdfPlugin } from './pdf.ts';

let bot: TestBot;

afterEach(async () => {
  await bot.stop();
});

/** Bytes do primeiro envio do tipo dado; falha se o bot não enviou nenhum. */
function sentBytes(type: SentMediaType): Buffer {
  const bytes = bot.sentMedia(type)[0]?.bytes;
  if (!bytes) throw new Error(`nenhum envio de ${type} com bytes`);
  return bytes;
}

async function pdfPages(bytes: Buffer): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe('!pdf', () => {
  it('converte a imagem em PDF com o nome digitado', async () => {
    bot = await createTestBot({ plugins: [pdfPlugin()] });

    await bot.receive({ text: '!pdf Relatório Março', image: fixtures.image() });

    expect(bot.sent).toContainDocument({
      fileName: 'relatorio-marco.pdf',
      mimetype: 'application/pdf',
    });
    expect(await pdfPages(sentBytes('document'))).toBe(1);
  });

  it('sem imagem, explica o uso', async () => {
    bot = await createTestBot({ plugins: [pdfPlugin()] });

    await bot.receive({ text: '!pdf' });

    expect(bot.sent).toHaveReplied(/^ℹ️ Envie uma imagem com !pdf/);
    expect(bot.transport.reactions.map((r) => r.emoji)).toEqual(['❌']);
  });

  it('num transport sem reações, responde sem reagir', async () => {
    bot = await createTestBot({
      plugins: [pdfPlugin()],
      transport: new FakeTransport({
        capabilities: ['send.text', 'send.document', 'media.download', 'quoted'],
      }),
    });

    await bot.receive({ text: '!pdf', image: fixtures.image() });

    expect(bot.sent).toContainDocument({ mimetype: 'application/pdf' });
    expect(bot.transport.reactions).toHaveLength(0);
  });
});

describe('!mergepdf', () => {
  const pdf = () => ({ document: fixtures.document(), fileName: 'a.pdf' });

  it('junta os PDFs adicionados, na ordem, e esvazia a lista', async () => {
    bot = await createTestBot({ plugins: [pdfPlugin()] });

    await bot.receive({ text: '!mergepdf', ...pdf() });
    await bot.receive({ text: '!joinpdf', quoted: pdf() });
    expect(bot.sent).toHaveReplied('📎 PDF adicionado (2).');

    await bot.receive({ text: '!mergepdf done Trabalho Final' });
    expect(bot.sent).toContainDocument({ fileName: 'trabalho-final.pdf' });
    expect(await pdfPages(sentBytes('document'))).toBe(2);

    await bot.receive({ text: '!mergepdf done' });
    expect(bot.sent.at(-1)?.content).toMatchObject({
      text: 'ℹ️ Adicione pelo menos 2 PDFs antes de finalizar.',
    });
  });

  it('cada remetente tem a própria lista', async () => {
    bot = await createTestBot({ plugins: [pdfPlugin()] });
    const chat = { id: 'grupo@g.us', isGroup: true };

    await bot.receive({ text: '!mergepdf', chat, sender: { id: 'a@s' }, ...pdf() });
    await bot.receive({ text: '!mergepdf', chat, sender: { id: 'b@s' }, ...pdf() });
    await bot.receive({ text: '!mergepdf done', chat, sender: { id: 'a@s' } });

    expect(bot.sent.at(-1)?.content).toMatchObject({
      text: 'ℹ️ Adicione pelo menos 2 PDFs antes de finalizar.',
    });
  });

  it('clear esvazia a lista', async () => {
    bot = await createTestBot({ plugins: [pdfPlugin()] });

    await bot.receive({ text: '!mergepdf', ...pdf() });
    await bot.receive({ text: '!mergepdf', ...pdf() });
    await bot.receive({ text: '!mergepdf clear' });
    await bot.receive({ text: '!mergepdf done' });

    expect(bot.sent.map((s) => s.content.type)).not.toContain('document');
    expect(bot.sent).toHaveReplied('🗑️ Lista de PDFs limpa.');
  });

  it('sem PDF nem ação, explica o uso', async () => {
    bot = await createTestBot({ plugins: [pdfPlugin()] });

    await bot.receive({ text: '!mergepdf', image: fixtures.image() });

    expect(bot.sent).toHaveReplied(/^ℹ️ Envie\/responda PDFs com !mergepdf/);
  });

  it('documento que não é PDF fica fora da lista', async () => {
    bot = await createTestBot({ plugins: [pdfPlugin()] });

    await bot.receive({
      text: '!mergepdf',
      document: { data: Buffer.from('oi'), mimetype: 'text/plain' },
      fileName: 'a.txt',
    });

    expect(bot.sent).toHaveReplied(/^ℹ️ Envie\/responda PDFs com !mergepdf/);
  });
});

describe('tools', () => {
  it('image_to_pdf converte a imagem com o nome pedido', async () => {
    bot = await createTestBot({ plugins: [pdfPlugin(), aiToolsProbe] });

    await bot.receive({
      text: '!tool image_to_pdf {"fileName":"Nota Fiscal"}',
      quoted: { image: fixtures.image() },
    });

    expect(bot.sent).toContainDocument({
      fileName: 'nota-fiscal.pdf',
      mimetype: 'application/pdf',
    });
    expect(toolResult(bot)).toEqual({ ok: true });
  });

  it('merge_pdfs junta os PDFs da citada e da mensagem, na ordem', async () => {
    bot = await createTestBot({ plugins: [pdfPlugin(), aiToolsProbe] });

    await bot.receive({
      text: '!tool merge_pdfs',
      document: fixtures.document(),
      fileName: 'b.pdf',
      quoted: { document: fixtures.document(), fileName: 'a.pdf' },
    });

    expect(await pdfPages(sentBytes('document'))).toBe(2);
    expect(toolResult(bot)).toEqual({ ok: true });
  });

  it('merge_pdfs com um PDF só recusa para o modelo', async () => {
    bot = await createTestBot({ plugins: [pdfPlugin(), aiToolsProbe] });

    await bot.receive({
      text: '!tool merge_pdfs',
      document: fixtures.document(),
      fileName: 'a.pdf',
    });

    expect(toolResult(bot)).toEqual({ ok: false, error: 'need-two-pdfs' });
  });
});
