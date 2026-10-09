import { describe, expect, it, vi } from 'vitest';
import type { MessageContext } from '#context.ts';
import type { Chat, Contact, Media, Message, MessageType } from '#message/types.ts';
import { type CommandContext, type CommandDefinition, command } from './command.ts';
import { createRoleRegistry, type RoleContext } from './roles.ts';
import { createCommandRouter } from './router.ts';

const MEDIA_TYPES: ReadonlySet<MessageType> = new Set([
  'image',
  'video',
  'audio',
  'voice',
  'sticker',
  'document',
]);

function fakeMedia(mimetype: string): Media {
  return {
    mimetype,
    size: null,
    download: () => Promise.resolve(Buffer.from(mimetype)),
    stream: () => Promise.reject(new Error('não usado')),
  };
}

interface FakeMessage {
  type?: MessageType;
  text?: string | null;
  sender?: string;
  phone?: string | null;
  chatId?: string;
  isGroup?: boolean;
  quoted?: Message | null;
}

// O roteador só lê type/text/chat/sender/quoted/media; o resto da union não importa aqui.
function fakeMessage({
  type = 'text',
  text = null,
  sender = 'user',
  phone = null,
  chatId = 'chat',
  isGroup = false,
  quoted = null,
}: FakeMessage): Message {
  const message = {
    type,
    id: 'm1',
    chat: { id: chatId, isGroup },
    sender: { id: sender, name: null, phone },
    text,
    timestamp: 0,
    fromMe: false,
    quoted,
    mentions: [],
    isForwarded: false,
    isViewOnce: false,
    isEdited: false,
    is: (t: MessageType) => t === type,
    ...(MEDIA_TYPES.has(type) ? { media: fakeMedia(`${type}/x`) } : {}),
  };
  return message as unknown as Message;
}

const ctxOf = (input: FakeMessage): MessageContext => ({ message: fakeMessage(input) });

/** Comando que guarda o contexto recebido em `run`. */
function spyCommand(def: Partial<CommandDefinition> = {}): {
  def: CommandDefinition;
  calls: CommandContext[];
} {
  const calls: CommandContext[] = [];
  const definition = command({
    name: 'sticker',
    aliases: ['s'],
    ...def,
    run: (ctx) => {
      calls.push(ctx);
    },
  });
  return { def: definition, calls };
}

