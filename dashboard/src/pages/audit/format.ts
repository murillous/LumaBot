import type { Tone } from '#components/StateWord.tsx';
import type { Schemas } from '#lib/api.ts';
import type { Who } from './filters.ts';

export type AuditEvent = Schemas['AuditEvent'];

export const OUTCOME: Record<AuditEvent['outcome'], { label: string; tone: Tone }> = {
  success: { label: 'ok', tone: 'ok' },
  denied: { label: 'negado', tone: 'warn' },
  error: { label: 'erro', tone: 'danger' },
};

/** A Luma grava o ato do WhatsApp com ator `plugin` e o titular (pseudônimo) em `details`. */
const HOLDER_KEYS = ['sender', 'contact', 'actor'] as const;

function holderOf(event: AuditEvent): string | undefined {
  if (event.actor.kind !== 'plugin') return undefined;
  for (const key of HOLDER_KEYS) {
    const value = event.details?.[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

/** Grupo do filtro "Quem": plugin sem titular age pelo bot, então conta como Sistema. */
export function whoOf(event: AuditEvent): Exclude<Who, 'todos'> {
  const kind = event.actor.kind;
  if (kind !== 'plugin') return kind;
  return holderOf(event) === undefined ? 'system' : 'contact';
}

/** Nome e origem do ator. O papel não vem no evento, então a origem é o que há para dizer. */
export function actorOf(event: AuditEvent): { name: string; origin: string } {
  const { actor } = event;
  switch (actor.kind) {
    case 'user':
      return {
        name: actor.name,
        origin: actor.onBehalfOf === undefined ? 'no painel' : `no painel, por ${actor.onBehalfOf}`,
      };
    case 'contact':
      return { name: actor.id, origin: `contato, ${actor.transport}` };
    case 'plugin': {
      const holder = holderOf(event);
      return holder === undefined
        ? { name: actor.name, origin: 'plugin' }
        : { name: holder, origin: `WhatsApp, via ${actor.name}` };
    }
    case 'system':
      return { name: 'sistema', origin: 'bot' };
  }
}

export function targetOf(event: AuditEvent): string {
  return event.target === undefined ? '—' : `${event.target.type} ${event.target.id}`;
}

export function detailsOf(event: AuditEvent): string {
  const { details } = event;
  return details === undefined || Object.keys(details).length === 0
    ? '—'
    : JSON.stringify(details, null, 2);
}

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export const whenOf = (at: string): string => WHEN.format(new Date(at));
