import {
  type Contact,
  definePlugin,
  type Logger,
  type Message,
  type PluginDefinition,
  type Reply,
} from '@usebridger/core';
import { z } from 'zod';
import { chainItem, type GenerateResult, type ModelChainItem } from '#plugins/ai/ai.ts';
import { personId } from '#plugins/ai/person-id.ts';
import { cleanResponse } from '#plugins/ai/response.ts';
import { aiTool, mediaMessage, ok } from '#plugins/ai/tools.ts';
import {
  compactInput,
  compactInstructions,
  estimateTokens,
  overflow,
  readMessagesTool,
  SUMMARY_MAX_CHARS,
  shorten,
  transcriptTokens,
  unsummarized,
} from './context.ts';
import { COMPACT_FAILED, MEMORY_FAILED, NAME_FAILED, OBSERVER_FAILED } from './log-events.ts';
import { type ChatMediaLookup, fileOf, lookupMedia, viewMediaTool } from './media.ts';
import {
  createMemory,
  type MemoryAudit,
  type MemoryDoc,
  memoryTools,
  normalize,
  peopleOf,
  renderMemory,
} from './memory.ts';
import { contextMessages, memoryGuide, type PromptImage, readingGuide } from './prompt.ts';
import { type ReadOutcome, readPdfTool } from './read-pdf.ts';
import { type ContextTexts, DEFAULT_TEXTS, type Speech } from './texts.ts';
import {
  cleanFileName,
  createTranscript,
  type Entry,
  header,
  mediaKind,
  mediaLabel,
  replyNote,
  type Summary,
  seq,
  stripHeader,
  type Turn,
  today,
  toTurns,
} from './transcript.ts';

/** Uma mensagem já na transcrição: o que veio antes dela e ela mesma. */
export interface Observed {
  /** A transcrição do chat antes desta fala. */
  readonly prior: readonly Entry[];
  /** Esta fala na transcrição; ausente se ela não tem texto nem mídia (uma localização). */
  readonly current: Entry | undefined;
}

export interface BuildRequest {
  readonly message: Message;
  readonly observed: Observed;
  readonly signal: AbortSignal;
  readonly log: Logger;
  /** Cadeia da compactação; ausente usa a do `ai-context`. */
  readonly models?: readonly ModelChainItem[];
  /** Nome do bot no pedido de resumo. Padrão: o da config, senão o da sessão. */
  readonly name?: string;
}

/** O contexto de uma resposta, pronto para o prompt. */
export interface BuiltContext {
  /** A transcrição no orçamento, já com o nível 1. */
  readonly turns: Turn[];
  /** O resumo das falas mais velhas, se houver. */
  readonly summary?: string;
  /** Os blocos da memória longa em texto; `''` sem nenhum fato. */
  readonly memory: string;
  /** Cabeçalho da fala de agora (`[#m12 16:30]`). */
  readonly header?: string;
  /** O dia de hoje no fuso do contexto. */
  readonly today: string;
}

export interface RespondRequest {
  readonly message: Message;
  readonly reply: Reply;
  readonly signal: AbortSignal;
  readonly log: Logger;
  /** Quem o bot é: identidade, estilo e formato. O contexto acrescenta como ler a conversa. */
  readonly instructions: string;
  /** O texto da fala; ausente usa o da mensagem. */
  readonly text?: string;
  /** Separa o consumo nas métricas. Padrão: `ai-context`. */
  readonly purpose?: string;
  /** Cadeia desta resposta; ausente usa a do `ai-context`. */
  readonly models?: readonly ModelChainItem[];
  /** Nome do bot na transcrição. Padrão: o da config, senão o da sessão. */
  readonly name?: string;
}

/** As seções do sistema que o contexto acrescenta a quem o bot é. */
export interface ContextGuide {
  /** Como ler a transcrição. */
  readonly reading: string;
  /** A memória longa com os blocos do chat; `''` com a memória desligada. */
  readonly memory: string;
}

