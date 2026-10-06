import { PDFDocument } from "pdf-lib";

export class PdfProcessor {
  static async merge(buffers) {
    if (!Array.isArray(buffers) || buffers.length < 2) {
      throw new Error("PdfProcessor.merge exige ao menos 2 PDFs.");
    }

    const output = await PDFDocument.create();

    for (const buffer of buffers) {
      const input = await PDFDocument.load(buffer);
      const pages = await output.copyPages(input, input.getPageIndices());
      for (const page of pages) output.addPage(page);
    }

    return Buffer.from(await output.save());
  }
}
