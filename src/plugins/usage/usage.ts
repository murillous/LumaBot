import {
  definePlugin,
  type Logger,
  type Message,
  type PluginDefinition,
  type ServiceAccess,
} from '@usebridger/core';
import { z } from 'zod';
import type {} from '#plugins/ai-context/ai-context.ts';
import { personId } from '#plugins/person-id.ts';
import { OBSERVER_FAILED, RECORD_FAILED } from './log-events.ts';

export type UsageOutcome = 'ok' | 'refused' | 'error';

/** Uma ação feita a pedido de alguém. */
export interface UsageEntry {
  /** `personId` de quem pediu. */
  readonly actor: string;
  readonly chatId: string;
  /** Plugin ou família da ação (`sticker`, `download`, `luma`...). */
  readonly action: string;
  /** Variante, de um conjunto fixo do plugin (`media`, `url`, `audio`...). */
  readonly kind: string;
  readonly outcome: UsageOutcome;
  /** US$ estimados, quando a ação tem custo conhecido. */
  readonly cost?: number;
}

/** Agregado de um dia (UTC) de uma pessoa, por chat, ação, variante e resultado. */
export interface UsageRow {
  readonly day: string;
  readonly chatId: string;
  readonly action: string;
  readonly kind: string;
  readonly outcome: UsageOutcome;
  readonly count: number;
  /** Soma dos custos informados; 0 se nenhum foi. */
  readonly cost: number;
}

/**
 * Serviço `usage`: o que cada pessoa pediu à Luma, por dia. Contrato estável; mudança
 * incompatível sobe a `version` do plugin.
 */
export interface UsageService {
  record(entry: UsageEntry): Promise<void>;
  /** Linhas de `actor` nos últimos `days` dias (padrão 30, em UTC, o de hoje incluído). */
  history(actor: string, options?: { days?: number }): Promise<UsageRow[]>;
}

/** Recebe cada ação registrada, com o instante (epoch ms). Quem cobra lê o uso por aqui. */
export type UsageObserver = (entry: UsageEntry & { readonly at: number }) => void | Promise<void>;

declare module '@usebridger/core' {
  interface Services {
    usage: UsageService;
  }
  interface ExtensionPoints {
    'usage.observers': UsageObserver;
  }
}

const DAY_MS = 86_400_000;
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

type Doc = {
  day: string;
  actor: string;
  chatId: string;
  action: string;
  kind: string;
  outcome: UsageOutcome;
  count: number;
  cost: number;
};

const config = z.object({
  /** Dias de histórico guardados; o mais antigo sai no primeiro registro de cada dia. */
  retentionDays: z.number().int().positive().default(90),
});

/**
 * Registra o uso de `message.sender` sem nunca atrapalhar a ação: sem o `usage`, não faz nada;
 * com falha, vai para o log.
 */
export async function recordUsage(
  services: ServiceAccess,
  log: Logger,
  message: Pick<Message, 'sender' | 'chat'>,
  entry: Omit<UsageEntry, 'actor' | 'chatId'>,
): Promise<void> {
  if (!services.has('usage')) return;
  try {
    await services
      .get('usage')
      .record({ ...entry, actor: personId(message.sender), chatId: message.chat.id });
  } catch (err) {
    log.event(RECORD_FAILED, { err, action: entry.action });
  }
}

/**
 * Uso por pessoa em todas as ações. Fica só no storage, nunca no `metrics`: id de pessoa não vira
 * rótulo. Nunca guarda texto do usuário.
 */
export const usage: PluginDefinition = definePlugin({
  name: 'usage',
  version: '0.1.0',
  engine: '<1.0.0',
  config,
  setup: (ctx) => {
    const rows = ctx.storage.collection<Doc>('daily', { indexes: ['day', 'actor'] });
    const observers = ctx.services.extensionPoint('usage.observers');
    const { retentionDays } = ctx.config;
    let prunedOn = '';

    const notify = (entry: UsageEntry & { at: number }) => {
      for (const observer of observers.list()) {
        const failed = (err: unknown) =>
          ctx.log.event(OBSERVER_FAILED, { action: entry.action, err });
        try {
          observer(entry)?.catch(failed);
        } catch (err) {
          failed(err);
        }
      }
    };

    const service: UsageService = {
      record: async (entry) => {
        const at = Date.now();
        const today = day(at);
        if (prunedOn !== today) {
          prunedOn = today;
          await rows.delete({ day: { lt: day(at - (retentionDays - 1) * DAY_MS) } });
        }
        const { actor, chatId, action, kind, outcome, cost } = entry;
        const where = { day: today, actor, chatId, action, kind, outcome };
        // `increment` com `insert` é atômico: sem linha, insere com 0 e soma.
        await rows.increment(where, 'count', 1, { insert: { ...where, count: 0, cost: 0 } });
        if (cost) await rows.increment(where, 'cost', cost);
        notify({ ...entry, at });
      },
      history: async (actor, { days = 30 } = {}) => {
        const from = day(Date.now() - (Math.max(days, 1) - 1) * DAY_MS);
        const found = await rows.find({
          where: { actor, day: { gte: from } },
          orderBy: { field: 'day', direction: 'desc' },
        });
        return found.map(({ day, chatId, action, kind, outcome, count, cost }) => ({
          day,
          chatId,
          action,
          kind,
          outcome,
          count,
          cost,
        }));
      },
    };
    ctx.services.provide('usage', service);

    // A leitura de PDF do `ai-context` conta como ação de PDF de quem pediu. O ponto não precisa
    // existir: sem o `ai-context`, a contribuição só não é lida.
    ctx.services.contribute('ai-context.observers', async ({ tool, outcome, message, log }) => {
      if (tool !== 'read_pdf') return;
      await recordUsage(ctx.services, log, message, { action: 'pdf', kind: 'read', outcome });
    });
  },
});