/** Uma tool do contexto terminou; nunca leva o conteúdo (texto do PDF, fatos). */
export interface ContextToolEvent {
  readonly tool: 'read_pdf';
  readonly outcome: ReadOutcome;
  readonly message: Message;
  readonly log: Logger;
}

export type ContextObserver = (event: ContextToolEvent) => void | Promise<void>;

/** As tools que o `ai-context` contribui; cada uma pode ser desligada na config. */
const TOOLS = [
  'read_messages',
  'view_media',
  'read_pdf',
  'remember',
  'forget',
  'clear_history',
] as const;

export interface AiContextService {
  /** Fuso em que o contexto lê a data e a hora. */
  readonly timeZone: string;
  /** Os textos e o locale do contexto, para quem monta o prompt falar igual. */
  readonly speech: Speech;
  /** As seções do sistema: como ler a conversa e a memória (com os blocos de `build`). */
  guide(name: string, memory: string): ContextGuide;
  /**
   * Põe a mensagem na transcrição (uma vez só, mesmo chamado de dois listeners) e devolve o que
   * veio antes dela. O próprio `ai-context` chama para toda mensagem; quem responde chama para
   * esperar a gravação e receber o contexto anterior.
   */
  observe(message: Message, text?: string | null): Promise<Observed>;
  /** A imagem ou figurinha da mensagem (ou da citada) para o modelo ver; sem ela, `undefined`. */
  image(message: Message, log: Logger): Promise<PromptImage | undefined>;
  /** Transcrição no orçamento (compactando, se preciso) e a memória longa do chat. */
  build(request: BuildRequest): Promise<BuiltContext>;
  /** Grava a fala do bot, com o ID de cada balão: quem citar qualquer um cita esta fala. */
  record(chatId: string, speech: { text: string; name: string }, platformIds: string[]): void;
  /**
   * O caminho curto: monta o contexto, gera, responde no chat e grava a resposta. Quem precisa
   * de balões, persona ou espera usa `observe`, `build` e `record` direto.
   */
  respond(request: RespondRequest): Promise<GenerateResult>;
  /** Esquece a conversa do chat; a memória longa fica. */
  forget(chatId: string): void;
  /** Esquece a conversa e a memória longa do chat. */
  clear(chatId: string): Promise<void>;
  /** A mídia da fala `id` (`#m12`) do chat, para uma tool usar uma mídia anterior. */
  media(chatId: string, id: string): ChatMediaLookup;
  /** Chats com conversa viva. */
  conversations(): number;
  /**
   * Grava fatos de memória longa vindos de outro plugin (a migração do dono antigo). Fato que o
   * bloco já tem é pulado; devolve quantos entraram.
   */
  importMemory(docs: readonly MemoryDoc[]): Promise<number>;
}

/**
 * Nome de exibição de um contato pelo id (o apelido do `user-names`). O contexto não conhece
 * quem dá nomes: quem tem contribui aqui.
 */
export type NameResolver = (contactId: string) => Promise<string>;

declare module '@usebridger/core' {
  interface Services {
    aiContext: AiContextService;
  }
  interface ExtensionPoints {
    /** Avisado quando uma tool do contexto termina (o `usage` conta a leitura de PDF). */
    'ai-context.observers': ContextObserver;
    /** Quem dá o nome de quem fala; vale o primeiro. Sem nenhum, o nome do perfil. */
    'ai-context.names': NameResolver;
  }
}

const chain = z.array(chainItem);