describe('roteador: match', () => {
  it('casa nome e alias pelo token inicial exato e consome a mensagem', async () => {
    const router = createCommandRouter();
    const { def, calls } = spyCommand();
    router.registry.add('media', def);

    const byName = await router.dispatch(ctxOf({ text: '!sticker' }));
    const byAlias = await router.dispatch(ctxOf({ text: '!s' }));

    expect(byName).toEqual({
      consumed: true,
      status: 'ran',
      command: { plugin: 'media', name: 'sticker', invokedAs: 'sticker' },
    });
    expect(byAlias).toMatchObject({ consumed: true, command: { invokedAs: 's' } });
    expect(calls.map((c) => c.command)).toEqual(['sticker', 'sticker']);
  });

  it.each([
    ['comando no meio do texto', 'vou mandar !sticker depois'],
    ['token que só começa com o alias', '!sabado'],
    ['token que só começa com o nome', '!stickers'],
    ['sem prefixo', 'sticker'],
    ['prefixo seguido de espaço', '! sticker'],
    ['só o prefixo', '!'],
    ['comando inexistente', '!nada'],
  ])('não casa %s (débito do includes() do legacy)', async (_, text) => {
    const router = createCommandRouter();
    const { def, calls } = spyCommand();
    router.registry.add('media', def);

    expect(await router.dispatch(ctxOf({ text }))).toEqual({
      consumed: false,
      status: 'no-match',
    });
    expect(calls).toHaveLength(0);
  });

  it('não casa mensagem sem texto', async () => {
    const router = createCommandRouter();
    router.registry.add('media', spyCommand().def);
    const result = await router.dispatch(ctxOf({ type: 'image', text: null }));
    expect(result.consumed).toBe(false);
  });

  it('ignora caixa no prefixo e no token, mas preserva a dos argumentos', async () => {
    const router = createCommandRouter({ prefix: 'Luma,' });
    const { def, calls } = spyCommand();
    router.registry.add('media', def);

    await router.dispatch(ctxOf({ text: '  luma,STICKER Olá "Mundo Grande"' }));

    expect(calls[0]?.invokedAs).toBe('sticker');
    expect(calls[0]?.args).toEqual(['Olá', 'Mundo Grande']);
    expect(calls[0]?.rawArgs).toBe('Olá "Mundo Grande"');
  });

  it('usa a legenda da mídia como texto do comando', async () => {
    const router = createCommandRouter();
    const { def, calls } = spyCommand();
    router.registry.add('media', def);
    await router.dispatch(ctxOf({ type: 'image', text: '!s' }));
    expect(calls).toHaveLength(1);
  });

  it('preserva quebras de linha em rawArgs', async () => {
    const router = createCommandRouter();
    const { def, calls } = spyCommand();
    router.registry.add('media', def);
    await router.dispatch(ctxOf({ text: '!s\nlinha 1\nlinha 2' }));
    expect(calls[0]?.rawArgs).toBe('linha 1\nlinha 2');
    expect(calls[0]?.args).toEqual(['linha', '1', 'linha', '2']);
  });

  it('com prefixo vazio, a primeira palavra é o token (ADR 0063)', async () => {
    const router = createCommandRouter({ prefix: '' });
    const { def, calls } = spyCommand();
    router.registry.add('media', def);

    await router.dispatch(ctxOf({ text: '  Sticker agora' }));
    const other = await router.dispatch(ctxOf({ text: 'vou mandar sticker' }));

    expect(calls[0]?.invokedAs).toBe('sticker');
    expect(calls[0]?.rawArgs).toBe('agora');
    expect(other.consumed).toBe(false);
  });

  it('prefixo começado por espaço em branco nunca casaria: lança', () => {
    expect(() => createCommandRouter({ prefix: ' !' })).toThrow(TypeError);
  });

  it('resolve o prefixo pelo chat da mensagem', async () => {
    const router = createCommandRouter({ prefix: (chat) => (chat.isGroup ? '!' : '') });
    const { def, calls } = spyCommand();
    router.registry.add('media', def);

    await router.dispatch(ctxOf({ text: 'sticker' }));
    const group = await router.dispatch(ctxOf({ text: 'sticker', isGroup: true }));
    await router.dispatch(ctxOf({ text: '!sticker', isGroup: true }));

    expect(group.consumed).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('tira do token o @ do próprio bot (comando de grupo do Telegram)', async () => {
    const router = createCommandRouter({ prefix: '/', selfUsername: () => 'MeuBot' });
    const { def, calls } = spyCommand();
    router.registry.add('media', def);

    await router.dispatch(ctxOf({ text: '/sticker@meubot olá' }));
    const other = await router.dispatch(ctxOf({ text: '/sticker@OutroBot olá' }));

    expect(calls[0]?.invokedAs).toBe('sticker');
    expect(calls[0]?.rawArgs).toBe('olá');
    expect(other.consumed).toBe(false);
  });

  it('sem o username da sessão, o @ fica no token', async () => {
    const router = createCommandRouter({ prefix: '/', selfUsername: () => undefined });
    router.registry.add('media', spyCommand().def);
    const result = await router.dispatch(ctxOf({ text: '/sticker@meubot' }));
    expect(result.consumed).toBe(false);
  });

  it('herda do contexto recebido, preservando o que o pipeline colocou nele', async () => {
    const router = createCommandRouter();
    const { def, calls } = spyCommand();
    router.registry.add('media', def);
    const ctx = { message: fakeMessage({ text: '!s' }), extra: 42 };

    await router.dispatch(ctx);

    expect((calls[0] as unknown as typeof ctx).extra).toBe(42);
    expect(calls[0]?.message).toBe(ctx.message);
    expect(ctx).not.toHaveProperty('args');
  });
});

describe('roteador: accepts e media', () => {
  const accepts = ['image', 'video', 'quoted:image', 'quoted:video'] as const;

  it('resolve a mídia da própria mensagem', async () => {
    const router = createCommandRouter();
    const { def, calls } = spyCommand({ accepts });
    router.registry.add('media', def);

    await router.dispatch(ctxOf({ type: 'video', text: '!s' }));

    expect(calls[0]?.accepted?.spec).toBe('video');
    expect(calls[0]?.media?.mimetype).toBe('video/x');
  });

  it('resolve a mídia da mensagem citada', async () => {
    const router = createCommandRouter();
    const { def, calls } = spyCommand({ accepts });
    router.registry.add('media', def);
    const quoted = fakeMessage({ type: 'image' });

    await router.dispatch(ctxOf({ text: '!s', quoted }));

    expect(calls[0]?.accepted).toEqual({ spec: 'quoted:image', message: quoted });
    expect(calls[0]?.media?.mimetype).toBe('image/x');
  });

  it('respeita a ordem declarada quando própria e citada casam', async () => {
    const router = createCommandRouter();
    const { def, calls } = spyCommand({ accepts: ['quoted:image', 'image'] });
    router.registry.add('media', def);

    await router.dispatch(
      ctxOf({ type: 'image', text: '!s', quoted: fakeMessage({ type: 'image', sender: 'q' }) }),
    );

    expect(calls[0]?.accepted?.spec).toBe('quoted:image');
  });

  it('recusa com o texto de onReject e consome a mensagem', async () => {
    const router = createCommandRouter();
    const onReject = vi.fn(() => 'Mande ou responda uma imagem/vídeo');
    const { def, calls } = spyCommand({ accepts, onReject });
    router.registry.add('media', def);

    const result = await router.dispatch(
      ctxOf({ text: '!s', quoted: fakeMessage({ type: 'audio' }) }),
    );

    expect(result).toEqual({
      consumed: true,
      status: 'rejected',
      command: { plugin: 'media', name: 'sticker', invokedAs: 's' },
      rejection: { reason: 'accepts', accepts },
      reply: 'Mande ou responda uma imagem/vídeo',
    });
    expect(onReject).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'sticker', args: [] }),
      { reason: 'accepts', accepts },
    );
    expect(calls).toHaveLength(0);
  });

  it('recusa em silêncio sem onReject', async () => {
    const router = createCommandRouter();
    router.registry.add('media', spyCommand({ accepts }).def);
    const result = await router.dispatch(ctxOf({ text: '!s' }));
    expect(result).toMatchObject({ status: 'rejected', reply: null });
  });

  it('aceita onReject assíncrono', async () => {
    const router = createCommandRouter();
    router.registry.add('media', spyCommand({ accepts, onReject: async () => 'async' }).def);
    expect(await router.dispatch(ctxOf({ text: '!s' }))).toMatchObject({ reply: 'async' });
  });

  it('aceita tipos sem mídia, deixando media nulo', async () => {
    const router = createCommandRouter();
    const { def, calls } = spyCommand({ accepts: ['quoted:text'] });
    router.registry.add('ai', def);
    await router.dispatch(ctxOf({ text: '!s', quoted: fakeMessage({ text: 'oi' }) }));
    expect(calls[0]?.accepted?.spec).toBe('quoted:text');
    expect(calls[0]?.media).toBeNull();
  });

  it('sem accepts, resolve a mídia própria e, na falta, a citada', async () => {
    const router = createCommandRouter();
    const { def, calls } = spyCommand();
    router.registry.add('media', def);

    await router.dispatch(
      ctxOf({ type: 'image', text: '!s', quoted: fakeMessage({ type: 'video' }) }),
    );
    await router.dispatch(ctxOf({ text: '!s', quoted: fakeMessage({ type: 'video' }) }));
    await router.dispatch(ctxOf({ text: '!s' }));

    expect(calls.map((c) => c.media?.mimetype ?? null)).toEqual(['image/x', 'video/x', null]);
    expect(calls.every((c) => c.accepted === null)).toBe(true);
  });
});

