// Aceite do #287 (ADR 0077), de ponta a ponta: bot real, HTTP do core numa porta livre e o cliente
// de referência pelo WebSocket e pelo `fetch` globais do Node.

import { request } from 'node:http';
import {
  type Bot,
  type BotConfig,
  command,
  createBot,
  createHttp,
  createLogger,
  createMemoryStorage,
  definePlugin,
  type HttpServer,
  type Message,
  type Transport,
} from '@zapforge/core';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectWebChat, type WebChatClient } from './client.ts';
import { web } from './index.ts';
import type { ServerMessageFrame } from './protocol.ts';

const SECRET = 'segredo-de-teste-com-pelo-menos-32-bytes';
const ENGINE = '>=0.0.0';
const bots: Bot[] = [];
const clients: WebChatClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const created of bots.splice(0)) await created.stop();
});

function token(
  claims: Record<string, unknown> = {},
  { sub = 'u1', expiresIn = '1h', secret = SECRET } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

interface Started {
  readonly bot: Bot;
  readonly http: HttpServer;
  readonly transport: () => Transport;
  readonly url: string;
}

async function start(
  config: Partial<BotConfig> = {},
  options: Partial<Parameters<typeof web>[0]> = {},
): Promise<Started> {
  const http = createHttp({ port: 0, hostname: '127.0.0.1' });
  const factory = web({ auth: { secret: SECRET }, ...options });
  let transport: Transport | undefined;
  const bot = createBot({
    transport: (deps) => {
      transport = factory(deps);
      return transport;
    },
    http,
    storage: createMemoryStorage(),
    logger: createLogger({ level: 'silent' }),
    outbound: { globalIntervalMs: 0, chatIntervalMs: 0 },
    env: {},
    prefix: '!',
    ...config,
  });
  bots.push(bot);
  await bot.start();
  return {
    bot,
    http,
    transport: () => transport as Transport,
    url: `ws://127.0.0.1:${http.port}/transports/web/chat`,
  };
}

async function connect(
  url: string,
  jwt: string | Promise<string>,
  conversation?: string,
): Promise<{ client: WebChatClient; messages: ServerMessageFrame[] }> {
  const client = await connectWebChat({
    url,
    token: await jwt,
    ...(conversation === undefined ? null : { conversation }),
  });
  clients.push(client);
  const messages: ServerMessageFrame[] = [];
  client.on('message', (frame) => messages.push(frame));
  return { client, messages };
}

/** O plugin portátil do aceite: roda igual no Baileys (ver o teste lá), sem saber do transport. */
const portable = definePlugin({
  name: 'portatil',
  version: '1.0.0',
  engine: ENGINE,
  setup(ctx) {
    ctx.commands.add(command({ name: 'ping', run: (c) => c.reply('pong') }));
    ctx.commands.add(
      command({
        name: 'menu',
        run: (c) =>
          c.reply('Escolha:', {
            actions: [
              { label: 'Ping', command: 'ping' },
              { label: 'Eco', command: 'eco', args: ['clicado'] },
            ],
          }),
      }),
    );
    ctx.commands.add(command({ name: 'eco', run: (c) => c.reply(`eco ${c.rawArgs}`) }));
  },
});

describe('transport-web no Bot', () => {
  it('plugin portátil: !ping responde e o menu chega com botões que rodam o comando', async () => {
    const { url } = await start({ plugins: [portable] });
    const { client, messages } = await connect(url, token());

    await client.send('!ping');
    await vi.waitFor(() => expect(messages.map((m) => m.text)).toEqual(['pong']));
    // A resposta cita a mensagem do usuário (`quoted`).
    expect(messages[0]?.quotedId).toBeDefined();

    await client.send('!menu');
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    const menu = messages[1] as ServerMessageFrame;
    expect(menu.text).toBe('Escolha:');
    expect(menu.actions?.map((a) => a.label)).toEqual(['Ping', 'Eco']);

    client.click(menu.actions?.[1]?.id ?? '');
    await vi.waitFor(() => expect(messages.at(-1)?.text).toBe('eco clicado'));
  });

  it('claims e tenant chegam ao plugin, e dois tenants não leem os dados um do outro', async () => {
    const seen: Message[] = [];
    const notas = definePlugin({
      name: 'notas',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'guardar',
            run: async (c) => {
              seen.push(c.message);
              await ctx.storage.kv.set('nota', c.rawArgs);
              await c.reply('ok');
            },
          }),
        );
        ctx.commands.add(
          command({
            name: 'ler',
            run: async (c) => {
              seen.push(c.message);
              const role = c.message.sender.claims?.['role'];
              await c.reply(`${role}: ${(await ctx.storage.kv.get<string>('nota')) ?? 'nada'}`);
            },
          }),
        );
      },
    });
    const { url } = await start({ plugins: [notas] }, { tenantClaim: 'escola' });
    const jwtA = await token({ escola: 'a', role: 'professor', name: 'Ana' });
    const a = await connect(url, jwtA);
    // O mesmo `sub` em outra escola é outra pessoa.
    const b = await connect(url, token({ escola: 'b', role: 'aluno' }));

    await a.client.send('!guardar prova sexta');
    await vi.waitFor(() => expect(a.messages).toHaveLength(1));
    await b.client.send('!ler');
    await vi.waitFor(() => expect(b.messages.map((m) => m.text)).toEqual(['aluno: nada']));
    await a.client.send('!ler');
    await vi.waitFor(() => expect(a.messages.at(-1)?.text).toBe('professor: prova sexta'));

    const [first] = seen;
    expect(first?.chat).toMatchObject({ id: 'a:u1/default', tenantId: 'a', kind: 'dm' });
    expect(first?.sender).toMatchObject({ id: 'a:u1', name: 'Ana', phone: null });
    expect(first?.sender.claims).toMatchObject({ escola: 'a', role: 'professor', sub: 'u1' });
    expect(a.client.chatId).toBe('a:u1/default');
    expect(b.client.chatId).toBe('b:u1/default');
    // O token não fica em lugar nenhum do que chega ao plugin.
    for (const message of seen) expect(JSON.stringify(message)).not.toContain(jwtA);
  });

  it('cada conversa é um chat: a resposta só vai para a conversa de onde veio', async () => {
    const { url } = await start({ plugins: [portable] });
    const jwt = await token();
    const orcamento = await connect(url, jwt, 'orcamento-42');
    const geral = await connect(url, jwt);
    expect(orcamento.client.chatId).toBe('u1/orcamento-42');

    await orcamento.client.send('!ping');
    await vi.waitFor(() => expect(orcamento.messages).toHaveLength(1));
    expect(geral.messages).toEqual([]);
  });

  it('duas abas na mesma conversa recebem a mesma resposta', async () => {
    const { url } = await start({ plugins: [portable] });
    const jwt = await token();
    const aba1 = await connect(url, jwt);
    const aba2 = await connect(url, jwt);

    await aba1.client.send('!ping');
    await vi.waitFor(() => expect(aba2.messages.map((m) => m.text)).toEqual(['pong']));
    expect(aba1.messages.map((m) => m.text)).toEqual(['pong']);
  });

  it('o que foi enviado com o cliente fora chega quando ele conecta, em ordem', async () => {
    const { url, transport } = await start();
    // Sem ninguém na conversa (o fechamento de uma aba é coberto em transport.test.ts).
    await transport().send('u1/default', { type: 'text', text: 'um' });
    await transport().send('u1/default', { type: 'text', text: 'dois' });

    const { messages } = await connect(url, token());
    await vi.waitFor(() => expect(messages.map((m) => m.text)).toEqual(['um', 'dois']));
  });

  it('mídia: o upload chega ao plugin, e a mídia do bot sai por URL', async () => {
    const received: Message[] = [];
    const espelho = definePlugin({
      name: 'espelho',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.events.on('message:image', async (c) => {
          received.push(c.message);
          const bytes = await c.message.media.download();
          await c.reply.image(Buffer.concat([bytes, Buffer.from('!')]), {
            caption: c.message.text ?? '',
            mimetype: 'image/png',
          });
        });
      },
    });
    const { url } = await start({ plugins: [espelho] });
    const { client, messages } = await connect(url, token());

    const id = await client.upload(Buffer.from('png'), 'image/png', 'foto.png');
    await client.send('olha', { attachments: [id] });
    await vi.waitFor(() => expect(messages).toHaveLength(1));

    const image = received[0];
    expect(image?.type).toBe('image');
    expect(image?.text).toBe('olha');
    expect(image?.attachments[0]).toMatchObject({ mimetype: 'image/png', fileName: 'foto.png' });

    const reply = messages[0] as ServerMessageFrame;
    expect(reply).toMatchObject({ kind: 'image', text: 'olha', media: { mimetype: 'image/png' } });
    const response = await fetch(client.mediaUrl(reply) ?? '');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('png!');
  });

  it('o upload só serve a quem o fez, uma vez, e não sai pela URL de download', async () => {
    const { url, http } = await start({ plugins: [portable] });
    const dono = await connect(url, token());
    const outro = await connect(url, token({}, { sub: 'u2' }));
    const errors: string[] = [];
    outro.client.on('error', (frame) => errors.push(frame.code));

    const id = await dono.client.upload(Buffer.from('x'), 'text/plain');
    outro.client.click('nada'); // ação desconhecida: o kernel descarta, sem erro de protocolo
    void outro.client.send('roubei', { attachments: [id] });
    await vi.waitFor(() => expect(errors).toEqual(['media-not-found']));

    const download = await fetch(`http://127.0.0.1:${http.port}/transports/web/media/${id}`);
    expect(download.status).toBe(404);
  });

  it('upload sem token, com token inválido ou grande demais é recusado', async () => {
    const { http } = await start({}, { media: { maxBytes: 4 } });
    const media = `http://127.0.0.1:${http.port}/transports/web/media`;
    const post = async (headers: Record<string, string>, body = 'abc') =>
      (await fetch(media, { method: 'POST', headers, body })).status;

    expect(await post({ 'content-type': 'text/plain' })).toBe(401);
    const forged = await token({}, { secret: 'outro-segredo-com-pelo-menos-32-bytes!!' });
    expect(await post({ authorization: `Bearer ${forged}`, 'content-type': 'text/plain' })).toBe(
      401,
    );
    const valid = `Bearer ${await token()}`;
    expect(await post({ authorization: valid, 'content-type': 'text/plain' }, 'abcde')).toBe(413);
    expect(await post({ authorization: valid, 'content-type': 'text/plain' })).toBe(201);
  });

  describe('autenticação', () => {
    async function refused(url: string, jwt: string | Promise<string>): Promise<string> {
      const error = await connectWebChat({ url, token: await jwt }).catch((e: Error) => e);
      return error instanceof Error ? error.message : 'conectou';
    }

    it('JWT com outra assinatura, vencido ou sem `sub` é recusado com 4401', async () => {
      const { url } = await start();
      expect(await refused(url, token({}, { secret: 'x'.repeat(32) }))).toMatch(/4401/);
      expect(await refused(url, token({}, { expiresIn: '-1m' }))).toMatch(/4401/);
      expect(await refused(url, 'não.é.jwt')).toMatch(/4401/);
      const semSub = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(SECRET));
      expect(await refused(url, semSub)).toMatch(/4401/);
    });

    it('sem o claim de tenant configurado, recusa com 4403', async () => {
      const { url } = await start({}, { tenantClaim: 'empresa' });
      expect(await refused(url, token())).toMatch(/4403/);
      expect(await refused(url, token({ empresa: '' }))).toMatch(/4403/);
    });

    it('origem fora da lista é recusada no upgrade', async () => {
      const { http } = await start({}, { origins: ['https://erp.exemplo.com'] });
      // O `fetch` não manda `Upgrade`; o pedido de upgrade sai pelo `node:http`.
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(`http://127.0.0.1:${http.port}/transports/web/chat`, {
          headers: {
            origin: 'https://outro.exemplo.com',
            connection: 'Upgrade',
            upgrade: 'websocket',
            'sec-websocket-version': '13',
            'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
          },
        });
        req.on('response', (response) => {
          response.resume();
          resolve(response.statusCode);
        });
        req.on('upgrade', () => reject(new Error('o upgrade passou')));
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(403);
    });
  });

  it('sem `http` no bot, o createBot recusa o transport', () => {
    expect(() =>
      createBot({
        transport: web({ auth: { secret: SECRET } }),
        logger: createLogger({ level: 'silent' }),
        env: {},
      }),
    ).toThrow(expect.objectContaining({ name: 'BotConfigError' }));
  });
});