const config = z.object({
  /** Nome do bot no resumo e na transcrição. Vazio: quem chama diz, senão o da sessão. */
  name: z.string().optional(),
  /** Locale das datas e horas que o modelo lê. */
  locale: z.string().default('pt-BR'),
  /** Tools do contexto que o bot não deve ter. */
  disabledTools: z.array(z.enum(TOOLS)).default([]),
  /** Cadeia da compactação e das tools; vazio usa a principal do `ai`. */
  models: chain.default([]),
  /** Cadeia que enxerga, para `view_media` e o PDF escaneado. Vazio: `view_media` usa `models`. */
  visionModels: chain.default([]),
  /**
   * Falas guardadas na transcrição de cada chat (todas, inclusive as do bot), por quanto tempo, e
   * quantos tokens (estimados) dela vão ao modelo: passando disso, as mais velhas viram resumo.
   */
  history: z
    .object({
      maxMessages: z.number().int().min(2).default(80),
      maxAgeMs: z
        .number()
        .int()
        .positive()
        .default(2 * 60 * 60_000),
      maxTokens: z.number().int().min(200).default(3000),
    })
    .default({ maxMessages: 80, maxAgeMs: 2 * 60 * 60_000, maxTokens: 3000 }),
  /**
   * Memória longa, por chat: caracteres de cada bloco (o do chat e o de cada pessoa) e quantos
   * dias um fato fica sem ser lembrado de novo.
   */
  memory: z
    .object({
      /** Desligada, sem blocos no sistema e sem as tools de lembrar e esquecer. */
      enabled: z.boolean().default(true),
      blockChars: z.number().int().min(50).default(500),
      maxAgeDays: z.number().int().positive().default(180),
    })
    .default({ enabled: true, blockChars: 500, maxAgeDays: 180 }),
  /** Fuso em que o bot lê a data e a hora. */
  timeZone: z.string().default('America/Sao_Paulo'),
});

/** Imagem maior que isso não vai ao modelo: estoura o corpo da requisição e custa caro. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * O contexto de conversa da IA: a transcrição de cada chat com IDs, o orçamento com resumo
 * rolante, a memória longa em blocos e as tools que leem tudo isso pelo ID. Quem decide quando
 * responder e quem o bot é fica com quem usa o serviço `aiContext`.
 */
