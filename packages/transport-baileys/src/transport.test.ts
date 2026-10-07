import {
  type ConnectionStatus,
  createMemoryStorage,
  type Logger,
  type Message,
} from '@zapforge/core';
import type { AuthStateStore, TransportDeps } from '@zapforge/core/adapter';
import { DisconnectReason, type WAMessage } from 'baileys';
import { describe, expect, it, vi } from 'vitest';
import { boom, FakeDriver } from './fake-socket.test-support.ts';
import { type BaileysPairing, BaileysTransport } from './transport.ts';

interface LogLine {
  readonly level: string;
  readonly message: string;
}

function recordingLogger(lines: LogLine[] = []): Logger & { lines: LogLine[] } {
  const at =
    (level: string) =>
    (message: string): void => {
      lines.push({ level, message });
    };
  return {
    lines,
    level: 'trace',
    trace: at('trace'),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    fatal: at('fatal'),
    child: () => recordingLogger(lines),
  };
}

function setup(pairing: BaileysPairing = 'qr', auth?: AuthStateStore) {
  const driver = new FakeDriver();
  const log = recordingLogger();
  const deps: TransportDeps = {
    session: 'default',
    auth: auth ?? createMemoryStorage().authState('default'),
    log,
  };
  const transport = new BaileysTransport({ pairing, driver }, deps);
  const statuses: ConnectionStatus[] = [];
  const qrs: string[] = [];
  const codes: string[] = [];
  transport.on('connection.status', (status) => {
    statuses.push(status);
  });
  transport.on('connection.qr', ({ qr }) => {
    qrs.push(qr);
  });
  transport.on('connection.pairing-code', ({ code }) => {
    codes.push(code);
  });
  return { driver, deps, log, transport, statuses, qrs, codes };
}

const reasons = (statuses: ConnectionStatus[]): string[] =>
  statuses.flatMap((s) => (s.status === 'closed' ? [s.reason] : []));

describe('BaileysTransport: conexão', () => {
  it('não cria socket antes do connect()', () => {
    const { driver } = setup();
    expect(driver.sockets).toHaveLength(0);
  });

  it('connect() resolve com o socket criado, sem esperar o open (ADR 0048)', async () => {
    const { driver, transport, statuses } = setup();
    await transport.connect();

    expect(driver.sockets).toHaveLength(1);
    expect(driver.last.config.version).toEqual(driver.fixedVersion);
    expect(transport.native).toBe(driver.last);
    expect(statuses).toEqual([]);
  });

  it('repassa connecting e open; no open preenche o self com o telefone', async () => {
    const { driver, transport, statuses } = setup();
    await transport.connect();
    expect(transport.self).toBeNull();

    driver.last.emit('connection.update', { connection: 'connecting' });
    driver.last.user = { id: '5511999999999:12@s.whatsapp.net', name: 'Luma' };
    driver.last.emit('connection.update', { connection: 'open' });

    expect(statuses).toEqual([{ status: 'connecting' }, { status: 'open' }]);
    expect(transport.self).toEqual({
      id: '5511999999999@s.whatsapp.net',
      name: 'Luma',
      phone: '5511999999999',
    });
  });

  it('self com id em LID pega o telefone do phoneNumber', async () => {
    const { driver, transport } = setup();
    await transport.connect();
    driver.last.user = { id: '123:4@lid', phoneNumber: '5511888888888@s.whatsapp.net' };
    driver.last.emit('connection.update', { connection: 'open' });

    expect(transport.self).toEqual({ id: '123@lid', name: null, phone: '5511888888888' });
  });

  it('connect() rejeita se não dá para ler as credenciais', async () => {
    const auth = createMemoryStorage().authState('default');
    const failing: AuthStateStore = {
      ...auth,
      getCreds: () => Promise.reject(new Error('storage fechado')),
    };
    const { driver, transport } = setup('qr', failing);

    await expect(transport.connect()).rejects.toThrow('storage fechado');
    expect(driver.sockets).toHaveLength(0);
  });
});

