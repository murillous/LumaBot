import {
  type Contact,
  definePlugin,
  type Logger,
  type Message,
  type PluginDefinition,
  type Reply,
} from '@usebridger/core';
import { z } from 'zod';
import { AiUnavailableError } from '#plugins/ai/ai.ts';
import { cleanResponse, splitIntoParts } from '#plugins/ai-response.ts';
import { aiTool, fail, mediaMessage, ok } from '#plugins/ai-tools.ts';
import { createChatWindow } from '#plugins/chat-window.ts';
import { createHistory, historyKey } from './history.ts';
import { PersonaParseError, parsePersona, personaPrompt, slugify } from './persona-generator.ts';
import { DEFAULT_PERSONA, PERSONAS, type Persona } from './personas.ts';
import { buildPrompt, type QuotedInfo, quotedContext } from './prompt.ts';
import { renderStats } from './stats.ts';
import { isTriggered, stripTrigger } from './trigger.ts';

/** A chat já tem as personas que a Luma deixa criar. */
export class PersonaLimitError extends Error {
  override readonly name = 'PersonaLimitError';
}

export type PersonaRemoval =
  | { readonly removed: true; readonly wasActive: boolean }
  | { readonly removed: false; readonly reason: 'predefined' | 'not-found' };

/** Personas por chat: as de fábrica mais as que o chat criou. */
export interface PersonasService {
  /** Na ordem do menu: fábrica primeiro, depois as do chat. */
  list(chatId: string): Promise<Persona[]>;
  active(chatId: string): Promise<Persona>;
  /** Ativa a persona pela `key`; `null` se o chat não a tem. */
  select(chatId: string, key: string): Promise<Persona | null>;
  /**
   * Gera uma persona da descrição, guarda no chat e a ativa. Lança `PersonaLimitError` no teto,
   * `PersonaParseError` se a IA não devolve algo aproveitável e `AiUnavailableError` sem IA.
   */
  create(chatId: string, description: string, signal?: AbortSignal): Promise<Persona>;
  /** Só as personas criadas no chat saem; as de fábrica ficam. */
  remove(chatId: string, key: string): Promise<PersonaRemoval>;
}

export interface LumaService {
  readonly personas: PersonasService;
  /** Esquece a conversa de quem falou (em grupo, só dessa pessoa) e a janela ambiente do chat. */
  clearHistory(message: Pick<Message, 'chat' | 'sender'>): void;
}

declare module '@usebridger/core' {
  interface Services {
    luma: LumaService;
  }
}

const MESSAGES = {
  historyCleared: '🗑️ Memória limpa nesta conversa!',
  lumaUsage: 'ℹ️ Use: *{prefix}luma clear* ou *{prefix}luma stats*',
  unavailable: 'Tô sem cabeça agora, volta daqui a pouco.',
  personaHeader: '🎭 *CONFIGURAÇÃO DA LUMA*\n_Escolha a personalidade:_',
  personaCurrent: '🔹 Atual neste chat: {name}',
  personaFooter:
    '_A mudança é aplicada imediatamente neste chat. Criar: *{prefix}persona criar <descrição>*; apagar uma criada (🗑️): *{prefix}persona deletar <número ou nome>*_',
  markDefault: ' ⭐ (Padrão)',
  markCustom: ' 🗑️',
  personaChanged: '✅ Personalidade alterada para: *{name}*',
  personaInvalid: '❌ Opção inválida. Tente o número da lista ou o nome da personalidade.',
  personaCreateHelp:
    'Pra eu virar um personagem novo, me conta como ele é logo depois do *criar*.\nEx: `{prefix}persona criar uma vó fofa que adora fazer bolo`',
  personaLimit:
    'Opa, esse chat já tem o limite de personas criadas ({max}) 😅\nApaga alguma com `{prefix}persona deletar <número>` antes de criar outra.',
  personaCreateOk: 'Prontinho! Agora eu sou *{name}*! 😎',
  personaCreateFail: 'Eita, não rolou criar essa persona agora 🥺 Tenta de novo daqui a pouco?',
  personaDeleteOk: '🗑️ Pronto, apaguei a persona *{name}*.',
  personaDeleteActive: '\nComo era a que tava ativa, voltei pra padrão.',
  statsTitle: '📊 *Estatísticas da Luma* (últimos {days} dias)',
  statsConversations: '🧠 Conversas ativas: {count}',
  statsResponses: '💬 Respostas: {count} ({rate} de sucesso)',
  statsFallback: '↪️ Salvas pelo fallback: {count}',
  statsTokens: '🔤 Tokens: {input} de entrada, {output} de saída',
  statsLatency: '⚡ Latência: p50 {p50}, p95 {p95}',
  statsCost: '💵 Custo estimado: {cost}',
  statsUnpriced: '⚠️ Sem preço na tabela: {models}',
  statsModelsTitle: '*Por modelo*',
  statsModel: '• {model}: {count} respostas ({cost})',
  statsNoData: 'Nenhuma resposta da IA registrada nesse período.',
  personaDeletePredefined:
    'Essa é de fábrica, não dá pra apagar 😅 Só dá pra deletar as que foram criadas aqui no chat.',
};

