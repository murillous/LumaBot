// Baixa a mídia de um link do `!sticker <url>`. O link vem de qualquer pessoa no chat, então o
// download não pode alcançar a rede interna do servidor (SSRF) nem encher a memória.

import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Teto do download; a figurinha sai bem menor que isso. */
export const MAX_URL_BYTES: number = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const INTERNAL = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 3],
] as const) {
  INTERNAL.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 127],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  INTERNAL.addSubnet(network, prefix, 'ipv6');
}

/** O link não pôde ser baixado; a mensagem vai para o log, não para o chat. */
export class UrlFetchError extends Error {
  override readonly name = 'UrlFetchError';
}

/**
 * Baixa `url` seguindo até 3 redirecionamentos, cada um conferido. Rejeita com `UrlFetchError`
 * se o endereço é interno, a resposta não é 2xx ou passa de `MAX_URL_BYTES`.
 */
export async function fetchUrl(url: string, signal: AbortSignal): Promise<Buffer> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(current);
    // `manual`: o redirecionamento automático pularia a checagem do destino.
    const response = await fetch(current, { redirect: 'manual', signal });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new UrlFetchError(`HTTP ${response.status} em ${current}`);
    }
    return readLimited(response);
  }
  throw new UrlFetchError(`mais de ${MAX_REDIRECTS} redirecionamentos a partir de ${url}`);
}

/**
 * Confere todos os endereços do host. Ainda sobra a janela entre esta resolução e a do `fetch`
 * (DNS rebinding); fechá-la exige fixar o IP na conexão, o que o `fetch` nativo não expõe.
 */
async function assertPublic(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UrlFetchError(`URL inválida: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UrlFetchError(`protocolo não suportado: ${parsed.protocol}`);
  }
  // O `URL` guarda o IPv6 entre colchetes.
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  for (const { address, family } of addresses) {
    if (INTERNAL.check(address, family === 6 ? 'ipv6' : 'ipv4')) {
      throw new UrlFetchError(`endereço interno bloqueado: ${host} (${address})`);
    }
  }
}

async function readLimited(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_URL_BYTES) {
    await response.body?.cancel();
    throw new UrlFetchError(`arquivo de ${declared} bytes passa do limite`);
  }
  if (!response.body) throw new UrlFetchError('resposta sem corpo');
  // O `content-length` pode faltar ou mentir: conta o que de fato chega.
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_URL_BYTES) {
      throw new UrlFetchError(`download passou de ${MAX_URL_BYTES} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