describe('BaileysTransport: pareamento', () => {
  it('modo qr: cada QR vira connection.qr', async () => {
    const { driver, transport, qrs, codes } = setup('qr');
    await transport.connect();
    driver.last.emit('connection.update', { qr: 'QR-1' });
    driver.last.emit('connection.update', { qr: 'QR-2' });

    expect(qrs).toEqual(['QR-1', 'QR-2']);
    expect(codes).toEqual([]);
  });

  it('modo código: pede um código por tentativa e não emite QR', async () => {
    const { driver, transport, qrs, codes } = setup({ phone: '5511999999999' });
    await transport.connect();
    driver.last.emit('connection.update', { qr: 'QR-1' });
    driver.last.emit('connection.update', { qr: 'QR-2' });
    await vi.waitFor(() => expect(codes).toEqual(['ABCD1234']));

    expect(driver.last.pairingRequests).toEqual(['5511999999999']);
    expect(qrs).toEqual([]);
  });

  it('modo código: sessão já registrada não pede código', async () => {
    const { driver, transport, codes } = setup({ phone: '5511999999999' });
    await transport.connect();
    driver.last.config.auth.creds.registered = true;
    driver.last.emit('connection.update', { qr: 'QR-1' });
    await Promise.resolve();

    expect(driver.last.pairingRequests).toEqual([]);
    expect(codes).toEqual([]);
  });

  it('falha ao pedir o código vai para o log, sem derrubar nada', async () => {
    const { driver, transport, log, codes } = setup({ phone: '5511999999999' });
    await transport.connect();
    driver.last.pairingCode = Promise.reject(new Error('rede'));
    driver.last.emit('connection.update', { qr: 'QR-1' });

    await vi.waitFor(() =>
      expect(log.lines).toContainEqual({
        level: 'error',
        message: 'falha ao pedir o código de pareamento',
      }),
    );
    expect(codes).toEqual([]);
  });

  it('408 depois do QR é qr-timeout; 408 sem pareamento é queda de rede', async () => {
    const { driver, transport, statuses } = setup();
    await transport.connect();
    driver.last.emit('connection.update', { qr: 'QR-1' });
    driver.last.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: boom(DisconnectReason.timedOut), date: new Date() },
    });

    await transport.connect();
    driver.last.emit('connection.update', { connection: 'open' });
    driver.last.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: boom(DisconnectReason.connectionLost), date: new Date() },
    });

    expect(reasons(statuses)).toEqual(['qr-timeout', 'connection-lost']);
  });

  it('closed leva o erro nativo', async () => {
    const { driver, transport, statuses } = setup();
    await transport.connect();
    const error = boom(DisconnectReason.loggedOut);
    driver.last.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error, date: new Date() },
    });

    expect(statuses).toEqual([{ status: 'closed', reason: 'logged-out', error }]);
    expect(transport.native).toBeNull();
  });
});

describe('BaileysTransport: credenciais', () => {
  it('sessão nova começa com credenciais geradas, gravadas a cada creds.update', async () => {
    const auth = createMemoryStorage().authState('default');
    const { driver, transport } = setup('qr', auth);
    await transport.connect();
    const { creds } = driver.last.config.auth;
    expect(creds.noiseKey.private).toBeInstanceOf(Uint8Array);
    expect(await auth.getCreds()).toBeUndefined();

    driver.last.updateCreds({ registered: true });
    await vi.waitFor(async () => expect(await auth.getCreds()).toBeDefined());

    // Na próxima conexão, as mesmas credenciais voltam do storage, com os bytes intactos.
    await transport.connect();
    const reloaded = driver.last.config.auth.creds;
    expect(reloaded.registered).toBe(true);
    expect(Buffer.from(reloaded.noiseKey.private)).toEqual(Buffer.from(creds.noiseKey.private));
  });

  it('gravações seguem a ordem dos creds.update', async () => {
    const auth = createMemoryStorage().authState('default');
    const writes: unknown[] = [];
    const slow: AuthStateStore = {
      ...auth,
      setCreds: async (creds) => {
        // A primeira demora mais: sem fila, a segunda terminaria antes e seria sobrescrita.
        await new Promise((resolve) => setTimeout(resolve, writes.length === 0 ? 20 : 0));
        writes.push(creds);
        await auth.setCreds(creds);
      },
    };
    const { driver, transport } = setup('qr', slow);
    await transport.connect();
    driver.last.updateCreds({ registered: false });
    driver.last.updateCreds({ registered: true });

    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(await auth.getCreds()).toMatchObject({ registered: true });
  });

  it('falha ao gravar credenciais vai para o log', async () => {
    const auth = createMemoryStorage().authState('default');
    const failing: AuthStateStore = {
      ...auth,
      setCreds: () => Promise.reject(new Error('disco cheio')),
    };
    const { driver, transport, log } = setup('qr', failing);
    await transport.connect();
    driver.last.updateCreds({ registered: true });

    await vi.waitFor(() =>
      expect(log.lines).toContainEqual({
        level: 'error',
        message: 'falha ao gravar as credenciais da sessão',
      }),
    );
  });

  it('chaves vão e voltam do storage; null apaga', async () => {
    const auth = createMemoryStorage().authState('default');
    const { driver, transport } = setup('qr', auth);
    await transport.connect();
    const { keys } = driver.last.config.auth;
    const preKey = { public: new Uint8Array([1, 2, 3]), private: new Uint8Array([4, 5, 6]) };

    await keys.set({ 'pre-key': { '1': preKey, '2': preKey } });
    const read = await keys.get('pre-key', ['1', '2', '3']);
    expect(Object.keys(read)).toEqual(['1', '2']);
    expect(Buffer.from(read['1']?.private ?? [])).toEqual(Buffer.from([4, 5, 6]));

    await keys.set({ 'pre-key': { '1': null } });
    expect(Object.keys(await keys.get('pre-key', ['1', '2']))).toEqual(['2']);
  });

  it('app-state-sync-key volta como instância do protobuf', async () => {
    const { driver, transport } = setup();
    await transport.connect();
    const { keys } = driver.last.config.auth;
    await keys.set({
      'app-state-sync-key': { k: { keyData: new Uint8Array([7, 8]), timestamp: 1 } },
    });

    const { k } = await keys.get('app-state-sync-key', ['k']);
    expect(k?.constructor.name).toBe('AppStateSyncKeyData');
    expect(Buffer.from(k?.keyData ?? [])).toEqual(Buffer.from([7, 8]));
  });
});