describe('roteador: role', () => {
  const group = { isGroup: true, chatId: 'grupo' };

  it('owner: só quem está na lista roda', async () => {
    const router = createCommandRouter({ owners: ['5511999999999'] });
    const onReject = vi.fn(() => 'Só o dono');
    const { def, calls } = spyCommand({ role: 'owner', onReject });
    router.registry.add('admin', def);

    const denied = await router.dispatch(
      ctxOf({ text: '!s', sender: 'outro', phone: '5511888888888' }),
    );
    const allowed = await router.dispatch(
      ctxOf({ text: '!s', sender: 'dono', phone: '5511999999999' }),
    );

    expect(denied).toMatchObject({
      consumed: true,
      status: 'rejected',
      rejection: { reason: 'role', required: 'owner' },
      reply: 'Só o dono',
    });
    expect(allowed.status).toBe('ran');
    expect(calls).toHaveLength(1);
  });

  it('everyone é o padrão', async () => {
    const router = createCommandRouter();
    router.registry.add('media', spyCommand().def);
    expect((await router.dispatch(ctxOf({ text: '!s' }))).status).toBe('ran');
  });

  it('group-admin: consulta a porta com chat e remetente', async () => {
    const isGroupAdmin = vi.fn((_chat: Chat, sender: Contact) =>
      Promise.resolve(sender.id === 'adm'),
    );
    const router = createCommandRouter({ isGroupAdmin });
    router.registry.add('group', spyCommand({ role: 'group-admin' }).def);

    const allowed = await router.dispatch(ctxOf({ ...group, text: '!s', sender: 'adm' }));
    const denied = await router.dispatch(ctxOf({ ...group, text: '!s', sender: 'membro' }));

    expect(allowed.status).toBe('ran');
    expect(denied).toMatchObject({ status: 'rejected', rejection: { required: 'group-admin' } });
    expect(isGroupAdmin).toHaveBeenCalledWith(
      { id: 'grupo', isGroup: true },
      { id: 'adm', name: null, phone: null },
    );
  });

  it('group-admin: recusa fora de grupo sem consultar a porta', async () => {
    const isGroupAdmin = vi.fn(() => true);
    const router = createCommandRouter({ isGroupAdmin });
    router.registry.add('group', spyCommand({ role: 'group-admin' }).def);

    const result = await router.dispatch(ctxOf({ text: '!s' }));

    expect(result.status).toBe('rejected');
    expect(isGroupAdmin).not.toHaveBeenCalled();
  });

  it('group-admin: recusa sem a porta (transport sem capability groups)', async () => {
    const router = createCommandRouter();
    router.registry.add('group', spyCommand({ role: 'group-admin' }).def);
    expect((await router.dispatch(ctxOf({ ...group, text: '!s' }))).status).toBe('rejected');
  });

  it('group-admin: owner passa sem consultar a porta', async () => {
    const isGroupAdmin = vi.fn(() => false);
    const router = createCommandRouter({ owners: ['5511999999999'], isGroupAdmin });
    router.registry.add('group', spyCommand({ role: 'group-admin' }).def);

    const result = await router.dispatch(
      ctxOf({ ...group, text: '!s', sender: 'dono', phone: '5511999999999' }),
    );

    expect(result.status).toBe('ran');
    expect(isGroupAdmin).not.toHaveBeenCalled();
  });

  it('papel custom: avalia o check do registro, que recebe a mensagem e o comando', async () => {
    const roles = createRoleRegistry();
    const check = vi.fn((ctx: RoleContext) => ctx.message.sender.id === 'mod');
    roles.define('moderacao', 'moderador', check);
    const router = createCommandRouter({ roles });
    router.registry.add('m', spyCommand({ role: 'moderador' }).def);

    expect((await router.dispatch(ctxOf({ text: '!s', sender: 'mod' }))).status).toBe('ran');
    expect(await router.dispatch(ctxOf({ text: '!s', sender: 'outro' }))).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'role', required: 'moderador' },
    });
    expect(check.mock.calls[0]?.[0]).toMatchObject({ command: 'sticker', invokedAs: 's' });
  });

  it('papel custom: owner passa sem consultar o check', async () => {
    const roles = createRoleRegistry();
    const check = vi.fn(() => false);
    roles.define('moderacao', 'moderador', check);
    const router = createCommandRouter({ owners: ['5511999999999'], roles });
    router.registry.add('m', spyCommand({ role: 'moderador' }).def);

    const result = await router.dispatch(ctxOf({ text: '!s', phone: '5511999999999' }));

    expect(result.status).toBe('ran');
    expect(check).not.toHaveBeenCalled();
  });

  it('papel custom sem dono recusa e avisa onUnknownRole', async () => {
    const onUnknownRole = vi.fn();
    const router = createCommandRouter({ onUnknownRole });
    const { def, calls } = spyCommand({ role: 'moderador' });
    router.registry.add('m', def);

    const result = await router.dispatch(ctxOf({ text: '!s' }));

    expect(result).toMatchObject({ status: 'rejected', rejection: { reason: 'role' } });
    expect(calls).toEqual([]);
    expect(onUnknownRole).toHaveBeenCalledWith('moderador', {
      plugin: 'm',
      name: 'sticker',
      invokedAs: 's',
    });
  });

  it('valida role antes de accepts', async () => {
    const router = createCommandRouter();
    const onReject = vi.fn(() => null);
    router.registry.add('admin', spyCommand({ role: 'owner', accepts: ['image'], onReject }).def);

    const result = await router.dispatch(ctxOf({ text: '!s' }));

    expect(result).toMatchObject({ rejection: { reason: 'role' } });
    expect(onReject).toHaveBeenCalledOnce();
  });
});

