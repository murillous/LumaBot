import { command, definePlugin } from '@zapforge/core';
import { CAPABILITIES } from '@zapforge/core/adapter';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeTransport } from './fake-transport.ts';
import { DEFAULT_SELF, DEFAULT_SENDER, PROFILE_NAMES, PROFILES } from './profiles.ts';
import { createTestBot, type TestBot } from './test-bot.ts';
import './matchers.ts';

const ENGINE = '>=0.0.0';
const bots: TestBot[] = [];

async function testBot(...args: Parameters<typeof createTestBot>): Promise<TestBot> {
  const bot = await createTestBot(...args);
  bots.push(bot);
  return bot;
}

afterEach(async () => {
  for (const bot of bots.splice(0)) await bot.stop();
});

/** Responde com o que o plugin vê do remetente. */
const quem = () =>
  definePlugin({
    name: 'quem',
    version: '1.0.0',
    engine: ENGINE,
    setup(ctx) {
      ctx.commands.add(
        command({
          name: 'quem',
          run: (c) => {
            const { phone, username } = c.message.sender;
            return c.reply(`${phone ?? 'sem telefone'} @${username ?? '-'}`);
          },
        }),
      );
    },
  });

/** Plugin que só roda onde o bot adiciona gente a grupo: WhatsApp. */
const convite = () =>
  definePlugin({
    name: 'convite',
    version: '1.0.0',
    engine: ENGINE,
    requires: ['groups.add'],
    setup() {
      // Só o `requires` importa: o teste confere se o plugin carregou.
    },
  });

describe('PROFILES (ADR 0073)', () => {
  it('cada perfil declara só capabilities do core, sem repetição', () => {
    for (const name of PROFILE_NAMES) {
      const { capabilities } = PROFILES[name];
      expect(capabilities.every((c) => (CAPABILITIES as readonly string[]).includes(c))).toBe(true);
      expect(new Set(capabilities).size).toBe(capabilities.length);
    }
  });

  it('PROFILE_NAMES lista todos os perfis', () => {
    expect([...PROFILE_NAMES].sort()).toEqual(Object.keys(PROFILES).sort());
  });

  it('só o whatsapp tem telefone nos contatos', () => {
    expect(PROFILES.whatsapp.sender).toBe(DEFAULT_SENDER);
    expect(PROFILES.whatsapp.self).toBe(DEFAULT_SELF);
    for (const name of ['telegram', 'discord', 'web'] as const) {
      expect(PROFILES[name].sender.phone).toBeNull();
      expect(PROFILES[name].self.phone).toBeNull();
    }
    expect(PROFILES.telegram.sender.username).toBeDefined();
    expect(PROFILES.discord.self).toMatchObject({ isBot: true });
  });
});

describe('FakeTransport com perfil', () => {
  it('declara as capabilities, os limites e o self do perfil', async () => {
    const transport = new FakeTransport({ profile: 'telegram' });
    expect(transport.profile).toBe('telegram');
    expect([...transport.capabilities]).toEqual(PROFILES.telegram.capabilities);
    expect(transport.limits).toEqual({ text: 4096, caption: 1024, album: 10 });
    await transport.connect();
    expect(transport.self).toEqual(PROFILES.telegram.self);
  });

  it('as opções substituem o campo do perfil', async () => {
    const transport = new FakeTransport({
      profile: 'discord',
      capabilities: ['send.text'],
      limits: { text: 10 },
      self: DEFAULT_SELF,
    });
    expect([...transport.capabilities]).toEqual(['send.text']);
    expect(transport.limits).toEqual({ text: 10 });
    await transport.connect();
    expect(transport.self).toBe(DEFAULT_SELF);
  });

  it('sem perfil, nada muda: todas as capabilities, sem limites', () => {
    const transport = new FakeTransport();
    expect(transport.profile).toBeUndefined();
    expect(transport.capabilities.size).toBe(CAPABILITIES.length);
    expect(transport.limits).toBeUndefined();
  });

  it('perfil desconhecido lança, em vez de cair em todas as capabilities', () => {
    // Vindo de JS, o tipo não protege.
    const profile = 'signal' as 'web';
    expect(() => new FakeTransport({ profile })).toThrow(/perfil desconhecido 'signal'/);
  });

  it('o perfil web não promete sticker: o envio lança UnsupportedError', async () => {
    const transport = new FakeTransport({ profile: 'web' });
    await expect(
      transport.send('c', { type: 'sticker', media: Buffer.from('x') }),
    ).rejects.toMatchObject({ name: 'UnsupportedError', capability: 'send.sticker' });
  });
});