describe('BaileysTransport: reconexão e desconexão', () => {
  it('connect() de reconexão cria outro socket; o anterior deixa de valer', async () => {
    const { driver, transport, statuses, qrs } = setup();
    await transport.connect();
    const old = driver.last;
    old.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: boom(DisconnectReason.restartRequired), date: new Date() },
    });
    await transport.connect();

    old.emit('connection.update', { qr: 'velho' });
    old.emit('connection.update', { connection: 'open' });
    driver.last.emit('connection.update', { connection: 'open' });

    expect(driver.sockets).toHaveLength(2);
    expect(qrs).toEqual([]);
    expect(statuses).toEqual([
      { status: 'closed', reason: 'connection-lost', error: expect.any(Error) },
      { status: 'open' },
    ]);
  });

  it('connect() com socket ainda de pé encerra o anterior', async () => {
    const { driver, transport } = setup();
    await transport.connect();
    const old = driver.last;
    await transport.connect();

    expect(old.ended).toBe(true);
    expect(transport.native).toBe(driver.last);
  });

  it('disconnect() encerra o socket sem emitir nada depois', async () => {
    const { driver, transport, statuses } = setup();
    await transport.connect();
    const socket = driver.last;
    await transport.disconnect();
    socket.emit('connection.update', { connection: 'close', lastDisconnect: undefined });

    expect(socket.ended).toBe(true);
    expect(statuses).toEqual([]);
    expect(transport.native).toBeNull();
  });

  it('disconnect() é idempotente e seguro sem connect()', async () => {
    const { transport } = setup();
    await transport.disconnect();
    await transport.connect();
    await transport.disconnect();
    await expect(transport.disconnect()).resolves.toBeUndefined();
  });

  it('disconnect() durante o connect() não deixa socket aberto', async () => {
    const auth = createMemoryStorage().authState('default');
    let release: (() => void) | undefined;
    const slow: AuthStateStore = {
      ...auth,
      getCreds: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return auth.getCreds();
      },
    };
    const { driver, transport } = setup('qr', slow);
    const connecting = transport.connect();
    await vi.waitFor(() => expect(release).toBeDefined());
    await transport.disconnect();
    release?.();
    await connecting;

    expect(driver.sockets).toHaveLength(0);
    expect(transport.native).toBeNull();
  });
});

