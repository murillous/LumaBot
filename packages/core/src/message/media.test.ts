import { describe, expect, it, vi } from 'vitest';
import { createMedia } from '#message/media.ts';

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function webStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe('createMedia', () => {
  it('expõe metadados, com size null quando o transport não informa', () => {
    const media = createMedia({ mimetype: 'image/png', download: async () => Buffer.alloc(0) });
    expect(media.mimetype).toBe('image/png');
    expect(media.size).toBeNull();
    expect('fileName' in media).toBe(false);
  });

  it('expõe o nome do arquivo quando o transport informa', () => {
    const download = async () => Buffer.alloc(0);
    const media = createMedia({ mimetype: 'application/pdf', fileName: 'nota.pdf', download });
    expect(media.fileName).toBe('nota.pdf');
  });

  it('é lazy e cacheia o download', async () => {
    const download = vi.fn(async () => Buffer.from('abc'));
    const media = createMedia({ mimetype: 'x', download });
    expect(download).not.toHaveBeenCalled();
    const first = await media.download();
    const second = await media.download();
    expect(first.toString()).toBe('abc');
    expect(second).toBe(first);
    expect(download).toHaveBeenCalledOnce();
  });

  it('chamadas concorrentes compartilham a mesma promise', async () => {
    const download = vi.fn(async () => Buffer.from('abc'));
    const media = createMedia({ mimetype: 'x', download });
    const [a, b] = await Promise.all([media.download(), media.download()]);
    expect(a).toBe(b);
    expect(download).toHaveBeenCalledOnce();
  });

  it('falha não fica cacheada', async () => {
    const download = vi
      .fn<() => Promise<Buffer>>()
      .mockRejectedValueOnce(new Error('rede'))
      .mockResolvedValueOnce(Buffer.from('ok'));
    const media = createMedia({ mimetype: 'x', download });
    await expect(media.download()).rejects.toThrow('rede');
    expect((await media.download()).toString()).toBe('ok');
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('throw síncrono do loader vira rejeição', async () => {
    const media = createMedia({
      mimetype: 'x',
      download: () => {
        throw new Error('sync');
      },
    });
    await expect(media.download()).rejects.toThrow('sync');
  });

  it('stream() usa o stream nativo sem baixar tudo quando o transport sabe', async () => {
    const download = vi.fn(async () => Buffer.from('buffer'));
    const stream = vi.fn(async () => webStream('stream'));
    const media = createMedia({ mimetype: 'x', download, stream });
    expect((await readAll(await media.stream())).toString()).toBe('stream');
    expect(download).not.toHaveBeenCalled();
  });

  it('stream() reaproveita o buffer já cacheado', async () => {
    const download = vi.fn(async () => Buffer.from('buffer'));
    const stream = vi.fn(async () => webStream('stream'));
    const media = createMedia({ mimetype: 'x', download, stream });
    await media.download();
    expect((await readAll(await media.stream())).toString()).toBe('buffer');
    expect(stream).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledOnce();
  });

  it('stream() espera um download em andamento em vez de abrir outro', async () => {
    const download = vi.fn(async () => Buffer.from('buffer'));
    const stream = vi.fn(async () => webStream('stream'));
    const media = createMedia({ mimetype: 'x', download, stream });
    const pending = media.download();
    const streamed = await media.stream();
    await pending;
    expect((await readAll(streamed)).toString()).toBe('buffer');
    expect(stream).not.toHaveBeenCalled();
  });

  it('stream() sem stream nativo cai no download cacheado', async () => {
    const download = vi.fn(async () => Buffer.from('abc'));
    const media = createMedia({ mimetype: 'x', download });
    expect((await readAll(await media.stream())).toString()).toBe('abc');
    expect((await media.download()).toString()).toBe('abc');
    expect(download).toHaveBeenCalledOnce();
  });
});
