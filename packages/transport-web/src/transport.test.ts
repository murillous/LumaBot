// O protocolo do `WebTransport` sem rede (ADR 0077): rotas e sockets falsos, para os prazos rodarem
// com relógio falso e cada frame ser conferido.

import {
  createLogger,
  type HttpHandler,
  type HttpRoutes,
  type HttpSocket,
  type HttpSocketAccept,
  type HttpSocketHandlers,
  type Message,
} from '@zapforge/core';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVerifier } from './jwt.ts';
import { MAX_FRAME_BYTES, type ServerFrame } from './protocol.ts';
import { type WebOptions, WebTransport } from './transport.ts';

const SECRET = 'segredo-de-teste-com-pelo-menos-32-bytes';

class FakeRoutes implements HttpRoutes {
  readonly basePath = '/transports/web';
  readonly handlers = new Map<string, HttpHandler>();
  accept: HttpSocketAccept | undefined;

  route(method: string, path: string, handler: HttpHandler): void {
    this.handlers.set(`${method} ${path}`, handler);
  }

  ws(_path: string, accept: HttpSocketAccept): void {
    this.accept = accept;
  }
}

class FakeSocket implements HttpSocket {
  readonly frames: ServerFrame[] = [];
  closed: { code: number | undefined; reason: string | undefined } | undefined;

  send(data: string | ArrayBuffer | Uint8Array): void {
    this.frames.push(JSON.parse(String(data)) as ServerFrame);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
}

interface Open {
  readonly socket: FakeSocket;
  readonly handlers: HttpSocketHandlers;
  frame(data: unknown): Promise<void>;
  /** O cliente fechou: o servidor chama o `onClose`. */
  leave(): Promise<void>;
}

let routes: FakeRoutes;
let transport: WebTransport;

function make(options: Partial<WebOptions> = {}): WebTransport {
  routes = new FakeRoutes();
  const auth = { secret: SECRET };
  transport = new WebTransport(
    { auth, ...options },
    createVerifier(auth),
    routes,
    createLogger({ level: 'silent' }),
  );
  return transport;
}

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/transports/web/chat', { headers });
}

async function open(headers: Record<string, string> = {}): Promise<Open> {
  const decided = await routes.accept?.(request(headers), { params: {} });
  if (decided === undefined || decided instanceof Response) throw new Error('upgrade recusado');
  const socket = new FakeSocket();
  await decided.onOpen?.(socket);
  return {
    socket,
    handlers: decided,
    frame: async (data) =>
      decided.onMessage?.(socket, typeof data === 'string' ? data : JSON.stringify(data)),
    leave: async () => decided.onClose?.(socket, 1000, ''),
  };
}

function token(claims: Record<string, unknown> = {}, expiresIn: string | number = '1h') {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('u1')
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(SECRET));
}

async function ready(conversation?: string): Promise<Open> {
  const connection = await open();
  await connection.frame({ type: 'auth', token: await token(), conversation });
  expect(connection.socket.frames[0]?.type).toBe('ready');
  return connection;
}

beforeEach(async () => {
  make();
  await transport.connect();
});

afterEach(async () => {
  await transport.disconnect();
  vi.useRealTimers();
});

describe('WebTransport: autenticação', () => {
  it('auth que não chega em 10 s fecha com 4401', async () => {
    vi.useFakeTimers();
    const { socket } = await open();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(socket.closed).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.closed?.code).toBe(4401);
  });

  it('primeiro frame que não é `auth`, ou conversa inválida, fecha com 4400', async () => {
    const naoAuth = await open();
    await naoAuth.frame({ type: 'message', text: 'oi' });
    expect(naoAuth.socket.closed?.code).toBe(4400);

    const lixo = await open();
    await lixo.frame('{não é json');
    expect(lixo.socket.closed?.code).toBe(4400);

    const conversa = await open();
    await conversa.frame({ type: 'auth', token: await token(), conversation: 'a/b' });
    expect(conversa.socket.closed?.code).toBe(4400);
  });

  it('frame que chega antes do `ready` fecha a conexão', async () => {
    const { socket, frame } = await open();
    const auth = frame({ type: 'auth', token: await token() });
    await frame({ type: 'message', text: 'cedo' });
    await auth;
    expect(socket.closed?.code).toBe(4400);
    expect(socket.frames).toEqual([]);
  });

  it('no `exp`, a conexão fecha com 4401', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-10T12:00:00Z') });
    const connection = await open();
    await connection.frame({ type: 'auth', token: await token({}, '60s') });
    expect(connection.socket.frames[0]?.type).toBe('ready');

    await vi.advanceTimersByTimeAsync(59_000);
    expect(connection.socket.closed).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connection.socket.closed?.code).toBe(4401);
  });

  it('o `ready` traz o chat; o tenant entra no ID com escape', async () => {
    make({ tenantClaim: 'escola' });
    await transport.connect();
    const connection = await open();
    await connection.frame({ type: 'auth', token: await token({ escola: 'São Paulo/1' }) });
    expect(connection.socket.frames[0]).toEqual({
      type: 'ready',
      chatId: 'S%C3%A3o%20Paulo%2F1:u1/default',
      userId: 'S%C3%A3o%20Paulo%2F1:u1',
    });
  });
});