describe('roteador: erros', () => {
  it('devolve o erro de run como failed, consumindo a mensagem', async () => {
    const router = createCommandRouter();
    const boom = new Error('boom');
    router.registry.add('media', command({ name: 's', run: () => Promise.reject(boom) }));

    expect(await router.dispatch(ctxOf({ text: '!s' }))).toEqual({
      consumed: true,
      status: 'failed',
      command: { plugin: 'media', name: 's', invokedAs: 's' },
      error: boom,
    });
  });

  it('devolve o erro de onReject e da porta de admin como failed', async () => {
    const boom = new Error('boom');
    const router = createCommandRouter({
      isGroupAdmin: () => {
        throw boom;
      },
    });
    router.registry.add(
      'a',
      command({
        name: 'x',
        accepts: ['image'],
        onReject: () => {
          throw boom;
        },
        run: () => undefined,
      }),
    );
    router.registry.add('b', command({ name: 'y', role: 'group-admin', run: () => undefined }));

    expect(await router.dispatch(ctxOf({ text: '!x' }))).toMatchObject({
      status: 'failed',
      error: boom,
    });
    expect(await router.dispatch(ctxOf({ text: '!y', isGroup: true }))).toMatchObject({
      status: 'failed',
      error: boom,
    });
  });
});

describe('roteador: owners por telefone (M1-16.4)', () => {
  it('compara owners com sender.phone, não com sender.id', async () => {
    const router = createCommandRouter({ owners: ['5511999999999'] });
    router.registry.add('admin', spyCommand({ role: 'owner' }).def);

    const byPhone = await router.dispatch(
      ctxOf({ text: '!s', sender: '123@lid', phone: '5511999999999' }),
    );
    const byId = await router.dispatch(
      ctxOf({ text: '!s', sender: '5511999999999', phone: '5511888888888' }),
    );

    expect(byPhone.status).toBe('ran');
    expect(byId.status).toBe('rejected');
  });

  it('remetente sem telefone (phone: null) nunca é owner', async () => {
    const router = createCommandRouter({ owners: ['5511999999999'] });
    router.registry.add('admin', spyCommand({ role: 'owner' }).def);

    const result = await router.dispatch(ctxOf({ text: '!s', sender: 'dono', phone: null }));

    expect(result).toMatchObject({ status: 'rejected', rejection: { reason: 'role' } });
  });
});

