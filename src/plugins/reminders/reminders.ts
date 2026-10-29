import {
  bold,
  definePlugin,
  fmt,
  type JsonValue,
  mention,
  type PluginDefinition,
} from '@usebridger/core';
import { z } from 'zod';
import { aiTool, fail, ok } from '#plugins/ai-tools.ts';
import { formatRecurrence, formatWhen, remaining, stats } from './format.ts';
import { brParser, type Recurrence, recurringParser, type WhenParser } from './parse.ts';
import { isValidTimeZone } from './zone.ts';

/** Lembrete pendente: disparo único ou série. */
export interface Reminder {
  readonly id: string;
  readonly chatId: string;
  readonly creatorId: string;
  /** Quem é mencionado no disparo; sem ninguém, o `creatorId`. */
  readonly mentionIds: readonly string[];
  /** A mensagem; em `kind` de terceiro, o rótulo que a lista mostra. */
  readonly text: string;
  /** Tipo de disparo, contribuído a `reminders.kinds`; `'text'` é o do próprio plugin. */
  readonly kind: string;
  /** Dado opaco do `kind` (`null` no `'text'`). */
  readonly data: JsonValue;
  /** `null` = disparo único. */
  readonly recurrence: Recurrence | null;
  /** Epoch ms. Único: o horário; série: a próxima ocorrência (`scheduler.next`). */
  readonly fireAt: number;
}

/** Informe `fireAt` (único) ou `recurrence` (série), nunca os dois. */
export interface CreateReminderInput {
  readonly chatId: string;
  readonly creatorId: string;
  readonly mentionIds: readonly string[];
  readonly text: string;
  /** Padrão `'text'`. */
  readonly kind?: string;
  /** Padrão `null`. */
  readonly data?: JsonValue;
  readonly fireAt?: number;
  readonly recurrence?: Recurrence;
}

/** Tipo de disparo, contribuído ao ponto `reminders.kinds`. */
export interface ReminderKind {
  readonly kind: string;
  /** Entrega uma ocorrência. Lançar vai ao `plugin.error`; numa série, as próximas seguem. */
  deliver(reminder: Reminder, job: { readonly signal: AbortSignal }): Promise<void>;
}

export type ReminderErrorCode =
  | 'invalid-chat'
  | 'invalid-date'
  | 'past'
  | 'too-far'
  | 'empty-text'
  | 'text-too-long'
  | 'unknown-kind'
  | 'invalid-recurrence'
  | 'interval-too-short';

/** Recusa de validação do `create`: o chamador (comando, IA) traduz o `code` em texto. */
export class ReminderError extends Error {
  readonly code: ReminderErrorCode;

  constructor(code: ReminderErrorCode) {
    super(`lembrete recusado: ${code}`);
    this.name = 'ReminderError';
    this.code = code;
  }
}

export interface RemindersService {
  /** Valida, agenda o disparo e guarda. Lança `ReminderError` se a entrada não serve. */
  create(input: CreateReminderInput): Promise<Reminder>;
  /** Pendentes do chat, por ordem de disparo. */
  list(chatId: string): Promise<Reminder[]>;
  /** `false` se não existe (ou é de outro chat). */
  cancel(chatId: string, id: string): Promise<boolean>;
}

declare module '@usebridger/core' {
  interface Services {
    reminders: RemindersService;
  }
  interface ExtensionPoints {
    /** Entende o argumento do `!lembrete`; o comando tenta os parsers em ordem de carga. */
    'reminders.parsers': WhenParser;
    /** Como entregar cada `kind` de lembrete; o `'text'` é contribuído pelo próprio plugin. */
    'reminders.kinds': ReminderKind;
  }
}