describe('WebTransport: frames do cliente', () => {
  it('mensagem vira `message` com ack; o `ref` volta no ack', async () => {
    const received: Message[] = [];
    transport.on('message', (m) => {
      received.push(m);
    });
    const { socket, frame } = await ready('suporte');
    await frame({ type: 'message', ref: 'c1', text: 'oi' });

    const ack = socket.frames[1];
    expect(ack).toMatchObject({ type: 'ack', ref: 'c1' });
    expect(received[0]).toMatchObject({
      type: 'text',
      text: 'oi',
      fromMe: false,
      quoted: null,
      chat: { id: 'u1/suporte', isGroup: false, kind: 'dm' },
      sender: { id: 'u1', name: null, phone: null },
    });
    expect(ack?.type === 'ack' && ack.id).toBe(received[0]?.id);
  });

  it('frame inválido depois do `ready` responde `error` e mantém a conexão', async () => {
    const { socket, frame } = await ready();
    await frame('não é json');
    await frame({ type: 'pular' });
    await frame({ type: 'message', ref: 'r', text: '' });
    await frame({ type: 'action', actionId: 7 });
    expect(socket.frames.slice(1).map((f) => f.type === 'error' && f.code)).toEqual([
      'invalid-frame',
      'invalid-frame',
      'invalid-frame',
      'invalid-frame',
    ]);
    expect(socket.frames[3]).toMatchObject({ ref: 'r' });
    expect(socket.closed).toBeUndefined();
  });

  it('frame acima de 64 KiB fecha com 1009', async () => {
    const { socket, frame } = await ready();
    await frame({ type: 'message', text: 'x'.repeat(MAX_FRAME_BYTES) });
    expect(socket.closed?.code).toBe(1009);
  });

  it('clique vira `interaction` com o chat e o remetente da conexão', async () => {
    const interactions: unknown[] = [];
    transport.on('interaction', (i) => {
      interactions.push(i);
    });
    const { frame } = await ready();
    await frame({ type: 'action', actionId: 'a1' });
    expect(interactions[0]).toMatchObject({
      actionId: 'a1',
      chat: { id: 'u1/default' },
      sender: { id: 'u1' },
    });
  });
});

