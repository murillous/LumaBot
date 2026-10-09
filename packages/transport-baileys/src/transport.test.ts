import {
  type ConnectionStatus,
  createMemoryStorage,
  type Logger,
  type Message,
} from '@zapforge/core';
import { type AuthStateStore, CAPABILITIES, type TransportDeps } from '@zapforge/core/adapter';
import { DisconnectReason, type WAMessage, WAMessageStubType } from 'baileys';
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

  it('chave lida uma vez fica em cache; gravação vai ao storage', async () => {
    const auth = createMemoryStorage().authState('default');
    const reads: string[][] = [];
    const counting: AuthStateStore = {
      ...auth,
      getKeys: (type, ids) => {
        reads.push([...ids]);
        return auth.getKeys(type, ids);
      },
    };
    const preKey = { public: new Uint8Array([1]), private: new Uint8Array([2]) };
    await auth.setKeys({ 'pre-key': { '1': { public: 'x', private: 'y' } } });
    const { driver, transport } = setup('qr', counting);
    await transport.connect();
    const { keys } = driver.last.config.auth;

    await keys.get('pre-key', ['1']);
    await keys.get('pre-key', ['1']);
    expect(reads).toEqual([['1']]);

    await keys.set({ 'pre-key': { '2': preKey } });
    expect(await keys.get('pre-key', ['2'])).toHaveProperty('2');
    expect(reads).toEqual([['1']]);
    expect(Object.keys(await auth.getKeys('pre-key', ['2']))).toEqual(['2']);
  });

  it('o cache é da tentativa: depois de limpar a sessão, a próxima não vê as chaves antigas', async () => {
    const auth = createMemoryStorage().authState('default');
    const { driver, transport } = setup('qr', auth);
    await transport.connect();
    const preKey = { public: new Uint8Array([1]), private: new Uint8Array([2]) };
    await driver.last.config.auth.keys.set({ 'pre-key': { '1': preKey } });

    await auth.clear();
    await transport.connect();
    expect(await driver.last.config.auth.keys.get('pre-key', ['1'])).toEqual({});
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

describe('BaileysTransport: eventos (M2-1.6)', () => {
  const GROUP = '120363000000000001@g.us';
  const ALICE = '5511911110000@s.whatsapp.net';
  const text = (id: string, pushName?: string): WAMessage => ({
    key: { remoteJid: GROUP, id, fromMe: false, participant: ALICE },
    message: { conversation: id },
    messageTimestamp: 1_760_000_000,
    ...(pushName === undefined ? {} : { pushName }),
  });

  async function connected() {
    const ctx = setup();
    const seen: string[] = [];
    const record =
      (event: string) =>
      (payload: unknown): void => {
        // Os eventos de grupo identificam o grupo pelo `chat` (ADR 0059); os demais, pelos ids.
        const keys = event.startsWith('group.') ? ['chat', 'id'] : ['id', 'name', 'messageId'];
        seen.push(`${event} ${JSON.stringify(payload, keys)}`);
      };
    for (const event of [
      'message',
      'message.edited',
      'message.deleted',
      'reaction',
      'group.joined',
      'group.left',
      'group.participants',
      'group.updated',
      'contact.updated',
    ] as const) {
      ctx.transport.on(event, record(event));
    }
    await ctx.transport.connect();
    return { ...ctx, seen, socket: ctx.driver.last };
  }

  it('contact.updated sai antes da mensagem na primeira vez e quando o nome muda', async () => {
    const { socket, seen } = await connected();
    socket.emit('messages.upsert', {
      type: 'notify',
      messages: [text('M1', 'Alice'), text('M2', 'Alice'), text('M3', 'Alice B.')],
    });
    await vi.waitFor(() => expect(seen).toHaveLength(5));
    expect(seen).toEqual([
      `contact.updated {"id":"${ALICE}","name":"Alice"}`,
      'message {"id":"M1"}',
      'message {"id":"M2"}',
      `contact.updated {"id":"${ALICE}","name":"Alice B."}`,
      'message {"id":"M3"}',
    ]);
  });

  it('mensagem da própria sessão não registra contato', async () => {
    const { socket, seen } = await connected();
    socket.emit('messages.upsert', {
      type: 'notify',
      messages: [{ ...text('M1', 'Eu'), key: { remoteJid: ALICE, id: 'M1', fromMe: true } }],
    });
    await vi.waitFor(() => expect(seen).toEqual(['message {"id":"M1"}']));
  });

  it('reação, edição e apagamento seguem a ordem de chegada das mensagens', async () => {
    const { socket, seen } = await connected();
    socket.signalRepository.lidMapping.getPNForLID = () =>
      new Promise((resolve) => setTimeout(() => resolve(null), 20));
    socket.emit('messages.upsert', {
      type: 'notify',
      messages: [{ ...text('M1'), key: { remoteJid: GROUP, id: 'M1', participant: '1@lid' } }],
    });
    socket.emit('messages.update', [
      {
        key: { remoteJid: GROUP, id: 'M1', participant: ALICE },
        update: { message: { editedMessage: { message: { conversation: 'novo' } } } },
      },
      // Recibo de leitura: sem evento.
      { key: { remoteJid: GROUP, id: 'M1', participant: ALICE }, update: { status: 4 } },
    ]);
    socket.emit('messages.reaction', [
      {
        key: { remoteJid: GROUP, id: 'M1' },
        reaction: { text: '👍', key: { remoteJid: GROUP, id: 'R1', participant: ALICE } },
      },
    ]);
    socket.emit('messages.update', [
      {
        key: { remoteJid: GROUP, id: 'M1', participant: ALICE },
        update: {
          message: null,
          messageStubType: WAMessageStubType.REVOKE,
          key: { remoteJid: GROUP, id: 'X', participant: ALICE },
        },
      },
    ]);
    await vi.waitFor(() => expect(seen).toHaveLength(4));
    expect(seen).toEqual([
      'message {"id":"M1"}',
      'message.edited {"id":"M1"}',
      'reaction {"messageId":"M1"}',
      'message.deleted {"messageId":"M1"}',
    ]);
  });

  it('grupos: criado com a sessão, participantes, alteração e saída', async () => {
    const { socket, seen } = await connected();
    socket.updateCreds({ me: { id: '5511999990000:3@s.whatsapp.net' } });
    socket.emit('groups.upsert', [{ id: GROUP, subject: 'Novo', owner: ALICE, participants: [] }]);
    socket.emit('group-participants.update', {
      id: GROUP,
      author: ALICE,
      participants: [{ id: '2@s.whatsapp.net' }],
      action: 'add',
    });
    socket.emit('groups.update', [
      { id: GROUP, subject: 'Renomeado' },
      // Sincronização com os metadados completos: não é alteração.
      { id: GROUP, subject: 'Renomeado', participants: [] },
    ]);
    socket.emit('group-participants.update', {
      id: GROUP,
      author: ALICE,
      participants: [{ id: '5511999990000@s.whatsapp.net' }],
      action: 'remove',
    });
    await vi.waitFor(() => expect(seen).toHaveLength(4));
    expect(seen).toEqual([
      `group.joined {"chat":{"id":"${GROUP}"}}`,
      `group.participants {"chat":{"id":"${GROUP}"}}`,
      `group.updated {"chat":{"id":"${GROUP}"}}`,
      `group.left {"chat":{"id":"${GROUP}"}}`,
    ]);
  });

  it('eventos do socket anterior deixam de valer depois da reconexão', async () => {
    const { driver, transport, seen } = await connected();
    const old = driver.last;
    await transport.connect();
    old.emit('messages.reaction', [
      {
        key: { remoteJid: GROUP, id: 'M1' },
        reaction: { text: '👍', key: { remoteJid: GROUP, id: 'R1', participant: ALICE } },
      },
    ]);
    old.emit('groups.update', [{ id: GROUP, subject: 'Velho' }]);
    driver.last.emit('groups.update', [{ id: GROUP, subject: 'Novo' }]);
    await vi.waitFor(() => expect(seen).toEqual([`group.updated {"chat":{"id":"${GROUP}"}}`]));
  });

  it('falha na conversão descarta só aquele evento e vai para o log', async () => {
    const { socket, seen, log } = await connected();
    socket.signalRepository.lidMapping.getPNForLID = () => Promise.reject(new Error('banco'));
    const broken = { remoteJid: GROUP, id: 'R1', participant: '1@lid' };
    Object.defineProperty(broken, 'fromMe', {
      get() {
        throw new Error('proto malformado');
      },
    });
    socket.emit('messages.reaction', [
      { key: { remoteJid: GROUP, id: 'M1' }, reaction: { text: '👍', key: broken } },
    ]);
    socket.emit('groups.update', [{ id: GROUP, subject: 'Novo' }]);
    await vi.waitFor(() => expect(seen).toEqual([`group.updated {"chat":{"id":"${GROUP}"}}`]));
    expect(log.lines).toContainEqual({
      level: 'error',
      message: 'falha ao converter reação do Baileys; descartada',
    });
  });
});

describe('BaileysTransport: capabilities', () => {
  it('declara as capabilities iniciais do Baileys (plano §6.10): todas as do core', () => {
    const { transport } = setup();
    expect([...transport.capabilities].sort()).toEqual([...CAPABILITIES].sort());
  });
});

describe('BaileysTransport: envio e ações', () => {
  const GROUP = '120363000000000001@g.us';
  const ALICE = '5511911110000@s.whatsapp.net';

  async function open() {
    const ctx = setup();
    await ctx.transport.connect();
    const socket = ctx.driver.last;
    socket.user = { id: '5511999990000:7@s.whatsapp.net' };
    socket.emit('connection.update', { connection: 'open' });
    return { ...ctx, socket };
  }

  it('send devolve a chave da mensagem criada; em grupo o autor é a sessão', async () => {
    const { transport, socket } = await open();

    const dm = await transport.send(ALICE, { type: 'text', text: 'oi' });
    const group = await transport.send(GROUP, { type: 'voice', media: Buffer.from('ogg') });

    expect(dm).toEqual({ chatId: ALICE, id: 'SENT-1', fromMe: true, senderId: null });
    expect(group).toEqual({
      chatId: GROUP,
      id: 'SENT-2',
      fromMe: true,
      senderId: '5511999990000@s.whatsapp.net',
    });
    expect(socket.sent.map((s) => [s.jid, s.content])).toEqual([
      [ALICE, { text: 'oi' }],
      [GROUP, { audio: Buffer.from('ogg'), ptt: true }],
    ]);
  });

  it('citar uma mensagem recebida manda o proto original ao Baileys, com as menções', async () => {
    const { transport, socket } = await open();
    const received: Message[] = [];
    transport.on('message', (m) => {
      received.push(m);
    });
    const raw: WAMessage = {
      key: { remoteJid: GROUP, id: 'IN1', fromMe: false, participant: ALICE },
      message: { conversation: '!foto' },
      messageTimestamp: 1_760_000_000,
    };
    socket.emit('messages.upsert', { type: 'notify', messages: [raw] });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    const [message] = received;
    if (!message) throw new Error('esperava mensagem');

    await transport.send(
      GROUP,
      { type: 'text', text: '@alice' },
      { quoted: message, mentions: [ALICE] },
    );

    expect(socket.sent[0]).toEqual({
      jid: GROUP,
      content: { text: '@alice', mentions: [ALICE] },
      options: { quoted: raw },
    });
  });

  it('envio sem chave de volta falha em vez de devolver chave inventada', async () => {
    const { transport, socket } = await open();
    socket.sendMessage = async () => undefined;
    await expect(transport.send(ALICE, { type: 'text', text: 'oi' })).rejects.toThrow(
      'não devolveu a chave',
    );
  });

  it('react, edit e delete agem sobre a chave; reação null vira texto vazio', async () => {
    const { transport, socket } = await open();
    const key = { chatId: GROUP, id: 'M1', fromMe: false, senderId: ALICE };
    const waKey = { remoteJid: GROUP, id: 'M1', fromMe: false, participant: ALICE };

    await transport.react(key, '👍');
    await transport.react(key, null);
    await transport.edit({ ...key, fromMe: true, senderId: null }, 'corrigido');
    await transport.delete(key);

    expect(socket.sent.map((s) => s.content)).toEqual([
      { react: { text: '👍', key: waKey } },
      { react: { text: '', key: waKey } },
      { text: 'corrigido', edit: { remoteJid: GROUP, id: 'M1', fromMe: true } },
      { delete: waKey },
    ]);
    expect(socket.sent.every((s) => s.jid === GROUP)).toBe(true);
  });

  it('sendPresence repassa o estado para o chat', async () => {
    const { transport, socket } = await open();
    await transport.sendPresence(ALICE, 'composing');
    expect(socket.presences).toEqual([{ type: 'composing', jid: ALICE }]);
  });

  it('sem conexão, as ações falham na hora', async () => {
    const { transport } = setup();
    await expect(transport.send(ALICE, { type: 'text', text: 'oi' })).rejects.toThrow(
      'sem conexão',
    );
    await expect(transport.sendPresence(ALICE, 'paused')).rejects.toThrow('sem conexão');
    await expect(transport.getGroupMetadata(GROUP)).rejects.toThrow('sem conexão');
  });

  it('updateGroupParticipants repassa a ação; recusa de algum participante lança', async () => {
    const { transport, socket } = await open();
    socket.participantStatus.set('2@s.whatsapp.net', '403');

    await transport.updateGroupParticipants(GROUP, ['1@s.whatsapp.net'], 'promote');
    await expect(
      transport.updateGroupParticipants(GROUP, ['1@s.whatsapp.net', '2@s.whatsapp.net'], 'remove'),
    ).rejects.toThrow('remove recusado para 2@s.whatsapp.net (403)');

    expect(socket.groupUpdates).toEqual([
      { jid: GROUP, participants: ['1@s.whatsapp.net'], action: 'promote' },
      { jid: GROUP, participants: ['1@s.whatsapp.net', '2@s.whatsapp.net'], action: 'remove' },
    ]);
  });
});

describe('BaileysTransport: metadados de grupo (ADR 0046)', () => {
  const GROUP = '120363000000000001@g.us';
  const LID = '111@lid';

  async function open() {
    const ctx = setup();
    await ctx.transport.connect();
    const socket = ctx.driver.last;
    socket.groups.set(GROUP, {
      id: GROUP,
      subject: 'Família',
      owner: undefined,
      participants: [{ id: LID, admin: 'admin' }],
    });
    socket.lids.set(LID, '5511911110000@s.whatsapp.net');
    return { ...ctx, socket };
  }

  it('converte para o core com o telefone do LID e consulta o servidor uma vez', async () => {
    const { transport, socket } = await open();

    const [a, b] = await Promise.all([
      transport.getGroupMetadata(GROUP),
      transport.getGroupMetadata(GROUP),
    ]);
    await transport.getGroupMetadata(GROUP);

    expect(a).toEqual({
      id: GROUP,
      title: 'Família',
      description: null,
      ownerId: null,
      participants: [
        { id: LID, name: null, phone: '5511911110000', isAdmin: true, isSuperAdmin: false },
      ],
    });
    expect(b).toEqual(a);
    expect(socket.groupQueries).toEqual([GROUP]);
  });

  it('eventos de grupo do Baileys e a alteração de participantes invalidam o cache', async () => {
    const { transport, socket } = await open();
    await transport.getGroupMetadata(GROUP);

    socket.emit('group-participants.update', {
      id: GROUP,
      author: LID,
      participants: [],
      action: 'add',
    });
    await transport.getGroupMetadata(GROUP);
    socket.emit('groups.update', [{ id: GROUP, subject: 'Novo' }]);
    await transport.getGroupMetadata(GROUP);
    await transport.updateGroupParticipants(GROUP, ['2@s.whatsapp.net'], 'add');
    await transport.getGroupMetadata(GROUP);

    expect(socket.groupQueries).toHaveLength(4);
  });

  it('reconexão começa sem cache', async () => {
    const { transport, driver } = await open();
    await transport.getGroupMetadata(GROUP);

    await transport.connect();
    driver.last.groups.set(GROUP, {
      id: GROUP,
      subject: 'Outro',
      owner: undefined,
      participants: [],
    });

    expect(await transport.getGroupMetadata(GROUP)).toMatchObject({ title: 'Outro' });
  });

  it('falha na consulta não fica no cache', async () => {
    const { transport, socket } = await open();
    await expect(transport.getGroupMetadata('outro@g.us')).rejects.toThrow('item-not-found');
    socket.groups.set('outro@g.us', {
      id: 'outro@g.us',
      subject: 'Agora existe',
      owner: undefined,
      participants: [],
    });

    expect(await transport.getGroupMetadata('outro@g.us')).toMatchObject({
      title: 'Agora existe',
    });
  });

  it('o envio em grupo usa o que já está no cache, sem disparar consulta', async () => {
    const { transport, socket } = await open();
    const cached = socket.config.cachedGroupMetadata;

    expect(await cached(GROUP)).toBeUndefined();
    expect(socket.groupQueries).toEqual([]);

    await transport.getGroupMetadata(GROUP);
    expect(await cached(GROUP)).toMatchObject({ id: GROUP, subject: 'Família' });
  });
});