describe('roteador: owners por id (MP-2)', () => {
  it('owner { id } casa com sender.id em remetente sem telefone', async () => {
    const router = createCommandRouter({ owners: [{ id: '123456789012345678' }] });
    router.registry.add('admin', spyCommand({ role: 'owner' }).def);

    const owner = await router.dispatch(
      ctxOf({ text: '!s', sender: '123456789012345678', phone: null }),
    );
    const other = await router.dispatch(
      ctxOf({ text: '!s', sender: '876543210987654321', phone: null }),
    );

    expect(owner.status).toBe('ran');
    expect(other).toMatchObject({ status: 'rejected', rejection: { reason: 'role' } });
  });

  it('owner { id } não casa com sender.phone, nem telefone casa com { id }', async () => {
    const router = createCommandRouter({ owners: [{ id: '5511999999999' }] });
    router.registry.add('admin', spyCommand({ role: 'owner' }).def);

    const result = await router.dispatch(
      ctxOf({ text: '!s', sender: '1@lid', phone: '5511999999999' }),
    );

    expect(result.status).toBe('rejected');
  });

  it('owner { id } é superusuário também em group-admin', async () => {
    const isGroupAdmin = vi.fn(() => false);
    const router = createCommandRouter({ owners: [{ id: 'dono' }], isGroupAdmin });
    router.registry.add('admin', spyCommand({ role: 'group-admin' }).def);

    const result = await router.dispatch(
      ctxOf({ text: '!s', sender: 'dono', phone: null, isGroup: true }),
    );

    expect(result.status).toBe('ran');
    expect(isGroupAdmin).not.toHaveBeenCalled();
  });
});

