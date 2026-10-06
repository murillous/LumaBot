import { describe, expect, it, vi } from 'vitest';
import type { MessageContext } from '#context.ts';
import type { Media, Message, MessageType } from '#message/types.ts';
import { type CommandContext, type CommandDefinition, command } from './command.ts';
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
  chatId?: string;
  isGroup?: boolean;
  quoted?: Message | null;
}

// O roteador só lê type/text/chat/sender/quoted/media; o resto da union não importa aqui.
function fakeMessage({
  type = 'text',
  text = null,
  sender = 'user',
  chatId = 'chat',
  isGroup = false,
  quoted = null,
}: FakeMessage): Message {
  const message = {
    type,
    id: 'm1',
    chat: { id: chatId, isGroup },
    sender: { id: sender, name: null },
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

  it('recusa prefixo vazio', () => {
    expect(() => createCommandRouter({ prefix: '' })).toThrow(TypeError);
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
    const router = createCommandRouter({ owners: ['dono'] });
    const onReject = vi.fn(() => 'Só o dono');
    const { def, calls } = spyCommand({ role: 'owner', onReject });
    router.registry.add('admin', def);

    const denied = await router.dispatch(ctxOf({ text: '!s', sender: 'outro' }));
    const allowed = await router.dispatch(ctxOf({ text: '!s', sender: 'dono' }));

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
    const isGroupAdmin = vi.fn((_chat: string, sender: string) =>
      Promise.resolve(sender === 'adm'),
    );
    const router = createCommandRouter({ isGroupAdmin });
    router.registry.add('group', spyCommand({ role: 'group-admin' }).def);

    const allowed = await router.dispatch(ctxOf({ ...group, text: '!s', sender: 'adm' }));
    const denied = await router.dispatch(ctxOf({ ...group, text: '!s', sender: 'membro' }));

    expect(allowed.status).toBe('ran');
    expect(denied).toMatchObject({ status: 'rejected', rejection: { required: 'group-admin' } });
    expect(isGroupAdmin).toHaveBeenCalledWith('grupo', 'adm');
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
    const router = createCommandRouter({ owners: ['dono'], isGroupAdmin });
    router.registry.add('group', spyCommand({ role: 'group-admin' }).def);

    const result = await router.dispatch(ctxOf({ ...group, text: '!s', sender: 'dono' }));

    expect(result.status).toBe('ran');
    expect(isGroupAdmin).not.toHaveBeenCalled();
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
