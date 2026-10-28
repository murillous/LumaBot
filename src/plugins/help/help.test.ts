import { definePlugin } from '@usebridger/core';
import { createTestBot, DEFAULT_CHAT, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { aiToolsProbe, toolResult } from '#plugins/ai-tools-probe.ts';
import { ping } from '#plugins/ping.ts';
import { formatMenu } from './format.ts';
import { help } from './help.ts';

let bot: TestBot;

afterEach(async () => {
  await bot.stop();
});

/** Último texto enviado pelo bot. */
function lastText(): string {
  const content = bot.sent.at(-1)?.content;
  if (content?.type !== 'text') throw new Error('nenhum texto enviado');
  return content.text;
}

describe('!help', () => {
  it('lista os comandos de outros plugins com aliases e descrição, pelo prefixo do chat', async () => {
    bot = await createTestBot({ plugins: [help, ping] });

    await bot.receive({ text: '!menu' });

    const text = lastText();
    expect(text).toContain('Comandos da Luma');
    expect(text).toContain(
      '*🛠️ Utilitários*\n• *!help* (!menu, !ajuda) - Lista os comandos\n• *!ping* - Responde pong',
    );
  });

  it('blocos na ordem fixa, independente da carga; plugin desconhecido vai para Outros', async () => {
    const plugin = (name: string, cmd: string) =>
      definePlugin({
        name,
        version: '1.0.0',
        engine: '<1.0.0',
        commands: { [cmd]: { description: 'd', run: () => 'x' } },
      });
    bot = await createTestBot({
      plugins: [plugin('novo', 'extra'), help, plugin('rank', 'rank'), plugin('sticker', 's')],
    });

    await bot.receive({ text: '!help' });

    const text = lastText();
    const order = ['*🎨 Mídia*', '*🏆 Social*', '*🛠️ Utilitários*', '*📦 Outros*'];
    const positions = order.map((title) => text.indexOf(title));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(text).toContain('*📦 Outros*\n• *!extra* - d');
  });

  it('esconde comando sem descrição e de owner', async () => {
    const outros = definePlugin({
      name: 'outros',
      version: '1.0.0',
      engine: '<1.0.0',
      commands: {
        mudo: { run: () => 'x' },
        secreto: { description: 'só dono', role: 'owner', run: () => 'x' },
        admin: { description: 'só admin', role: 'group-admin', run: () => 'x' },
      },
    });
    bot = await createTestBot({ plugins: [help, outros] });

    await bot.receive({ text: '!ajuda' });

    const text = lastText();
    expect(text).not.toContain('!mudo');
    expect(text).not.toContain('!secreto');
    expect(text).not.toContain('!admin');
  });

  it('plugin que só estende (dependsOn + contribute) acrescenta uma seção', async () => {
    const fale = definePlugin({
      name: 'fale',
      version: '1.0.0',
      engine: '<1.0.0',
      dependsOn: { help: '^1.0.0' },
      setup: (ctx) => {
        ctx.services.contribute('help.sections', ({ prefix }) => ({
          title: 'Fale com a Luma',
          lines: [`Mencione ela, sem ${prefix}`],
        }));
        ctx.services.contribute('help.sections', () => null);
      },
    });
    bot = await createTestBot({ plugins: [help, ping, fale] });

    await bot.receive({ text: '!help' });

    const text = lastText();
    expect(text).toContain('*Fale com a Luma*\nMencione ela, sem !');
    expect(text.indexOf('!ping')).toBeLessThan(text.indexOf('Fale com a Luma'));
  });
});

describe('!help: casos do kernel', () => {
  it('usa o prefixo do chat', async () => {
    const prefixo = definePlugin({
      name: 'prefixo',
      version: '1.0.0',
      engine: '<1.0.0',
      setup: (ctx) => ctx.prefixes.set(DEFAULT_CHAT.id, '/'),
    });
    bot = await createTestBot({ plugins: [help, prefixo] });

    await bot.receive({ text: '/help' });

    expect(lastText()).toContain('• */help* (/menu, /ajuda)');
  });

  it('comando group-admin só aparece em grupo', async () => {
    const admin = definePlugin({
      name: 'admin',
      version: '1.0.0',
      engine: '<1.0.0',
      commands: { ban: { description: 'bane', role: 'group-admin', run: () => 'x' } },
    });
    bot = await createTestBot({ plugins: [help, admin] });

    await bot.receive({ text: '!help' });
    expect(lastText()).not.toContain('!ban');

    await bot.receive({ text: '!help', chat: { ...DEFAULT_CHAT, isGroup: true } });
    expect(lastText()).toContain('• *!ban* - bane');
  });

  it('comando registrado depois do boot aparece no menu seguinte', async () => {
    let add: (() => void) | undefined;
    const tardio = definePlugin({
      name: 'tardio',
      version: '1.0.0',
      engine: '<1.0.0',
      setup: (ctx) => {
        add = () => ctx.commands.add({ name: 'novo', description: 'chegou', run: () => 'x' });
      },
    });
    bot = await createTestBot({ plugins: [help, tardio] });
    add?.();

    await bot.receive({ text: '!help' });

    expect(lastText()).toContain('• *!novo* - chegou');
  });

  it('seção que lança é omitida e o resto do menu sai', async () => {
    const quebrada = definePlugin({
      name: 'quebrada',
      version: '1.0.0',
      engine: '<1.0.0',
      dependsOn: { help: '^1.0.0' },
      setup: (ctx) => {
        ctx.services.contribute('help.sections', () => {
          throw new Error('boom');
        });
        ctx.services.contribute('help.sections', () => ({ title: 'Ok', lines: ['vivo'] }));
      },
    });
    bot = await createTestBot({ plugins: [help, quebrada] });

    await bot.receive({ text: '!help' });

    expect(lastText()).toContain('*Ok*\nvivo');
  });
});

describe('formatMenu', () => {
  it('agrupa por bloco na ordem de chegada', () => {
    const cmd = (group: string, name: string) => ({
      group,
      name,
      aliases: [],
      description: 'd',
    });
    expect(
      formatMenu({
        title: 'T',
        prefix: '/',
        commands: [cmd('a', 'x'), cmd('b', 'y'), cmd('a', 'z')],
        sections: [],
      }),
    ).toBe('T\n\n*a*\n• */x* - d\n• */z* - d\n\n*b*\n• */y* - d');
  });

  it('aliases entre parênteses, com o prefixo', () => {
    expect(
      formatMenu({
        title: 'T',
        prefix: '!',
        commands: [{ group: 'g', name: 's', aliases: ['st', 'fig'], description: 'd' }],
        sections: [],
      }),
    ).toBe('T\n\n*g*\n• *!s* (!st, !fig) - d');
  });
});

it('tool list_commands devolve ao modelo o mesmo menu do !help, sem enviá-lo', async () => {
  bot = await createTestBot({ plugins: [help, ping, aiToolsProbe] });

  await bot.receive({ text: '!help' });
  const menu = lastText();
  await bot.receive({ text: '!tool list_commands' });

  expect(toolResult(bot)).toEqual({ ok: true, menu });
  expect(bot.sent).toHaveLength(2);
});