describe('roteador: texto de trabalho ctx.text (M1-16.2)', () => {
  it('casa pelo ctx.text quando presente, em vez de message.text', async () => {
    const router = createCommandRouter();
    const { def, calls } = spyCommand();
    router.registry.add('media', def);

    const ctx: MessageContext = { message: fakeMessage({ text: 'oi' }), text: '!s  a b' };
    const result = await router.dispatch(ctx);

    expect(result.status).toBe('ran');
    expect(calls[0]).toMatchObject({ text: '!s  a b', args: ['a', 'b'] });
  });

  it('ctx.text null não casa, mesmo com message.text de comando', async () => {
    const router = createCommandRouter();
    router.registry.add('media', spyCommand().def);

    const result = await router.dispatch({ message: fakeMessage({ text: '!s' }), text: null });

    expect(result.status).toBe('no-match');
  });

  it('sem ctx.text, usa message.text e expõe-o como ctx.text no comando', async () => {
    const router = createCommandRouter();
    const { def, calls } = spyCommand();
    router.registry.add('media', def);

    await router.dispatch(ctxOf({ text: '!s x' }));

    expect(calls[0]?.text).toBe('!s x');
  });
});

describe('roteador: comando dado, sem casar o texto (ADR 0062)', () => {
  it('roda o comando pelo nome ou alias, com os args como vieram e o rawArgs unido', async () => {
    const router = createCommandRouter();
    const { def, calls } = spyCommand();
    router.registry.add('p', def);

    const result = await router.dispatch(ctxOf({ text: 'Figurinha' }), {
      command: 'S',
      args: ['a b', 'c'],
    });

    expect(result).toMatchObject({ consumed: true, status: 'ran', command: { invokedAs: 's' } });
    expect(calls[0]?.args).toEqual(['a b', 'c']);
    expect(calls[0]?.rawArgs).toBe('a b c');
  });

  it('comando que não existe não consome', async () => {
    const router = createCommandRouter();
    const result = await router.dispatch(ctxOf({ text: '!sticker' }), {
      command: 'nada',
      args: [],
    });
    expect(result).toEqual({ consumed: false, status: 'no-match' });
  });

  it('checa o papel como no comando digitado', async () => {
    const router = createCommandRouter({ owners: [{ id: 'dona' }] });
    const { def, calls } = spyCommand({ role: 'owner' });
    router.registry.add('p', def);

    const result = await router.dispatch(ctxOf({ text: 'x' }), { command: 'sticker', args: [] });

    expect(result).toMatchObject({ status: 'rejected', rejection: { reason: 'role' } });
    expect(calls).toHaveLength(0);
  });
});
