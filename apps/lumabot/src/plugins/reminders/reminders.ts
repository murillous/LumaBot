import { bold, definePlugin, fmt, mention, type PluginDefinition } from '@usebridger/core';
import { z } from 'zod';
import { formatWhen, remaining, stats } from './format.ts';
import { brParser, type WhenParser } from './parse.ts';
import { isValidTimeZone } from './zone.ts';

/** Lembrete pendente. `fireAt` é epoch ms. */
export interface Reminder {
  readonly id: string;
  readonly chatId: string;
  readonly creatorId: string;
  /** Quem é mencionado no disparo; sem ninguém, o `creatorId`. */
  readonly mentionIds: readonly string[];
  readonly text: string;
  readonly fireAt: number;
}

export interface CreateReminderInput {
  readonly chatId: string;
  readonly creatorId: string;
  readonly mentionIds: readonly string[];
  readonly text: string;
  readonly fireAt: number;
}

export type ReminderErrorCode =
  | 'invalid-chat'
  | 'invalid-date'
  | 'past'
  | 'too-far'
  | 'empty-text'
  | 'text-too-long';

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
  }
}

const MESSAGES = {
  usage: 'Formato inválido. Use: {prefix}lembrete DD/MM HH:mm | mensagem',
  created: '✅ Lembrete criado!\n\n{when}\n{text}',
  fireTitle: '⏰ Lembrete:',
  errInvalidChat: '❌ Não consegui identificar o chat do lembrete.',
  errInvalidDate: '❌ Data/hora inválida.',
  errPast: '❌ A data/hora precisa estar no futuro.',
  errTooFar: '❌ Lembrete muito distante (máx. 1 ano).',
  errEmptyText: '❌ Informe a mensagem do lembrete.',
  errTextTooLong: '❌ A mensagem do lembrete passou de {max} caracteres.',
  listEmpty: '📝 Nenhum lembrete agendado neste chat.',
  listHeader: '⏰ Lembretes agendados ({count})',
  listItem: '{n}. {when}\n   {text}\n   ⏳ {remaining}',
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
} as const satisfies Record<ReminderErrorCode, keyof typeof MESSAGES>;

const MAX_TEXT_LENGTH = 500;
const MAX_HORIZON_MS = 365 * 24 * 60 * 60_000;
const JOB = 'fire';

const config = z.object({
  timeZone: z
    .string()
    .default('America/Sao_Paulo')
    .refine(isValidTimeZone, 'fuso IANA inválido (ex.: America/Sao_Paulo)'),
});

/** Documento guardado; o `jobId` liga ao job do scheduler para o cancelamento. */
type Doc = {
  chatId: string;
  creatorId: string;
  mentionIds: string[];
  text: string;
  fireAt: number;
  jobId: string;
};

const toReminder = (doc: Doc & { id: string }): Reminder => ({
  id: doc.id,
  chatId: doc.chatId,
  creatorId: doc.creatorId,
  mentionIds: doc.mentionIds,
  text: doc.text,
  fireAt: doc.fireAt,
});

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
 * é um job do scheduler do kernel (sobrevive a restart); a lista vem do storage.
 */
export const reminders: PluginDefinition = definePlugin({
  name: 'reminders',
  version: '1.0.0',
  engine: '<1.0.0',
  requires: ['send.text'],
  config,
  messages: MESSAGES,
  setup: (ctx) => {
    const docs = ctx.storage.collection<Doc>('reminders', { indexes: ['chatId', 'fireAt'] });

    // Disparo "pelo menos uma vez": o documento só sai depois do envio. Se o processo cair no
    // meio, o job volta e o lembrete sai de novo, em vez de se perder.
    ctx.scheduler.on(JOB, async (payload) => {
      const id = (payload as { id?: unknown } | null)?.id;
      if (typeof id !== 'string') {
        ctx.log.error('job de lembrete sem id', { payload });
        return;
      }
      const doc = await docs.get(id);
      // Cancelado entre o disparo e a leitura: nada a enviar.
      if (!doc) return;
      const mentions = doc.mentionIds.map((mid) => mention({ id: mid, name: null, phone: null }));
      const content = mentions.reduce(
        (acc, m, i) => fmt`${acc}${i === 0 ? '\n' : ' '}${m}`,
        fmt`${bold(ctx.plugin.messages.fireTitle)} ${doc.text}`,
      );
      try {
        await ctx.send.send(doc.chatId, content);
      } finally {
        // Não mascara o erro do envio se o delete também falhar.
        try {
          await docs.delete(id);
        } catch (err) {
          ctx.log.error('falha ao apagar lembrete disparado', { err, id });
        }
      }
    });

    ctx.services.contribute('reminders.parsers', brParser(ctx.config.timeZone));

    ctx.services.provide('reminders', {
      create: async (input) => {
        if (!input.chatId || !input.creatorId) throw new ReminderError('invalid-chat');
        const now = Date.now();
        if (!Number.isFinite(input.fireAt)) throw new ReminderError('invalid-date');
        if (input.fireAt <= now) throw new ReminderError('past');
        if (input.fireAt - now > MAX_HORIZON_MS) throw new ReminderError('too-far');
        const text = cleanText(input.text);
        if (!text) throw new ReminderError('empty-text');
        if (text.length > MAX_TEXT_LENGTH) throw new ReminderError('text-too-long');

        const mentionIds = [...new Set(input.mentionIds.filter(Boolean))];
        const doc: Doc = {
          chatId: input.chatId,
          creatorId: input.creatorId,
          mentionIds: mentionIds.length > 0 ? mentionIds : [input.creatorId],
          text,
          fireAt: input.fireAt,
          jobId: '',
        };
        const id = await docs.insert(doc);
        try {
          const jobId = await ctx.scheduler.at(doc.fireAt, JOB, { id });
          await docs.update(id, { jobId });
        } catch (err) {
          // Sem job não há disparo: não deixa o lembrete fantasma na lista.
          await docs.delete(id);
          throw err;
        }
        return toReminder({ ...doc, id });
      },

      list: async (chatId) => {
        const found = await docs.find({ where: { chatId }, orderBy: 'fireAt' });
        return found.map(toReminder);
      },

      cancel: async (chatId, id) => {
        const doc = await docs.get(id);
        if (!doc || doc.chatId !== chatId) return false;
        await docs.delete(id);
        await ctx.scheduler.cancel(doc.jobId);
        return true;
      },
    });
  },
  commands: {
    lembrete: {
      aliases: ['lembrar'],
      description: 'Cria um lembrete (`!lembrete DD/MM HH:mm | mensagem`)',
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
            fireAt: parsed.fireAt,
          });
          return c.t('created', {
            when: formatWhen(reminder.fireAt, plugin.config.timeZone),
            text: reminder.text,
          });
        } catch (err) {
          if (err instanceof ReminderError) {
            return c.t(ERROR_MESSAGES[err.code], { max: MAX_TEXT_LENGTH });
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
          return c.t('listItem', {
            n: i + 1,
            when: formatWhen(r.fireAt, zone),
            text: r.text,
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
      description: 'Cancela um lembrete pelo número da lista (`!cancelarlembrete 1`)',
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
