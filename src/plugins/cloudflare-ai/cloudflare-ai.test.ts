import { APICallError, generateImage } from 'ai';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isContentFlagged } from '#plugins/ai/ai.ts';
import { cloudflareImageModel, modelPath } from './cloudflare-ai.ts';

const credentials = { accountId: 'conta', apiToken: 'token' };

let big: Buffer;
beforeAll(async () => {
  big = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#00f' } })
    .png()
    .toBuffer();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Troca o `fetch` por um que guarda a requisição e responde `body` com `status`. */
function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

/** Como `stubFetch`, mas responde em ordem, uma resposta por chamada. */
function stubSequence(...responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const next = responses[Math.min(calls.length, responses.length - 1)];
      calls.push({ url, init });
      return new Response(JSON.stringify(next?.body), { status: next?.status ?? 500 });
    }),
  );
  return calls;
}

const FLAGGED = {
  status: 400,
  body: { success: false, errors: [{ code: 3030, message: 'Your output has been flagged.' }] },
};

describe('cloudflareImageModel', () => {
  it('manda prompt, tamanho e a referência reduzida a menos de 512 px, e lê o base64', async () => {
    const png = Buffer.from(big).toString('base64');
    const calls = stubFetch(200, { result: { image: png }, success: true });

    const result = await generateImage({
      model: cloudflareImageModel('flux-2-klein-4b', credentials),
      prompt: { images: [big], text: 'add a hat' },
      maxRetries: 0,
    });

    expect(Buffer.from(result.image.uint8Array)).toEqual(big);
    const [call] = calls;
    expect(call?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/conta/ai/run/@cf/black-forest-labs/flux-2-klein-4b',
    );
    expect(call?.init.headers).toEqual({ Authorization: 'Bearer token' });
    const form = call?.init.body as FormData;
    expect(form.get('prompt')).toBe('add a hat');
    expect([form.get('width'), form.get('height')]).toEqual(['512', '512']);
    const input = form.get('input_image_0') as Blob;
    const meta = await sharp(Buffer.from(await input.arrayBuffer())).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThan(512);
  });

  it('aceita a imagem fora do envelope `result`', async () => {
    stubFetch(200, { image: Buffer.from(big).toString('base64') });

    const result = await generateImage({
      model: cloudflareImageModel('flux-2-klein-4b', credentials),
      prompt: 'x',
      maxRetries: 0,
    });

    expect(result.image.uint8Array.length).toBeGreaterThan(0);
  });

  it('erro HTTP vira APICallError com o status, para a cadeia ler o 429', async () => {
    stubFetch(429, { success: false, errors: [{ message: 'quota' }] });

    const err = await generateImage({
      model: cloudflareImageModel('flux-2-klein-4b', credentials),
      prompt: 'x',
      maxRetries: 0,
    }).catch((e: unknown) => e);

    expect(APICallError.isInstance(err) && err.statusCode).toBe(429);
  });

  it('o motivo do Cloudflare vai no texto do erro, que é o que o log mostra', async () => {
    stubFetch(400, { success: false, errors: [{ code: 5006, message: 'bad input image' }] });

    const err = await generateImage({
      model: cloudflareImageModel('flux-2-klein-4b', credentials),
      prompt: 'x',
      maxRetries: 0,
    }).catch((e: unknown) => e);

    expect((err as Error).message).toBe('Cloudflare respondeu 400: 5006 bad input image');
  });

  it('saída barrada pelo filtro: gera de novo com outra seed', async () => {
    const calls = stubSequence(FLAGGED, {
      status: 200,
      body: { result: { image: Buffer.from(big).toString('base64') } },
    });

    const result = await generateImage({
      model: cloudflareImageModel('flux-2-klein-4b', credentials),
      prompt: 'x',
      maxRetries: 0,
    });

    expect(result.image.uint8Array.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
    const seedOf = (i: number) => (calls[i]?.init.body as FormData | undefined)?.get('seed');
    expect(seedOf(0)).toBeNull();
    expect(seedOf(1)).toMatch(/^\d+$/);
  });

  it('barrada de novo: APICallError que isContentFlagged reconhece', async () => {
    const calls = stubSequence(FLAGGED);

    const err = await generateImage({
      model: cloudflareImageModel('flux-2-klein-4b', credentials),
      prompt: 'x',
      maxRetries: 0,
    }).catch((e: unknown) => e);

    expect(calls).toHaveLength(2);
    expect(isContentFlagged(err)).toBe(true);
  });

  it('outro 400 não repete nem conta como filtro', async () => {
    const calls = stubSequence({ status: 400, body: { errors: [{ code: 5006, message: 'x' }] } });

    const err = await generateImage({
      model: cloudflareImageModel('flux-2-klein-4b', credentials),
      prompt: 'x',
      maxRetries: 0,
    }).catch((e: unknown) => e);

    expect(calls).toHaveLength(1);
    expect(isContentFlagged(err)).toBe(false);
  });

  it('id completo passa como veio', () => {
    expect(modelPath('@cf/outro/modelo')).toBe('@cf/outro/modelo');
  });
});