const MESSAGES = {
  usage:
    'Formato inválido. Use: {prefix}lembrete [DD/MM[/AAAA]] HH:mm mensagem\n' +
    'Recorrente: {prefix}lembrete todo dia HH:mm msg | toda segunda HH:mm msg | a cada 1h30 msg',
  created: '✅ Lembrete criado!\n\n{when}\n{text}',
  createdRecurring: '✅ Lembrete criado!\n\n🔁 {recurrence}\n📅 Próximo: {when}\n{text}',
  fireTitle: '⏰ Lembrete:',
  errInvalidChat: '❌ Não consegui identificar o chat do lembrete.',
  errInvalidDate: '❌ Data/hora inválida.',
  errPast: '❌ A data/hora precisa estar no futuro.',
  errTooFar: '❌ Lembrete muito distante (máx. 1 ano).',
  errEmptyText: '❌ Informe a mensagem do lembrete.',
  errTextTooLong: '❌ A mensagem do lembrete passou de {max} caracteres.',
  errUnknownKind: '❌ Tipo de lembrete desconhecido.',
  errInvalidRecurrence: '❌ Recorrência inválida.',
  errIntervalTooShort: '❌ O intervalo mínimo é de {min} minutos.',
  listEmpty: '📝 Nenhum lembrete agendado neste chat.',
  listHeader: '⏰ Lembretes agendados ({count})',
  listItem: '{n}. {when}\n   {text}\n   ⏳ {remaining}',
  listItemRecurring: '{n}. {when}\n   {text}\n   🔁 {recurrence}\n   ⏳ {remaining}',
  remMinutes: 'Faltam {n} minuto(s)',
  remHours: 'Faltam {n} hora(s)',
  remDays: 'Faltam {n} dia(s)',
  remWeeks: 'Faltam {n} semana(s)',
  remWeeksDays: 'Faltam {n} semana(s) e {d} dia(s)',
  listStats:
    '📊 Estatísticas\n\nTotal: {total}\nHoje: {today}\nEsta semana: {week}\nEste mês: {month}',
  listNext: '📌 Próximo lembrete\n\n{when}\n{text}',
  cancelUsage: '❌ Use: {prefix}cancelarlembrete <número>',
  cancelNotFound: '❌ Lembrete não encontrado.',
  cancelled: '✅ Lembrete removido:\n\n{text}',
};

const ERROR_MESSAGES = {
  'invalid-chat': 'errInvalidChat',
  'invalid-date': 'errInvalidDate',
  past: 'errPast',
  'too-far': 'errTooFar',
  'empty-text': 'errEmptyText',
  'text-too-long': 'errTextTooLong',
  'unknown-kind': 'errUnknownKind',
  'invalid-recurrence': 'errInvalidRecurrence',
  'interval-too-short': 'errIntervalTooShort',
} as const satisfies Record<ReminderErrorCode, keyof typeof MESSAGES>;

const MAX_TEXT_LENGTH = 500;
const MAX_HORIZON_MS = 365 * 24 * 60 * 60_000;
/** Piso do intervalo: o scheduler aceita 1 min, mas lembrete a cada minuto é spam no chat. */
const MIN_INTERVAL_MS = 15 * 60_000;
const JOB = 'fire';
const TEXT_KIND = 'text';
const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;

const config = z.object({
  timeZone: z
    .string()
    .default('America/Sao_Paulo')
    .refine(isValidTimeZone, 'fuso IANA inválido (ex.: America/Sao_Paulo)'),
});

/**
 * Documento guardado; o `jobId` liga ao job (ou série) do scheduler para o cancelamento. `kind`,
 * `data` e `recurrence` faltam nos docs da 1.x: valem `'text'`, `null` e `null`.
 */
type Doc = {
  chatId: string;
  creatorId: string;
  mentionIds: string[];
  text: string;
  kind?: string;
  data?: JsonValue;
  recurrence?: Recurrence | null;
  fireAt: number;
  jobId: string;
};

const toReminder = (doc: Doc & { id: string }): Reminder => ({
  id: doc.id,
  chatId: doc.chatId,
  creatorId: doc.creatorId,
  mentionIds: doc.mentionIds,
  text: doc.text,
  kind: doc.kind ?? TEXT_KIND,
  data: doc.data ?? null,
  recurrence: doc.recurrence ?? null,
  fireAt: doc.fireAt,
});

