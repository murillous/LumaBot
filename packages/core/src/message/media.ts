import type { Media } from '#message/types.ts';

/**
 * O que o transport fornece para cada mídia: metadados e o loader nativo. O core cuida de
 * laziness e cache; o transport só sabe baixar.
 */
export interface MediaSource {
  readonly mimetype: string;
  /** Tamanho em bytes, quando o transport informa. */
  readonly size?: number | null;
  /** Baixa o conteúdo inteiro. Chamado no máximo uma vez por sucesso. */
  download(): Promise<Buffer>;
  /**
   * Stream nativo, para arquivos grandes sem passar tudo pela memória. Opcional: sem ele,
   * `stream()` cai no `download()` cacheado.
   */
  stream?(): Promise<ReadableStream<Uint8Array>>;
}

/**
 * Embrulha o loader do transport numa `Media` lazy: nada é baixado até a primeira chamada,
 * o buffer fica cacheado na própria instância (uma por mensagem) e chamadas concorrentes
 * compartilham a mesma promise.
 */
export function createMedia(source: MediaSource): Media {
  // Promise resolvida = buffer cacheado; em andamento = download compartilhado.
  let pending: Promise<Buffer> | undefined;

  const download = (): Promise<Buffer> => {
    if (pending === undefined) {
      // async garante que um throw síncrono do loader vire rejeição, não exceção solta.
      const attempt = (async () => source.download())();
      pending = attempt;
      attempt.catch(() => {
        // Falha não fica cacheada: a próxima chamada tenta de novo. O erro chega ao
        // chamador pela própria `attempt`; este handler só limpa o cache.
        if (pending === attempt) pending = undefined;
      });
    }
    return pending;
  };

  return {
    mimetype: source.mimetype,
    size: source.size ?? null,
    download,
    async stream() {
      // Download já feito ou em andamento: reaproveita em vez de baixar de novo.
      if (pending !== undefined || source.stream === undefined) {
        return bufferToStream(await download());
      }
      return source.stream();
    },
  };
}

function bufferToStream(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // View sem cópia sobre o buffer cacheado; o consumidor deve tratá-lo como somente leitura.
      controller.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
      controller.close();
    },
  });
}
