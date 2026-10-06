import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfProcessor } from '../../../src/processors/PdfProcessor.js';

async function createPdf(pageCount) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) pdf.addPage([200, 200]);
  return Buffer.from(await pdf.save());
}

describe('PdfProcessor.merge', () => {
  it('junta paginas de multiplos PDFs', async () => {
    const first = await createPdf(1);
    const second = await createPdf(2);

    const merged = await PdfProcessor.merge([first, second]);
    const loaded = await PDFDocument.load(merged);

    expect(Buffer.isBuffer(merged)).toBe(true);
    expect(loaded.getPageCount()).toBe(3);
  });
});
