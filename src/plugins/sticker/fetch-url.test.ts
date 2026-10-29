import { afterEach, expect, it, vi } from 'vitest';
import { fetchUrl, MAX_URL_BYTES, UrlFetchError } from './fetch-url.ts';

const signal = new AbortController().signal;

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  'http://127.0.0.1/',
  'http://10.0.0.5/x.png',
  'http://192.168.1.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://[::1]/',
  'http://[::ffff:127.0.0.1]/',
  'http://localhost:3000/',
  'file:///etc/passwd',
])('recusa %s sem fazer a requisição', async (url) => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);

  await expect(fetchUrl(url, signal)).rejects.toBeInstanceOf(UrlFetchError);
  expect(fetch).not.toHaveBeenCalled();
});

it('segue o redirecionamento, mas confere o destino', async () => {
  const fetch = vi.fn(
    async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }),
  );
  vi.stubGlobal('fetch', fetch);

  await expect(fetchUrl('https://93.184.216.34/a', signal)).rejects.toThrow(/interno/);
  expect(fetch).toHaveBeenCalledOnce();
});

it('devolve o corpo depois de um redirecionamento público', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/b' } }))
    .mockResolvedValueOnce(new Response('ok'));
  vi.stubGlobal('fetch', fetch);

  const body = await fetchUrl('https://93.184.216.34/a', signal);

  expect(body.toString()).toBe('ok');
  expect(fetch).toHaveBeenLastCalledWith('https://93.184.216.34/b', expect.anything());
});

it('recusa resposta de erro', async () => {
  vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }));

  await expect(fetchUrl('https://93.184.216.34/a', signal)).rejects.toThrow(/HTTP 404/);
});

it('para de ler quando o corpo passa do limite, mesmo sem content-length', async () => {
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
    },
  });
  vi.stubGlobal('fetch', async () => new Response(body));

  await expect(fetchUrl('https://93.184.216.34/a', signal)).rejects.toThrow(String(MAX_URL_BYTES));
});
