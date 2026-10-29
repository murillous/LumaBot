// Conversões de PDF com o pdf-lib; a imagem passa pelo Sharp antes de entrar no PDF.

import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

/** Imagem → PDF de uma página do tamanho da imagem. */
export async function imageToPdf(image: Buffer): Promise<Buffer> {
  // `rotate()` aplica a orientação do EXIF (foto de celular); o PDF não tem fundo transparente.
  const jpeg = await sharp(image)
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92 })
    .toBuffer();
  const pdf = await PDFDocument.create();
  const embedded = await pdf.embedJpg(jpeg);
  pdf.addPage([embedded.width, embedded.height]).drawImage(embedded, { x: 0, y: 0 });
  return Buffer.from(await pdf.save());
}

/** Junta os PDFs na ordem dada. */
export async function mergePdfs(pdfs: readonly Buffer[]): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const bytes of pdfs) {
    const input = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(input, input.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return Buffer.from(await merged.save());
}