describe('WebTransport: envio', () => {
  it('texto leva árvore, botões e citação; edição e remoção chegam como frames', async () => {
    const { socket } = await ready();
    const quoted = { id: 'm-user' } as Message;
    const key = await transport.send(
      'u1/default',
      { type: 'text', text: 'oi', formatted: { type: 'formatted', nodes: ['oi'] } },
      { quoted, actions: [{ id: 'a1', label: 'Sim' }] },
    );
    await transport.edit(key, 'olá');
    await transport.delete(key);

    expect(socket.frames.slice(1)).toEqual([
      {
        type: 'message',
        id: key.id,
        timestamp: expect.any(Number),
        kind: 'text',
        text: 'oi',
        formatted: { type: 'formatted', nodes: ['oi'] },
        quotedId: 'm-user',
        actions: [{ id: 'a1', label: 'Sim' }],
      },
      { type: 'edit', id: key.id, text: 'olá' },
      { type: 'delete', id: key.id },
    ]);
    expect(key).toEqual({ chatId: 'u1/default', id: key.id, fromMe: true, senderId: null });
  });

  it('com a aba fechada, envio, edição e remoção esperam no buffer; "digitando" não', async () => {
    const first = await ready();
    await first.leave();
    const key = await transport.send('u1/default', { type: 'text', text: 'depois' });
    await transport.edit(key, 'depois!');
    await transport.sendTyping('u1/default', 'text');

    const again = await ready();
    expect(again.socket.frames.slice(1).map((f) => f.type)).toEqual(['message', 'edit']);
    expect(first.socket.frames).toHaveLength(1);
  });

  it('"digitando" vai para quem está na conversa', async () => {
    const { socket } = await ready();
    await transport.sendTyping('u1/default', 'voice');
    expect(socket.frames.at(-1)).toEqual({ type: 'typing', kind: 'voice' });
  });

  it('mídia em bytes sai por URL do transport; por URL, vai como veio', async () => {
    const { socket } = await ready();
    await transport.send('u1/default', {
      type: 'document',
      media: Buffer.from('pdf'),
      fileName: 'boletim 1.pdf',
      mimetype: 'application/pdf',
      caption: 'segue',
    });
    await transport.send('u1/default', { type: 'image', media: { url: 'https://cdn/x.png' } });

    const [doc, image] = socket.frames.slice(1);
    expect(image).toMatchObject({
      kind: 'image',
      media: { url: 'https://cdn/x.png', mimetype: 'application/octet-stream' },
    });
    expect(doc).toMatchObject({ kind: 'document', text: 'segue' });
    const url = doc?.type === 'message' ? (doc.media?.url ?? '') : '';
    expect(url).toMatch(/^\/transports\/web\/media\/[\w-]{22}$/);

    const id = url.split('/').at(-1) ?? '';
    const download = routes.handlers.get('GET /media/:id');
    const response = await download?.(new Request(`http://localhost${url}`), { params: { id } });
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-disposition')).toBe(
      "attachment; filename*=UTF-8''boletim%201.pdf",
    );
    expect(response?.headers.get('content-security-policy')).toBe('sandbox');
    expect(await response?.text()).toBe('pdf');
  });

  it('o que o web não declara lança UnsupportedError', async () => {
    await expect(
      transport.send('c', { type: 'sticker', media: Buffer.from('x') }),
    ).rejects.toMatchObject({ name: 'UnsupportedError', capability: 'send.sticker' });
    await expect(transport.react()).rejects.toMatchObject({ capability: 'reactions' });
    await expect(transport.getGroupMetadata()).rejects.toMatchObject({ capability: 'groups' });
    await expect(transport.updateGroupParticipants('g', [], 'add')).rejects.toMatchObject({
      capability: 'groups.add',
    });
  });
});

describe('WebTransport: conexão', () => {
  it('`connect()` emite `open` e define o `self`', async () => {
    make();
    const statuses: string[] = [];
    transport.on('connection.status', (s) => {
      statuses.push(s.status);
    });
    expect(transport.self).toBeNull();
    await transport.connect();
    expect(statuses).toEqual(['open']);
    expect(transport.self).toMatchObject({ id: 'bot', phone: null, isBot: true });
  });

  it('`disconnect()` fecha as conexões com 1001, recusa novas com 503 e o envio lança', async () => {
    const { socket } = await ready();
    await transport.disconnect();
    expect(socket.closed?.code).toBe(1001);
    const refused = await routes.accept?.(request(), { params: {} });
    expect(refused instanceof Response && refused.status).toBe(503);
    await expect(transport.send('u1/default', { type: 'text', text: 'x' })).rejects.toThrow(
      /desconectado/,
    );
    // Idempotente.
    await transport.disconnect();
  });

  it('com `origins`, só elas fazem upgrade e recebem CORS; sem `Origin`, passa', async () => {
    make({ origins: ['https://erp.exemplo.com'] });
    await transport.connect();
    const outra = await routes.accept?.(request({ origin: 'https://x.com' }), { params: {} });
    expect(outra instanceof Response && outra.status).toBe(403);
    await expect(open({ origin: 'https://erp.exemplo.com' })).resolves.toBeDefined();
    await expect(open()).resolves.toBeDefined();

    const preflight = routes.handlers.get('OPTIONS /media');
    const ok = await preflight?.(
      new Request('http://localhost/transports/web/media', {
        method: 'OPTIONS',
        headers: { origin: 'https://erp.exemplo.com' },
      }),
      { params: {} },
    );
    expect(ok?.headers.get('access-control-allow-origin')).toBe('https://erp.exemplo.com');
    expect(ok?.headers.get('access-control-allow-headers')).toContain('authorization');
  });
});