/** Cadeia de modelos no formato do `ai` (`provider:modelo`); o `ai` valida de novo a cada chamada. */
const chain = z.array(
  z.object({
    model: z.string().regex(/^[a-z0-9-]+:.+$/, 'use provider:modelo'),
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  }),
);

const config = z.object({
  /** Como a Luma é chamada no chat; cada nome vale como gatilho em qualquer ponto do texto. */
  names: z.array(z.string().min(1)).min(1).default(['luma']),
  /** Cadeia só da Luma, no formato do `ai`. Vazio usa a cadeia principal. */
  models: chain.default([]),
  /** Cadeia para a mensagem com imagem (nem todo modelo enxerga). Vazio usa `models`. */
  visionModels: chain.default([]),
  /** Persona de um chat que nunca escolheu. */
  defaultPersona: z.string().default(DEFAULT_PERSONA),
  /** Personas que cada chat pode criar. */
  maxCustomPersonas: z.number().int().min(0).default(10),
  /** Turnos guardados por conversa e quanto tempo parada ela dura. */
  history: z
    .object({
      maxMessages: z.number().int().min(2).default(80),
      maxAgeMs: z
        .number()
        .int()
        .positive()
        .default(2 * 60 * 60_000),
    })
    .default({ maxMessages: 80, maxAgeMs: 2 * 60 * 60_000 }),
  /** Últimas falas do grupo que a Luma lê como clima, sem serem dirigidas a ela. */
  groupContextSize: z.number().int().min(0).default(15),
  /** Balões da resposta: tamanho de cada um e quantos no máximo. */
  maxPartLength: z.number().int().min(20).default(300),
  maxParts: z.number().int().min(1).default(2),
  /** Espera "digitando" antes de gerar, sorteada entre `min` e `max`; 0 desliga. */
  thinkingDelayMs: z
    .object({
      min: z.number().int().nonnegative().default(2000),
      max: z.number().int().nonnegative().default(5000),
    })
    .refine((d) => d.min <= d.max, 'min não pode passar de max')
    .default({ min: 2000, max: 5000 }),
  /** Prazo da resposta inteira (espera, modelo, tools): acima do padrão de 30 s dos listeners. */
  replyTimeoutMs: z.number().int().positive().default(180_000),
  /** Fuso em que a Luma lê a data e a hora. */
  timeZone: z.string().default('America/Sao_Paulo'),
  /** Quando chamam sem dizer nada. */
  boredReplies: z
    .array(z.string())
    .min(1)
    .default(['Fala logo, mds...', 'Tô ouvindo, pode falar.', '🙄 Digita aí...']),
  /** Quando a resposta falha por outro motivo que não a IA estar fora. */
  errorReplies: z
    .array(z.string())
    .min(1)
    .default([
      'Ahn?',
      'Não entendi direito, pode repetir?',
      'Acho que tô com cera no ouvido hoje...',
    ]),
});

/** Imagem maior que isso não vai ao modelo: estoura o corpo da requisição e custa caro. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T;

/** Espera `ms`, mas acorda na hora se o `signal` abortar; nenhum timer sobrevive ao plugin. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

type PersonaDoc = {
  chatId: string;
  key: string;
  name: string;
  description: string;
  context: string;
  style: string;
  traits: string[];
};

/** O que a conversa precisa de uma mensagem; o listener e (se preciso) um passo fornecem. */
interface Incoming {
  readonly message: Message;
  readonly text: string;
  readonly reply: Reply;
  readonly signal: AbortSignal;
  readonly log: Logger;
  /** Últimas falas do grupo, antes desta; vazio em conversa privada. */
  readonly groupContext: string;
}

