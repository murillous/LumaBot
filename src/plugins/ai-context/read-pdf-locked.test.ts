// PDF com senha à parte: montar um PDF cifrado de verdade pede RC4/AES à mão, então a exceção do
// PDF.js (`PasswordException`) é simulada aqui, sem afetar os outros testes da `read_pdf`.

import { describe, expect, it, vi } from 'vitest';
import { PdfUnreadableError, pdfText } from './read-pdf.ts';

vi.mock('unpdf', async (original) => ({
  ...(await original<typeof import('unpdf')>()),
  getDocumentProxy: () =>
    Promise.reject(Object.assign(new Error('No password given'), { name: 'PasswordException' })),
}));

describe('pdfText', () => {
  it('PDF com senha vira PdfUnreadableError encrypted', async () => {
    const err = await pdfText(new Uint8Array([1, 2, 3])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfUnreadableError);
    expect((err as PdfUnreadableError).reason).toBe('encrypted');
  });
});