describe('BaileysTransport: mensagens recebidas', () => {
  const GROUP = '120363000000000001@g.us';
  const text = (id: string, key: Partial<WAMessage['key']> = {}): WAMessage => ({
    key: { remoteJid: 'a@s.whatsapp.net', id, fromMe: false, ...key },
    message: { conversation: id },
    messageTimestamp: 1_760_000_000,
  });

  async function connected() {
    const ctx = setup();
    const messages: Message[] = [];
    ctx.transport.on('message', (message) => {
      messages.push(message);
    });
    await ctx.transport.connect();
    return { ...ctx, messages, socket: ctx.driver.last };
  }

  it('messages.upsert notify vira message normalizada', async () => {
    const { socket, messages } = await connected();
    socket.emit('messages.upsert', {
      type: 'notify',
      messages: [
        { ...text('M1'), message: { ephemeralMessage: { message: { conversation: 'oi' } } } },
      ],
    });
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0]).toMatchObject({ type: 'text', id: 'M1', text: 'oi' });
  });

  it('mantém a ordem de chegada mesmo com o telefone de um LID demorando', async () => {
    const { socket, messages } = await connected();
    let release: (() => void) | undefined;
    socket.signalRepository.lidMapping.getPNForLID = () =>
      new Promise((resolve) => {
        release = () => resolve('5511911110000@s.whatsapp.net');
      });
    socket.emit('messages.upsert', {
      type: 'notify',
      messages: [text('M1', { remoteJid: GROUP, participant: '1@lid' }), text('M2')],
    });
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(messages).toEqual([]);

    release?.();
    await vi.waitFor(() => expect(messages.map((m) => m.id)).toEqual(['M1', 'M2']));
    expect(messages[0]?.sender.phone).toBe('5511911110000');
  });

  it('ignora append (histórico), status e o que não é mensagem', async () => {
    const { socket, messages } = await connected();
    socket.emit('messages.upsert', { type: 'append', messages: [text('H1')] });
    socket.emit('messages.upsert', {
      type: 'notify',
      messages: [
        text('S1', { remoteJid: 'status@broadcast', participant: 'a@s.whatsapp.net' }),
        { ...text('R1'), message: { reactionMessage: { text: '👍' } } },
        text('M1'),
      ],
    });
    await vi.waitFor(() => expect(messages.map((m) => m.id)).toEqual(['M1']));
  });

  it('falha ao resolver LID loga e entrega com phone null', async () => {
    const { socket, messages, log } = await connected();
    socket.signalRepository.lidMapping.getPNForLID = () => Promise.reject(new Error('banco'));
    socket.emit('messages.upsert', {
      type: 'notify',
      messages: [text('M1', { remoteJid: GROUP, participant: '1@lid' })],
    });
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0]?.sender).toMatchObject({ id: '1@lid', phone: null });
    expect(log.lines).toContainEqual({
      level: 'warn',
      message: 'falha ao resolver o telefone de um LID',
    });
  });

  it('falha na normalização descarta só aquela mensagem e vai para o log', async () => {
    const { socket, messages, log } = await connected();
    const broken = text('X1');
    Object.defineProperty(broken, 'message', {
      get() {
        throw new Error('proto malformado');
      },
    });
    socket.emit('messages.upsert', { type: 'notify', messages: [broken, text('M2')] });
    await vi.waitFor(() => expect(messages.map((m) => m.id)).toEqual(['M2']));
    expect(log.lines).toContainEqual({
      level: 'error',
      message: 'falha ao normalizar mensagem do Baileys; descartada',
    });
  });

  it('mensagens do socket anterior deixam de valer depois da reconexão', async () => {
    const { driver, transport, messages } = await connected();
    const old = driver.last;
    await transport.connect();
    old.emit('messages.upsert', { type: 'notify', messages: [text('OLD')] });
    driver.last.emit('messages.upsert', { type: 'notify', messages: [text('NEW')] });
    await vi.waitFor(() => expect(messages.map((m) => m.id)).toEqual(['NEW']));
  });
});

describe('BaileysTransport: ações ainda não suportadas', () => {
  it('sem capabilities declaradas, as ações lançam UnsupportedError', async () => {
    const { transport } = setup();
    expect(transport.capabilities.size).toBe(0);
    await expect(transport.send('x@s.whatsapp.net', { type: 'text', text: 'oi' })).rejects.toThrow(
      expect.objectContaining({ name: 'UnsupportedError', capability: 'send.text' }),
    );
    await expect(transport.getGroupMetadata('g@g.us')).rejects.toThrow(
      expect.objectContaining({ capability: 'groups' }),
    );
  });
});