/** Devolve o código da recusa, ou `null` se a recorrência serve ao kernel e ao plugin. */
function recurrenceError(r: Recurrence): ReminderErrorCode | null {
  if ('everyMs' in r) {
    // Restrição do plugin, não do core (que aceita qualquer inteiro em ms >= 60000): o usuário e a
    // lista só falam em minutos.
    if (!Number.isInteger(r.everyMs) || r.everyMs % 60_000 !== 0) return 'invalid-recurrence';
    if (r.everyMs < MIN_INTERVAL_MS) return 'interval-too-short';
    return r.everyMs > MAX_HORIZON_MS ? 'too-far' : null;
  }
  const daysOk =
    r.days === undefined ||
    (Array.isArray(r.days) &&
      r.days.length > 0 &&
      r.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  return TIME_FORMAT.test(r.time) && daysOk ? null : 'invalid-recurrence';
}

/** Texto vindo do usuário (ou da IA): sem caractere de controle/invisível, salvo quebra de linha. */
function cleanText(raw: string): string {
  return (
    raw
      .replace(/\t/g, ' ')
      // ZWJ fica: sem ele, emoji composto (👨‍👩‍👧) se desmonta.
      .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\n' || c === '\u200d' ? c : ''))
      .trim()
  );
}

/**
 * Lembretes (`!lembrete`, `!lembretes`, `!cancelarlembrete`) e o serviço `reminders`. O disparo
 * é um job (único) ou série (recorrente) do scheduler do kernel, que sobrevive a restart; a
 * lista vem do storage. O tipo de disparo é aberto: cada `kind` entra em `reminders.kinds`.
 */
export const reminders: PluginDefinition = definePlugin({
  name: 'reminders',
  version: '2.0.0',
  engine: '<1.0.0',
  requires: ['send.text'],
  config,
  messages: MESSAGES,
  setup: (ctx) => {
    const docs = ctx.storage.collection<Doc>('reminders', { indexes: ['chatId', 'fireAt'] });
    // Visão viva: `list()` a cada uso, para pegar kind de plugin que carrega depois.
    const kinds = ctx.services.extensionPoint('reminders.kinds');
    const warnedDuplicates = new Set<string>();

    // Disparo "pelo menos uma vez": o documento único só sai depois da entrega. Se o processo cair
    // no meio, o job volta e o lembrete sai de novo, em vez de se perder. A série mantém o doc.
    ctx.scheduler.on(JOB, async (payload, job) => {
      const id = (payload as { id?: unknown } | null)?.id;
      if (typeof id !== 'string') {
        ctx.log.error('job de lembrete sem id', { payload });
        return;
      }
      const doc = await docs.get(id);
      if (!doc) {
        // Série sem doc é órfã (o `list()` apaga o doc de `jobId` vazio, deixado por uma queda
        // entre o `every` e o `docs.update`): sem cancelar, dispararia para sempre sem entregar.
        if (job.seriesId) {
          try {
            await ctx.scheduler.cancel(job.seriesId);
          } catch (err) {
            ctx.log.warn('falha ao cancelar série órfã de lembrete', { err, id });
          }
        }
        // Cancelado entre o disparo e a leitura: nada a enviar.
        return;
      }
      const reminder = toReminder(doc);
      try {
        const matches = kinds.list().filter((k) => k.kind === reminder.kind);
        const kind = matches[0];
        // Vale o primeiro por ordem de carga; o aviso (uma vez por kind) evita o conflito calado.
        if (matches.length > 1 && !warnedDuplicates.has(reminder.kind)) {
          warnedDuplicates.add(reminder.kind);
          ctx.log.warn('kind de lembrete contribuído por mais de um plugin; vale o primeiro', {
            kind: reminder.kind,
          });
        }
        if (!kind) {
          // Plugin dono do kind desligado: não entrega; a série espera ele voltar.
          ctx.log.warn('kind de lembrete sem plugin', { kind: reminder.kind, id });
          return;
        }
        await kind.deliver(reminder, { signal: job.signal });
      } finally {
        if (!reminder.recurrence) {
          // Não mascara o erro da entrega se o delete também falhar.
          try {
            await docs.delete(id);
          } catch (err) {
            ctx.log.error('falha ao apagar lembrete disparado', { err, id });
          }
        }
      }
    });

    ctx.services.contribute('reminders.kinds', {
      kind: TEXT_KIND,
      deliver: async (r) => {
        const mentions = r.mentionIds.map((mid) => mention({ id: mid, name: null, phone: null }));
        const content = mentions.reduce(
          (acc, m, i) => fmt`${acc}${i === 0 ? '\n' : ' '}${m}`,
          fmt`${bold(ctx.plugin.messages.fireTitle)} ${r.text}`,
        );
        await ctx.send.send(r.chatId, content);
      },
    });
    ctx.services.contribute('reminders.parsers', brParser(ctx.config.timeZone));
    ctx.services.contribute('reminders.parsers', recurringParser());

    const service: RemindersService = {
      create: async (input) => {
        if (!input.chatId || !input.creatorId) throw new ReminderError('invalid-chat');
        const kind = input.kind ?? TEXT_KIND;
        if (!kinds.list().some((k) => k.kind === kind)) throw new ReminderError('unknown-kind');

        const { fireAt, recurrence } = input;
        if ((fireAt === undefined) === (recurrence === undefined)) {
          throw new ReminderError('invalid-recurrence');
        }
        if (recurrence) {
          const code = recurrenceError(recurrence);
          if (code) throw new ReminderError(code);
        } else {
          const now = Date.now();
          if (!Number.isFinite(fireAt)) throw new ReminderError('invalid-date');
          if ((fireAt ?? 0) <= now) throw new ReminderError('past');
          if ((fireAt ?? 0) - now > MAX_HORIZON_MS) throw new ReminderError('too-far');
        }
        const text = cleanText(input.text);
        if (!text) throw new ReminderError('empty-text');
        if (text.length > MAX_TEXT_LENGTH) throw new ReminderError('text-too-long');

        const mentionIds = [...new Set(input.mentionIds.filter(Boolean))];
        const doc: Doc = {
          chatId: input.chatId,
          creatorId: input.creatorId,
          mentionIds: mentionIds.length > 0 ? mentionIds : [input.creatorId],
          text,
          kind,
          data: input.data ?? null,
          recurrence: recurrence ?? null,
          fireAt: fireAt ?? 0,
          jobId: '',
        };
        const id = await docs.insert(doc);
        let seriesId: string | undefined;
        try {
          let jobId: string;
          if (recurrence) {
            try {
              jobId = seriesId = await ctx.scheduler.every(
                { ...recurrence, timeZone: ctx.config.timeZone },
                JOB,
                { id },
              );
            } catch (err) {
              // O kernel recusou uma regra que a validação daqui não pegou.
              if (err instanceof TypeError) throw new ReminderError('invalid-recurrence');
              throw err;
            }
            const next = await ctx.scheduler.next(jobId);
            if (!next) throw new Error('série criada sem próxima ocorrência');
            doc.fireAt = next.getTime();
          } else {
            jobId = await ctx.scheduler.at(doc.fireAt, JOB, { id });
          }
          await docs.update(id, { jobId, fireAt: doc.fireAt });
        } catch (err) {
          // Sem job não há disparo (e sem doc a série não seria cancelável): desfaz os dois.
          if (seriesId) {
            try {
              await ctx.scheduler.cancel(seriesId);
            } catch (cancelErr) {
              ctx.log.error('falha ao cancelar série órfã', { err: cancelErr, id, seriesId });
            }
          }
          await docs.delete(id);
          throw err;
        }
        return toReminder({ ...doc, id });
      },

      list: async (chatId) => {
        const found = await docs.find({ where: { chatId }, orderBy: 'fireAt' });
        const out: Reminder[] = [];
        for (const doc of found) {
          if (!doc.recurrence) {
            out.push(toReminder(doc));
            continue;
          }
          const next = doc.jobId ? await ctx.scheduler.next(doc.jobId) : undefined;
          if (!next) {
            // Sem ocorrência futura nem a série dispara mais, e ninguém cancelaria o doc: limpa.
            ctx.log.warn('série de lembrete sem próxima ocorrência; removida', { id: doc.id });
            if (doc.jobId) await ctx.scheduler.cancel(doc.jobId);
            await docs.delete(doc.id);
            continue;
          }
          out.push(toReminder({ ...doc, fireAt: next.getTime() }));
        }
        return out.sort((a, b) => a.fireAt - b.fireAt);
      },

      cancel: async (chatId, id) => {
        const doc = await docs.get(id);
        if (!doc || doc.chatId !== chatId) return false;
        // Job primeiro: se o cancel falhar, o doc fica e dá para tentar de novo.
        await ctx.scheduler.cancel(doc.jobId);
        await docs.delete(id);
        return true;
      },
    };
    ctx.services.provide('reminders', service);

    const zone = ctx.config.timeZone;
    // O que o modelo lê de um lembrete: o `id` para cancelar e a hora no fuso do bot.
    // `when` é a próxima ocorrência; `recurrence` só aparece na série.
    const view = (r: Reminder) => ({
      id: r.id,
      when: formatWhen(r.fireAt, zone),
      text: r.text,
      ...(r.recurrence && { recurrence: formatRecurrence(r.recurrence) }),
    });
    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'create_reminder',
        description: `Agenda um lembrete neste chat, único (\`when\`) ou repetido (\`repeat\`). Quem a mensagem do usuário menciona é marcado no disparo; sem menção, quem pediu. Fuso do bot: ${zone}.`,
        args: z.object({
          when: z.iso
            .datetime({ offset: true })
            .optional()
            .describe(
              'Data e hora do disparo único em ISO 8601 com fuso, ex.: 2026-10-20T15:00:00-03:00. Omita se usar `repeat`',
            ),
          repeat: z
            .union([
              z.object({
                everyMinutes: z
                  .number()
                  .int()
                  .describe(`Intervalo em minutos (mínimo ${MIN_INTERVAL_MS / 60_000})`),
              }),
              z.object({
                time: z.string().describe(`Horário HH:mm (24 h) no fuso ${zone}`),
                days: z
                  .array(z.number().int().min(0).max(6))
                  .optional()
                  .describe('Dias da semana, 0 = domingo … 6 = sábado; omita para todo dia'),
              }),
            ])
            .optional()
            .describe('Repetição. Informe `repeat` ou `when`, nunca os dois'),
          text: z.string().describe(`Mensagem do lembrete, até ${MAX_TEXT_LENGTH} caracteres`),
        }),
        run: async ({ when, repeat, text }, t) => {
          const { chat, sender, mentions } = t.message;
          const recurrence: Recurrence | undefined = !repeat
            ? undefined
            : 'everyMinutes' in repeat
              ? { everyMs: repeat.everyMinutes * 60_000 }
              : { time: repeat.time, ...(repeat.days && { days: repeat.days }) };
          try {
            const reminder = await service.create({
              chatId: chat.id,
              creatorId: sender.id,
              mentionIds: mentions.map((m) => m.id),
              text,
              ...(when !== undefined && { fireAt: Date.parse(when) }),
              ...(recurrence && { recurrence }),
            });
            return ok(view(reminder));
          } catch (err) {
            if (err instanceof ReminderError) return fail(err.code);
            throw err;
          }
        },
      }),
    );
    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'list_reminders',
        description: 'Lista os lembretes pendentes deste chat, do mais próximo ao mais distante.',
        args: z.object({}),
        run: async (_, t) => ok({ reminders: (await service.list(t.message.chat.id)).map(view) }),
      }),
    );
    ctx.services.contribute(
      'ai.tools',
      aiTool({
        name: 'cancel_reminder',
        description: 'Cancela um lembrete deste chat pelo `id` que o `list_reminders` devolve.',
        args: z.object({ id: z.string() }),
        run: async ({ id }, t) =>
          (await service.cancel(t.message.chat.id, id)) ? ok() : fail('not-found'),
      }),
    );
  },
  commands: {
    lembrete: {
      aliases: ['lembrar'],
      description:
        'Agenda um lembrete (`!lembrete [DD/MM[/AAAA]] HH:mm mensagem`, `todo dia HH:mm`, `a cada 1h30`)',
      run: async (c, plugin) => {
        const now = new Date();
        let parsed: ReturnType<WhenParser> = null;
        for (const parse of plugin.services.extensionPoint('reminders.parsers').list()) {
          let result: ReturnType<WhenParser>;
          try {
            result = parse(c.rawArgs, now);
          } catch (err) {
            // Parser de terceiro quebrado não derruba o comando: o próximo tenta.
            c.log.error('parser de lembrete falhou', { err });
            continue;
          }
          if (result) {
            parsed = result;
            break;
          }
        }
        if (!parsed) return c.t('usage');

        const { sender, mentions, chat } = c.message;
        try {
          const reminder = await plugin.services.get('reminders').create({
            chatId: chat.id,
            creatorId: sender.id,
            mentionIds: mentions.map((m) => m.id),
            text: parsed.text,
            ...('recurrence' in parsed
              ? { recurrence: parsed.recurrence }
              : { fireAt: parsed.fireAt }),
          });
          const when = formatWhen(reminder.fireAt, plugin.config.timeZone);
          return reminder.recurrence
            ? c.t('createdRecurring', {
                recurrence: formatRecurrence(reminder.recurrence),
                when,
                text: reminder.text,
              })
            : c.t('created', { when, text: reminder.text });
        } catch (err) {
          if (err instanceof ReminderError) {
            return c.t(ERROR_MESSAGES[err.code], {
              max: MAX_TEXT_LENGTH,
              min: MIN_INTERVAL_MS / 60_000,
            });
          }
          throw err;
        }
      },
    },

    lembretes: {
      description: 'Lista os lembretes deste chat',
      run: async (c, plugin) => {
        const zone = plugin.config.timeZone;
        const pending = await plugin.services.get('reminders').list(c.message.chat.id);
        const first = pending[0];
        if (!first) return c.t('listEmpty');
        const now = Date.now();

        const items = pending.map((r, i) => {
          const left = remaining(r.fireAt, now);
          return c.t(r.recurrence ? 'listItemRecurring' : 'listItem', {
            n: i + 1,
            when: formatWhen(r.fireAt, zone),
            text: r.text,
            recurrence: r.recurrence ? formatRecurrence(r.recurrence) : '',
            remaining: c.t(left.key, left.values),
          });
        });
        return [
          c.t('listHeader', { count: pending.length }),
          items.join('\n\n'),
          c.t(
            'listStats',
            stats(
              pending.map((r) => r.fireAt),
              now,
              zone,
            ),
          ),
          c.t('listNext', { when: formatWhen(first.fireAt, zone), text: first.text }),
        ].join('\n\n');
      },
    },

    cancelarlembrete: {
      description: 'Cancela um lembrete (a série inteira, se recorrente) pelo número da lista',
      run: async (c, plugin) => {
        const arg = c.args[0] ?? '';
        if (!/^\d+$/.test(arg)) return c.t('cancelUsage');
        const service = plugin.services.get('reminders');
        const target = (await service.list(c.message.chat.id))[Number(arg) - 1];
        if (!target || !(await service.cancel(target.chatId, target.id))) {
          return c.t('cancelNotFound');
        }
        return c.t('cancelled', { text: target.text });
      },
    },
  },
});