export const aiContext: PluginDefinition = definePlugin({
  name: 'ai-context',
  version: '0.1.0',
  engine: '<1.0.0',
  dependsOn: { ai: '^0.1.0' },
  config,
  messages: DEFAULT_TEXTS,
  setup: (ctx) => {
    const cfg = ctx.config;
    const ai = ctx.services.get('ai');
    const speech: Speech = { texts: ctx.plugin.messages as ContextTexts, locale: cfg.locale };
    const { texts } = speech;
    const enabled = (tool: (typeof TOOLS)[number]) =>
      !cfg.disabledTools.includes(tool) &&
      (cfg.memory.enabled || (tool !== 'remember' && tool !== 'forget'));
    /** Nome do bot: o pedido, a config ou a sessão. */
    const selfName = (asked?: string) => asked ?? cfg.name ?? ctx.self?.name ?? 'Bot';
    const observers = ctx.services.extensionPoint('ai-context.observers');
    const transcript = createTranscript(cfg.history);
    const docs = ctx.storage.collection<MemoryDoc>('memory', { indexes: ['chatId'] });
    const memory = createMemory(docs, {
      blockChars: cfg.memory.blockChars,
      maxAgeMs: cfg.memory.maxAgeDays * 86_400_000,
    });
    /** Compactação em andamento por chat: duas respostas seguidas no grupo esperam a mesma. */
    const compacting = new Map<string, Promise<Summary | undefined>>();
    /** Gravação em andamento por mensagem: o listener daqui e o de quem responde esperam a mesma. */
    const observing = new Map<string, Promise<Observed>>();

    // Em conversa privada o id do chat é o número do contato: vai pseudonimizado.
    const auditChat = (chatId: string, isGroup: boolean) =>
      isGroup ? chatId : ctx.pseudonym(chatId);

    // Visão viva: quem dá nomes e carrega depois do contexto vale no próximo uso.
    const names = ctx.services.extensionPoint('ai-context.names');
    /** Nome de exibição: o de quem contribui em `ai-context.names`, se houver; senão o do perfil. */
    const nameOf = async (contact: Contact): Promise<string> => {
      const [resolve] = names.list();
      if (resolve) {
        try {
          return await resolve(contact.id);
        } catch (err) {
          ctx.log.event(NAME_FAILED, { err });
        }
      }
      return contact.name ?? texts.unknownSender;
    };

    const add = async (m: Message, text: string, prior: readonly Entry[]): Promise<Observed> => {
      const chatId = m.chat.id;
      const media = mediaKind(m.type);
      if (!text && !media) return { prior, current: undefined };
      const replyTo = m.quoted ? transcript.find(chatId, m.quoted.id)?.ref : undefined;
      const file = fileOf(m, ctx.media, ctx.capabilities);
      const current = transcript.add(
        chatId,
        {
          // O relógio do bot, não o da mensagem: é por ele que a fala expira.
          at: Date.now(),
          fromSelf: false,
          name: await nameOf(m.sender),
          person: personId(m.sender),
          text: text || null,
          ...(media && { media }),
          ...(m.type === 'document' && m.fileName && { fileName: cleanFileName(m.fileName) }),
          ...(file && { file }),
          ...(replyTo && { replyTo }),
        },
        [m.id],
      );
      return { prior, current };
    };

    const observe = (m: Message, text?: string | null): Promise<Observed> => {
      const chatId = m.chat.id;
      const key = `${chatId}\n${m.id}`;
      const running = observing.get(key);
      if (running) return running;
      // O que veio antes é lido agora, antes de qualquer `await`: a ordem do chat é a de chegada.
      const prior = transcript.entries(chatId);
      const known = transcript.find(chatId, m.id);
      if (known) {
        const before = prior.filter((e) => seq(e.ref) < seq(known.ref));
        return Promise.resolve({ prior: before, current: known });
      }
      const recorded = add(m, text ?? m.text ?? '', prior).finally(() => observing.delete(key));
      observing.set(key, recorded);
      return recorded;
    };

    const image = async (m: Message, log: Logger): Promise<PromptImage | undefined> => {
      const source = mediaMessage(m, ['image', 'sticker']);
      if (!source) return undefined;
      const { media } = source;
      if (media.size !== null && media.size > MAX_IMAGE_BYTES) return undefined;
      try {
        const data = await media.download();
        return { data, mediaType: media.mimetype.split(';')[0] ?? media.mimetype };
      } catch (err) {
        // Sem a imagem o bot ainda responde ao texto; não vale derrubar a conversa.
        log.warn('falha ao baixar a imagem', { err });
        return undefined;
      }
    };

    /**
     * Nível 2: dobra no resumo do chat as falas mais velhas, até o resto ocupar metade do
     * orçamento (folga para a compactação não rodar a cada turno). Falha devolve o resumo que já
     * havia: a resposta segue com a transcrição cortada no orçamento.
     */
    const compact = async (
      r: BuildRequest,
      summary: Summary | undefined,
      pending: readonly Entry[],
    ): Promise<Summary | undefined> => {
      const chatId = r.message.chat.id;
      const half = cfg.history.maxTokens / 2;
      const folded = pending.slice(0, overflow(pending, cfg.timeZone, half, speech));
      const last = folded.at(-1);
      if (!last) return summary;
      const models = r.models ?? cfg.models;
      try {
        const { text } = await ai.generate({
          purpose: 'ai-context.compact',
          instructions: compactInstructions(selfName(r.name), speech),
          messages: [
            { role: 'user', content: compactInput(summary?.text, folded, cfg.timeZone, speech) },
          ],
          signal: r.signal,
          // O custo entra no uso de quem fez o bot responder, como a resposta.
          actor: { id: personId(r.message.sender), chatId },
          ...(models.length > 0 && { models }),
        });
        const trimmed = text.trim().slice(0, SUMMARY_MAX_CHARS);
        if (!trimmed) return summary;
        const next: Summary = { text: trimmed, through: last.ref, at: last.at };
        transcript.setSummary(chatId, next);
        return next;
      } catch (err) {
        if (r.signal.aborted) throw err;
        r.log.event(COMPACT_FAILED, { err });
        return summary;
      }
    };

    /**
     * A transcrição que vai ao modelo, dentro de `history.maxTokens`: o resumo, se houver, e as
     * falas depois dele, com o nível 1 (texto antigo longo vira trecho). Passou do orçamento,
     * compacta; o que ainda sobrar (a compactação falhou) fica fora do prompt, mais velho primeiro.
     */
    const transcriptOf = async (r: BuildRequest): Promise<{ turns: Turn[]; summary?: string }> => {
      const chatId = r.message.chat.id;
      const { prior } = r.observed;
      const budget = cfg.history.maxTokens;
      let summary = transcript.summary(chatId);
      let pending = unsummarized(prior, summary);
      if (transcriptTokens(pending, cfg.timeZone, speech) > budget) {
        let running = compacting.get(chatId);
        if (!running) {
          running = compact(r, summary, pending).finally(() => compacting.delete(chatId));
          compacting.set(chatId, running);
        }
        // A compactação pode ser de outra resposta, que foi cancelada: esta segue sem o resumo novo.
        const previous = summary;
        summary = await running.catch((err: unknown) => {
          if (r.signal.aborted) throw err;
          return previous;
        });
        pending = unsummarized(prior, summary);
      }
      const room = budget - (summary ? estimateTokens(summary.text) : 0);
      const visible = pending.slice(overflow(pending, cfg.timeZone, room, speech));
      return {
        turns: toTurns(shorten(visible, speech), cfg.timeZone, speech),
        ...(summary && { summary: summary.text }),
      };
    };

    /** A memória longa: o bloco do chat e os de quem está na conversa. Sem o storage, nada. */
    const memoryOf = async (r: BuildRequest): Promise<string> => {
      if (!cfg.memory.enabled) return '';
      const { prior, current } = r.observed;
      const people = peopleOf(current ? [...prior, current] : prior);
      try {
        return renderMemory(await memory.blocks(r.message.chat.id, people), speech);
      } catch (err) {
        r.log.event(MEMORY_FAILED, { err });
        return '';
      }
    };

    const build = async (r: BuildRequest): Promise<BuiltContext> => {
      const [context, remembered] = await Promise.all([transcriptOf(r), memoryOf(r)]);
      const { current } = r.observed;
      return {
        ...context,
        memory: remembered,
        ...(current && { header: header(current, cfg.timeZone, speech) }),
        today: today(current?.at ?? Date.now(), cfg.timeZone, speech),
      };
    };

    const guide = (name: string, remembered: string): ContextGuide => ({
      reading: readingGuide(name, speech),
      memory: cfg.memory.enabled ? memoryGuide(remembered || undefined, speech) : '',
    });

    const record: AiContextService['record'] = (chatId, said, platformIds) => {
      transcript.add(
        chatId,
        { at: Date.now(), fromSelf: true, name: said.name, text: said.text },
        platformIds,
      );
    };

    const respond = async (r: RespondRequest): Promise<GenerateResult> => {
      const { message, signal, log } = r;
      const chatId = message.chat.id;
      const observed = await observe(message);
      const picture = await image(message, log);
      const cited = observed.current?.replyTo
        ? observed.prior.find((e) => e.ref === observed.current?.replyTo)
        : undefined;
      const name = selfName(r.name);
      const parts = [
        replyNote(cited, speech),
        observed.current?.media && !picture ? mediaLabel(observed.current, speech) : '',
        r.text ?? message.text ?? '',
      ];
      const context = await build({
        message,
        observed,
        signal,
        log,
        name,
        ...(r.models && { models: r.models }),
      });
      const models =
        r.models ?? (picture && cfg.visionModels.length > 0 ? cfg.visionModels : cfg.models);
      const sections = guide(name, context.memory);
      const result = await ai.generate({
        purpose: r.purpose ?? 'ai-context',
        instructions: [r.instructions, sections.reading, sections.memory]
          .filter(Boolean)
          .join('\n\n'),
        messages: contextMessages(
          {
            senderName: observed.current?.name ?? (await nameOf(message.sender)),
            userText: parts.filter(Boolean).join(' '),
            history: context.turns,
            today: context.today,
            ...(context.summary && { summary: context.summary }),
            ...(context.header && { header: context.header }),
            ...(picture && { image: picture }),
          },
          speech,
        ),
        signal,
        toolContext: { message, reply: r.reply, signal, log },
        actor: { id: personId(message.sender), chatId },
        ...(models.length > 0 && { models }),
      });
      const text = stripHeader(cleanResponse(result.text));
      if (text) {
        const sent = await r.reply(text);
        record(chatId, { text, name }, [sent.id]);
      }
      return result;
    };

    ctx.services.provide('aiContext', {
      timeZone: cfg.timeZone,
      speech,
      guide,
      observe,
      image,
      build,
      record,
      respond,
      forget: (chatId) => {
        transcript.clear(chatId);
      },
      clear: async (chatId) => {
        transcript.clear(chatId);
        await memory.clear(chatId);
      },
      media: (chatId, id) => lookupMedia(transcript, ctx.media, chatId, id),
      conversations: () => transcript.size(),
      importMemory: async (incoming) => {
        let imported = 0;
        for (const { chatId, about, name, text, at } of incoming) {
          // Uma migração que caiu no meio roda de novo: o fato que já veio não entra duas vezes.
          const same = await docs.find({ where: { chatId, about } });
          if (same.some((d) => normalize(d.text) === normalize(text))) continue;
          await docs.insert({ chatId, about, name, text, at });
          imported += 1;
        }
        return imported;
      },
    });

    // Toda fala entra na transcrição, respondam a ela ou não: é o contexto da próxima resposta.
    ctx.events.on('message', async (e) => {
      if (e.message.sender.isBot) return;
      await observe(e.message, e.text);
    });

    // ---- ferramentas da IA ----------------------------------------------------------------

    /** Avisa quem observa; um observer que falha não derruba a tool. */
    const notify = async (event: ContextToolEvent) => {
      for (const observer of observers.list()) {
        try {
          await observer(event);
        } catch (err) {
          event.log.event(OBSERVER_FAILED, { err, tool: event.tool });
        }
      }
    };

    if (enabled('view_media')) {
      ctx.services.contribute(
        'ai.tools',
        viewMediaTool({
          transcript,
          refs: ctx.media,
          ai,
          models: cfg.visionModels.length > 0 ? cfg.visionModels : cfg.models,
          speech,
        }),
      );
    }
    if (enabled('read_pdf')) {
      ctx.services.contribute(
        'ai.tools',
        readPdfTool({
          transcript,
          refs: ctx.media,
          ai,
          models: cfg.models,
          readers: cfg.visionModels,
          speech,
          onRead: (message, outcome) =>
            notify({ tool: 'read_pdf', outcome, message, log: ctx.log }),
        }),
      );
    }
    if (enabled('read_messages')) {
      ctx.services.contribute('ai.tools', readMessagesTool(transcript, speech));
    }
    // Só o ato e o bloco (chat ou pessoa) vão para a auditoria: nunca o fato nem de quem é.
    const auditMemory: MemoryAudit = (action, { chatId, isGroup, block }) =>
      ctx.audit.record({
        action,
        target: { type: 'chat', id: auditChat(chatId, isGroup) },
        details: { block },
      });
    for (const tool of memoryTools({
      memory,
      entries: (chatId) => transcript.entries(chatId),
      audit: auditMemory,
      speech,
    })) {
      if (enabled(tool.name as (typeof TOOLS)[number])) ctx.services.contribute('ai.tools', tool);
    }
    if (!enabled('clear_history')) return;
    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'clear_history',
        description: texts.toolClearHistory,
        args: z.object({}),
        run: async (_, t) => {
          const chat = t.message.chat;
          transcript.clear(chat.id);
          await memory.clear(chat.id);
          // Quem pediu sai como ator `contact` pelo kernel.
          ctx.audit.record({
            action: 'ai-context.history.clear',
            target: { type: 'chat', id: auditChat(chat.id, chat.isGroup) },
          });
          return ok();
        },
      }),
    );
  },
});
