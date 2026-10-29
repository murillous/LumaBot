import { defineLogEvent } from '@usebridger/core';

// Campos: `kind` (`image` → PDF, `add` à fila do `!mergepdf`, `merge`), `bytes` do PDF enviado
// ou adicionado, `pdfs` juntados, `durationMs`, `reason` da recusa e `err`.

export const PDF_DONE = defineLogEvent({
  name: 'pdf.convert.done',
  level: 'info',
  message: 'PDF feito',
});

/** Junção acima de 50 MB. */
export const PDF_REFUSED = defineLogEvent({
  name: 'pdf.convert.refused',
  level: 'warn',
  message: 'PDF recusado',
});

export const PDF_FAILED = defineLogEvent({
  name: 'pdf.convert.failed',
  level: 'error',
  message: 'falha ao processar mídia',
});
