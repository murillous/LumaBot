import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { personId } from '#plugins/ai/person-id.ts';
import { WELCOME_FAILED } from './log-events.ts';

/** Textos ao usuário; a config do bot sobrescreve cada um (`messages`). */
const MESSAGES = {
  intro:
    'Oi! Eu sou a *Luma* ✨\n\n' +
    'Aqui no privado é só falar comigo normalmente que eu respondo. ' +
    'Também faço figurinha, baixo vídeo, transcrevo áudio e mais: é só usar um dos comandos abaixo. ' +
    'Se esquecer, manda *{prefix}menu* que eu mostro a lista de novo.',
};

/**
 * Na primeira mensagem de cada pessoa no privado, a Luma se apresenta e manda o menu do `help`.
 * Só no privado: no grupo, uma apresentação por pessoa nova viraria spam.
 */
export const welcome: PluginDefinition = definePlugin({
  name: 'welcome',
  version: '0.1.0',
  engine: '<1.0.0',
  dependsOn: { help: '^1.0.0' },
  messages: MESSAGES,
  setup: (ctx) => {
    const kv = ctx.storage.kv;
    const help = ctx.services.get('help');
    // Pelo `personId`: no WhatsApp a mesma pessoa pode chegar como LID ou como número.
    const key = (sender: Parameters<typeof personId>[0]) => `welcomed:${personId(sender)}`;

    // Quem já começou por um comando sabe usar a Luma: marca sem apresentar. O comando não passa
    // pelo `message`, por isso o evento à parte.
    ctx.events.on('command', async (e) => {
      const m = e.payload.message;
      if (m.chat.isGroup || m.sender.isBot) return;
      await kv.set(key(m.sender), true);
    });

    // Acima da Luma (0) para a apresentação sair antes da resposta dela. Não reivindica: a Luma
    // ainda responde ao que a pessoa disse.
    ctx.events.on('message', { priority: 10 }, async (e) => {
      const m = e.message;
      if (m.chat.isGroup || m.sender.isBot) return;
      const k = key(m.sender);
      if (await kv.get<boolean>(k)) return;
      // Marca antes de enviar: se o envio falhar, a pessoa fica sem a apresentação, mas nunca a
      // recebe duas vezes.
      await kv.set(k, true);
      try {
        const intro = e.t('intro', { prefix: ctx.prefixes.get(m.chat) });
        await e.reply(`${intro}\n\n${help.render(m.chat)}`);
      } catch (err) {
        e.log.event(WELCOME_FAILED, { err });
      }
    });
  },
});