describe('createTestBot com perfil', () => {
  it('o remetente padrão é o do perfil: sem telefone no Telegram', async () => {
    const bot = await testBot({ profile: 'telegram', plugins: [quem()] });
    await bot.receive({ text: '!quem' });
    expect(bot.sent).toHaveReplied('sem telefone @usuario');
  });

  it('sem perfil, o remetente segue com telefone', async () => {
    const bot = await testBot({ plugins: [quem()] });
    await bot.receive({ text: '!quem' });
    expect(bot.sent).toHaveReplied(`${DEFAULT_SENDER.phone} @-`);
  });

  it('o perfil vale também no transport passado à mão', async () => {
    // Sem `quoted` (o web real o declara desde o ADR 0077): a resposta sai sem citar.
    const capabilities = PROFILES.web.capabilities.filter((c) => c !== 'quoted');
    const transport = new FakeTransport({ profile: 'web', capabilities });
    const bot = await testBot({ transport, plugins: [quem()] });
    await bot.receive({ text: '!quem' });
    expect(bot.sent).toContainText('sem telefone @-');
    expect(bot.sent[0]?.quoted).toBeNull();
  });

  it('owner por telefone não casa no perfil sem telefone; por ID, sim', async () => {
    const admin = definePlugin({
      name: 'admin',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(command({ name: 'config', role: 'owner', run: (c) => c.reply('ok') }));
      },
    });
    const porTelefone = await testBot({
      profile: 'discord',
      plugins: [admin],
      owners: [DEFAULT_SENDER.phone ?? ''],
    });
    await porTelefone.receive({ text: '!config' });
    expect(porTelefone.sent).not.toContainText('ok');

    const porId = await testBot({
      profile: 'discord',
      plugins: [admin],
      owners: [{ id: PROFILES.discord.sender.id }],
    });
    await porId.receive({ text: '!config' });
    expect(porId.sent).toContainText('ok');
  });

  it('a resposta longa é dividida pelo limite do perfil', async () => {
    const longo = definePlugin({
      name: 'longo',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(command({ name: 'longo', run: (c) => c.reply('a '.repeat(1500)) }));
      },
    });
    const bot = await testBot({ profile: 'discord', plugins: [longo] });
    await bot.receive({ text: '!longo' });
    expect(bot.sent).toHaveLength(2);
    for (const sent of bot.sent) {
      expect(sent.content.type === 'text' && sent.content.text.length <= 2000).toBe(true);
    }
  });

  it('o click() usa o remetente do perfil', async () => {
    const menu = definePlugin({
      name: 'menu',
      version: '1.0.0',
      engine: ENGINE,
      setup(ctx) {
        ctx.commands.add(
          command({
            name: 'menu',
            run: (c) => c.reply('Escolha', { actions: [{ label: 'Quem', command: 'quem' }] }),
          }),
        );
      },
    });
    const bot = await testBot({ profile: 'telegram', plugins: [menu, quem()] });
    await bot.receive({ text: '!menu' });
    const [sent] = bot.sent;
    if (sent === undefined) throw new Error('o menu não saiu');
    await bot.click(sent, 'Quem');
    expect(bot.sent.at(-1)?.content).toEqual({ type: 'text', text: 'sem telefone @usuario' });
  });

  it('recusa `profile` junto com `transport`', async () => {
    await expect(
      createTestBot({ profile: 'telegram', transport: new FakeTransport() }),
    ).rejects.toThrow(/profile.*transport/);
  });

  it('os IDs gerados recomeçam em cada TestBot (sem estado de módulo)', async () => {
    const a = await testBot();
    const b = await testBot();
    expect((await a.receive({ text: 'x' })).id).toBe('in-1');
    expect((await a.receive({ text: 'y' })).id).toBe('in-2');
    expect((await b.receive({ text: 'z' })).id).toBe('in-1');
  });
});

// A matriz que o template de plugin (#121) usa: o mesmo teste em todos os perfis.
describe.each(PROFILE_NAMES)('matriz de perfis: %s', (profile) => {
  it('o plugin que exige groups.add só carrega no whatsapp', async () => {
    const bot = await testBot({ profile, plugins: [convite()] });
    const entry = bot.bot.plugins().find((candidate) => candidate.name === 'convite');
    expect(entry?.status).toBe(profile === 'whatsapp' ? 'loaded' : 'skipped');
  });
});
