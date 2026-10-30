import type { Tone } from '#components/StateWord.tsx';
import type { Schemas } from '#lib/api.ts';
import type { Who } from './filters.ts';

export type AuditEvent = Schemas['AuditEvent'];

export const OUTCOME: Record<AuditEvent['outcome'], { label: string; tone: Tone }> = {
  success: { label: 'ok', tone: 'ok' },
  denied: { label: 'negado', tone: 'warn' },
  error: { label: 'erro', tone: 'danger' },
};

/** Grupo do filtro "Quem": o plugin age pelo bot, então conta como Sistema. */
export function whoOf(event: AuditEvent): Exclude<Who, 'todos'> {
  const kind = event.actor.kind;
  return kind === 'plugin' ? 'system' : kind;
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
    case 'plugin':
      return { name: actor.name, origin: 'plugin' };
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