/**
 * A Luma: responde em conversa privada, quando citada, chamada pelo nome ou mencionada, com
 * histórico, persona por chat e as ferramentas do ponto `ai.tools`. A IA em si (cadeia de modelos,
 * fallback, métricas) é do plugin `ai`; aqui fica o que é da personagem.
 */
export const luma: PluginDefinition = definePlugin({
  name: 'luma',
  version: '0.1.0',
  engine: '<1.0.0',
  dependsOn: { ai: '^0.1.0' },
  config,
  messages: MESSAGES,
  setup: (ctx) => {
    const cfg = ctx.config;
    const ai = ctx.services.get('ai');
    const tools = ctx.services.extensionPoint('ai.tools');
    const history = createHistory(cfg.history);
    const window = createChatWindow(Math.max(cfg.groupContextSize, 1));
    const docs = ctx.storage.collection<PersonaDoc>('personas', { indexes: ['chatId'] });
    const kv = ctx.storage.kv;
    const factory = new Map(PERSONAS.map((p) => [p.key, p]));
    const defaultKey = factory.has(cfg.defaultPersona) ? cfg.defaultPersona : DEFAULT_PERSONA;

    // ---- personas -------------------------------------------------------------------------

    const custom = async (chatId: string): Promise<Persona[]> =>
      (await docs.find({ where: { chatId } })).map(({ id: _id, chatId: _c, ...p }) => p);

    const personas: PersonasService = {
      list: async (chatId) => [...PERSONAS, ...(await custom(chatId))],
      active: async (chatId) => {
        const key = await kv.get<string>(`persona:${chatId}`);
        const all = await personas.list(chatId);
        // Persona apagada (ou config trocada) cai na padrão, nunca em erro.
        return (
          all.find((p) => p.key === key) ?? factory.get(defaultKey) ?? (PERSONAS[0] as Persona)
        );
      },
      select: async (chatId, key) => {
        const found = (await personas.list(chatId)).find((p) => p.key === key);
        if (!found) return null;
        await kv.set(`persona:${chatId}`, key);
        return found;
      },
      create: async (chatId, description, signal) => {
        const existing = await custom(chatId);
        if (existing.length >= cfg.maxCustomPersonas) throw new PersonaLimitError();
        const request = {
          purpose: 'persona',
          messages: [{ role: 'user' as const, content: personaPrompt(description) }],
          ...(cfg.models.length > 0 && { models: cfg.models }),
          ...(signal && { signal }),
        };
        // O modelo às vezes responde fora do JSON: uma segunda tentativa resolve a maioria.
        let parsed: ReturnType<typeof parsePersona> | undefined;
        let lastError: unknown;
        for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
          try {
            parsed = parsePersona((await ai.generate(request)).text);
          } catch (err) {
            if (!(err instanceof PersonaParseError)) throw err;
            lastError = err;
          }
        }
        if (!parsed) throw lastError;
        const key = slugify(parsed.name, [...factory.keys(), ...existing.map((p) => p.key)]);
        const persona: Persona = { key, ...parsed };
        await docs.insert({ chatId, ...persona, traits: [...persona.traits] });
        await kv.set(`persona:${chatId}`, key);
        return persona;
      },
      remove: async (chatId, key) => {
        if (factory.has(key)) return { removed: false, reason: 'predefined' };
        const removed = await docs.delete({ chatId, key });
        if (removed === 0) return { removed: false, reason: 'not-found' };
        const wasActive = (await kv.get<string>(`persona:${chatId}`)) === key;
        if (wasActive) await kv.delete(`persona:${chatId}`);
        return { removed: true, wasActive };
      },
    };

    const clearHistory = (message: Pick<Message, 'chat' | 'sender'>) => {
      history.clear(historyKey(message));
      window.clear(message.chat.id);
    };
    ctx.services.provide('luma', { personas, clearHistory });

    // ---- a conversa -----------------------------------------------------------------------

    /** Nome de exibição: o apelido do `user-names`, se o plugin existe; senão o do perfil. */
    const nameOf = async (contact: Contact): Promise<string> => {
      if (ctx.services.has('userNames')) {
        try {
          return await ctx.services.get('userNames').displayName(contact.id);
        } catch (err) {
          ctx.log.warn('falha ao resolver o nome', { err });
        }
      }
      return contact.name ?? 'Usuário';
    };

    const mentionsSelf = (m: Message): boolean => {
      const self = ctx.self;
      if (!self) return false;
      return m.mentions.some((c) => c.id === self.id || (!!self.phone && c.phone === self.phone));
    };

    const hasTool = (name: string) => tools.list().some((t) => t.name === name);

    const quotedOf = async (m: Message): Promise<QuotedInfo | null> => {
      const q = m.quoted;
      if (!q) return null;
      return {
        text: q.text,
        senderName: q.fromMe ? 'Luma' : await nameOf(q.sender),
        fromLuma: q.fromMe,
        visual: q.type === 'sticker' ? 'figurinha' : q.type === 'image' ? 'imagem' : null,
      };
    };

    /** Imagem ou figurinha da mensagem (ou da citada) para o modelo ver; sem ela, `undefined`. */
    const imageOf = async (m: Message, log: Logger) => {
      const source = mediaMessage(m, ['image', 'sticker']);
      if (!source) return undefined;
      const { media } = source;
      if (media.size !== null && media.size > MAX_IMAGE_BYTES) return undefined;
      try {
        const data = await media.download();
        return { data, mediaType: media.mimetype.split(';')[0] ?? media.mimetype };
      } catch (err) {
        // Sem a imagem a Luma ainda responde ao texto; não vale derrubar a conversa.
        log.warn('falha ao baixar a imagem', { err });
        return undefined;
      }
    };

    const recordInteraction = async (m: Message) => {
      if (!ctx.services.has('rank')) return;
      try {
        await ctx.services.get('rank').record(m.chat.id, m.sender.id);
      } catch (err) {
        ctx.log.warn('falha ao contar a interação', { err });
      }
    };

    const converse = async (i: Incoming): Promise<void> => {
      const { message, signal } = i;
      const chat = message.chat;
      try {
        await recordInteraction(message);

        const senderName = await nameOf(message.sender);
        const key = historyKey(message);
        const image = await imageOf(message, i.log);
        const hasAudio = mediaMessage(message, ['voice', 'audio']) !== null;

        let userText = stripTrigger(i.text, cfg.names);
        if (!userText && image) {
          userText =
            message.type === 'sticker' || message.quoted?.type === 'sticker'
              ? '[O usuário respondeu com uma figurinha/sticker. Analise a imagem visualmente, entenda a emoção dela e reaja ao contexto]'
              : '[O usuário enviou uma imagem. Analise o conteúdo]';
        }
        if (!userText && hasAudio) {
          userText = hasTool('transcribe_audio')
            ? '[O usuário mandou um áudio. Ouça-o com a ferramenta de transcrição antes de responder]'
            : '[O usuário mandou um áudio que você não consegue ouvir]';
        }

        const lastAssistant = history.turns(key).findLast((t) => t.role === 'assistant')?.text;
        const quoted = quotedContext(await quotedOf(message), lastAssistant);
        if (quoted) userText = userText ? `${quoted} ${userText}` : quoted;

        if (!userText) {
          await i.reply(pick(cfg.boredReplies));
          return;
        }

        if (ctx.capabilities.has('typing')) {
          await ctx.send.typing(chat.id, 'text').catch((err: unknown) => {
            i.log.debug('falha ao avisar que está digitando', { err });
          });
        }
        const { min, max } = cfg.thinkingDelayMs;
        await sleep(min + Math.random() * (max - min), signal);

        const { instructions, messages } = buildPrompt({
          persona: await personas.active(chat.id),
          now: new Date(),
          timeZone: cfg.timeZone,
          senderName,
          userText,
          groupContext: i.groupContext,
          history: history.turns(key),
          ...(image && { image }),
        });
        const models = image && cfg.visionModels.length > 0 ? cfg.visionModels : cfg.models;
        const result = await ai.generate({
          purpose: 'luma',
          instructions,
          messages,
          signal,
          toolContext: { message, reply: i.reply, signal, log: i.log },
          ...(models.length > 0 && { models }),
        });

        const text = cleanResponse(result.text);
        const parts = splitIntoParts(text, {
          maxLength: cfg.maxPartLength,
          maxParts: cfg.maxParts,
        });
        // Trocar de persona ou limpar a memória por tool é recomeçar: guardar esta troca levaria a
        // fala da persona anterior para dentro da nova.
        const restarted = result.toolCalls.some(
          (c) => (c.name === 'create_persona' || c.name === 'clear_history') && isOk(c.result),
        );
        if (text && !restarted) {
          history.add(
            key,
            `${senderName}: ${userText}`,
            text.replaceAll('[PARTE]', ' ').replace(/ {2,}/g, ' '),
          );
        }
        for (const part of parts) await i.reply(part);
        if (parts.length === 0 && result.toolCalls.length === 0) {
          await i.reply(pick(cfg.errorReplies));
        }
      } catch (err) {
        if (signal.aborted) throw err;
        i.log.error('falha ao responder como a Luma', { err });
        const text =
          err instanceof AiUnavailableError
            ? ctx.plugin.messages.unavailable
            : pick(cfg.errorReplies);
        await i.reply(text).catch((replyErr: unknown) => {
          i.log.warn('falha ao avisar do erro', { err: replyErr });
        });
      }
    };

    ctx.events.on('message', { timeoutMs: cfg.replyTimeoutMs }, async (e) => {
      const m = e.message;
      if (m.sender.isBot) return;
      const chat = m.chat;
      const text = e.text ?? '';

      // O clima do grupo é o que veio antes desta fala; a fala entra na janela depois de lido.
      const groupContext = chat.isGroup
        ? window
            .recent(chat.id)
            .map((entry) => `${entry.name}: ${entry.text}`)
            .join('\n')
        : '';
      const wanted =
        !e.claimed &&
        (!chat.isGroup ||
          m.quoted?.fromMe === true ||
          isTriggered(text, cfg.names) ||
          mentionsSelf(m));
      // Reivindica antes de qualquer `await`: os listeners de prioridade menor (`spontaneous`)
      // começam na mesma volta e só veem o que já foi reivindicado.
      if (wanted) e.claim();

      // Toda fala de grupo entra na janela, chamem a Luma ou não.
      if (chat.isGroup && cfg.groupContextSize > 0 && text) {
        window.push(chat.id, { name: await nameOf(m.sender), text });
      }
      if (!wanted) return;

      await converse({
        message: m,
        text,
        reply: e.reply,
        signal: e.signal,
        log: e.log,
        groupContext,
      });
    });

    // ---- comandos -------------------------------------------------------------------------

    const STATS_DAYS = 7;
    /** Os números da IA vêm do `aiMetrics`, se ele existe; sem ele, só o que a Luma sabe sozinha. */
    const stats = async (t: Parameters<typeof renderStats>[3]): Promise<string> => {
      let summary = null;
      if (ctx.services.has('aiMetrics')) {
        try {
          summary = await ctx.services.get('aiMetrics').summary({ days: STATS_DAYS });
        } catch (err) {
          ctx.log.warn('falha ao ler as métricas da IA', { err });
        }
      }
      return renderStats(history.size(), summary, STATS_DAYS, t);
    };

    ctx.commands.add({
      name: 'luma',
      aliases: ['lc', 'clear', 'ls'],
      description: 'Memória e estatísticas da Luma: `!luma clear` ou `!luma stats` (`!lc`, `!ls`)',
      run: async (c) => {
        // Os atalhos do legacy (`!lc`, `!clear`, `!ls`) são alias do mesmo comando.
        const sub =
          c.invokedAs === 'lc' || c.invokedAs === 'clear'
            ? 'clear'
            : c.invokedAs === 'ls'
              ? 'stats'
              : (c.args[0] ?? '').toLowerCase();
        if (sub === 'clear') {
          clearHistory(c.message);
          return c.t('historyCleared');
        }
        if (sub === 'stats') return stats(c.t);
        return c.t('lumaUsage');
      },
    });

    /** Persona pelo número do menu (`2`, `p2`), pela chave ou pelo nome. */
    const resolve = (list: readonly Persona[], ref: string): Persona | undefined => {
      const wanted = ref.trim().toLowerCase();
      const n = /^p?(\d+)$/.exec(wanted)?.[1];
      if (n) return list[Number(n) - 1];
      return list.find((p) => p.key === wanted || p.name.toLowerCase() === wanted);
    };

    ctx.commands.add({
      name: 'persona',
      description:
        'Muda a personalidade da Luma neste chat: `!persona`, `!persona criar <descrição>` ou `!persona deletar <número>`',
      // Criar uma persona é uma chamada à IA, com fallback entre modelos: passa dos 30 s padrão.
      timeoutMs: 120_000,
      run: async (c) => {
        const chatId = c.message.chat.id;
        const sub = (c.args[0] ?? '').toLowerCase();
        const arg = c.rawArgs.replace(/^\S+\s*/, '').trim();

        if (sub === '') {
          const list = await personas.list(chatId);
          const current = await personas.active(chatId);
          const lines = list.map((p) => {
            const mark = !factory.has(p.key)
              ? c.t('markCustom')
              : p.key === defaultKey
                ? c.t('markDefault')
                : '';
            return `${p.name}${mark}\n${p.description}`;
          });
          const body = [
            c.t('personaHeader'),
            c.t('personaCurrent', { name: current.name }),
            lines.join('\n\n'),
            c.t('personaFooter'),
          ].join('\n\n');
          // Com botões, o clique roda `!persona usar <chave>`; sem eles, o kernel acrescenta o menu
          // numerado e trata o número respondido como o clique.
          await c.reply(body, {
            actions: list.map((p) => ({
              label: p.name,
              command: 'persona',
              args: ['usar', p.key],
            })),
          });
          return undefined;
        }

        if (sub === 'criar') {
          if (!arg) return c.t('personaCreateHelp');
          try {
            const persona = await personas.create(chatId, arg, c.signal);
            // Persona nova começa do zero: a memória da anterior não pode vazar para ela.
            clearHistory(c.message);
            return c.t('personaCreateOk', { name: persona.name });
          } catch (err) {
            if (err instanceof PersonaLimitError) {
              return c.t('personaLimit', { max: cfg.maxCustomPersonas });
            }
            c.log.error('falha ao criar a persona', { err });
            return c.t('personaCreateFail');
          }
        }

        if (sub === 'deletar' || sub === 'apagar') {
          const target = resolve(await personas.list(chatId), arg);
          if (!target) return c.t('personaInvalid');
          const result = await personas.remove(chatId, target.key);
          if (!result.removed) {
            return c.t(
              result.reason === 'not-found' ? 'personaInvalid' : 'personaDeletePredefined',
            );
          }
          return (
            c.t('personaDeleteOk', { name: target.name }) +
            (result.wasActive ? c.t('personaDeleteActive') : '')
          );
        }

        // `usar <ref>` (o botão) ou direto `!persona 2` / `!persona pirata`.
        const ref = sub === 'usar' ? arg : c.rawArgs;
        const picked = resolve(await personas.list(chatId), ref);
        if (!picked) return c.t('personaInvalid');
        await personas.select(chatId, picked.key);
        return c.t('personaChanged', { name: picked.name });
      },
    });

    // ---- ferramentas da IA ----------------------------------------------------------------

    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'clear_history',
        description:
          'Apaga a memória que a Luma tem da conversa com quem está falando. Use quando pedirem para esquecer, limpar a memória ou recomeçar a conversa.',
        args: z.object({}),
        run: async (_, t) => {
          clearHistory(t.message);
          return ok();
        },
      }),
    );
    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'create_persona',
        description:
          "Cria uma nova personalidade (persona) sua a partir de uma descrição livre e a ativa imediatamente neste chat. Use SEMPRE que o usuário pedir para você mudar de jeito de ser — 'virar', 'ser', 'se transformar em', 'fingir/finge que é', 'se passar por', 'incorporar', 'atuar/agir como', 'imitar', 'responder como', 'assumir a personalidade de' — qualquer personagem, figura ou personalidade (ex: 'vira uma vovó italiana carinhosa', 'seja um pirata mal-humorado', 'responde como se fosse o Sherlock'). Na dúvida entre só conversar e virar o personagem, prefira chamar esta ferramenta.",
        args: z.object({
          description: z
            .string()
            .describe(
              "A descrição livre da personalidade, do jeito que o usuário pediu. Ex: 'uma vovó italiana carinhosa que fala com sotaque'",
            ),
        }),
        run: async ({ description }, t) => {
          const text = description.trim();
          if (!text) return fail('empty');
          try {
            const persona = await personas.create(t.message.chat.id, text, t.signal);
            clearHistory(t.message);
            await t.reply(ctx.plugin.messages.personaCreateOk.replace('{name}', persona.name));
            return ok({ name: persona.name });
          } catch (err) {
            if (err instanceof PersonaLimitError)
              return fail('limit', String(cfg.maxCustomPersonas));
            if (err instanceof PersonaParseError) return fail('invalid-persona');
            if (err instanceof AiUnavailableError) return fail('unavailable');
            throw err;
          }
        },
      }),
    );
  },
});

function isOk(result: unknown): boolean {
  return typeof result === 'object' && result !== null && (result as { ok?: unknown }).ok === true;
}
