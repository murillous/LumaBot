import { StateWord, type Tone } from '#components/StateWord.tsx';
import type { Schemas } from '#lib/api.ts';
import { useAiStatus, useRecentAudit } from './queries.ts';
import { Remote, Section } from './Remote.tsx';

type ModelState = 'ready' | 'cooldown' | 'unregistered';

const secondsUntil = (until: string): number =>
  Math.max(0, Math.ceil((Date.parse(until) - Date.now()) / 1000));

function stateOf(model: { state: ModelState; until?: string }): { tone: Tone; word: string } {
  if (model.state === 'ready') return { tone: 'ok', word: 'pronto' };
  if (model.state === 'cooldown')
    return {
      tone: 'warn',
      word: model.until ? `em espera, ${secondsUntil(model.until)} s` : 'em espera',
    };
  return { tone: 'warn', word: 'pulado, sem chave' };
}

/** A cadeia principal na ordem de tentativa, com o estado de cada posição; edita-se na tela IA. */
export function ChainSummary() {
  const status = useAiStatus();
  return (
    <Section title="Cadeia de IA" link={{ to: '/ia', label: 'Editar' }}>
      <Remote query={status}>
        {({ models }) =>
          models.length === 0 ? (
            <p className="text-muted">Nenhum modelo na cadeia.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {models.map((model, i) => {
                const { tone, word } = stateOf(model);
                return (
                  <li key={model.model} className="flex flex-wrap items-baseline gap-x-3 py-2">
                    <span className="w-6 text-muted">{i + 1}.</span>
                    <span className="min-w-0 break-all font-mono text-label">{model.model}</span>
                    <span className="ml-auto">
                      <StateWord tone={tone}>{word}</StateWord>
                    </span>
                  </li>
                );
              })}
            </ol>
          )
        }
      </Remote>
    </Section>
  );
}

const OUTCOME: Record<Schemas['AuditEvent']['outcome'], { tone: Tone; word: string }> = {
  success: { tone: 'ok', word: 'sucesso' },
  denied: { tone: 'warn', word: 'negado' },
  error: { tone: 'danger', word: 'erro' },
};

function actorName(actor: Schemas['AuditEvent']['actor']): string {
  switch (actor.kind) {
    case 'user':
      return actor.name;
    case 'plugin':
      return actor.name;
    case 'contact':
      return 'WhatsApp';
    case 'system':
      return 'Sistema';
  }
}

const when = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Últimas mudanças da auditoria. O título legível de cada `action` é da tela Auditoria; aqui a
 * própria `action` em mono, até o mapa de títulos virar módulo compartilhado.
 */
export function RecentAudit() {
  const audit = useRecentAudit();
  return (
    <Section title="Mudanças recentes" link={{ to: '/auditoria', label: 'Ver auditoria' }}>
      <Remote query={audit}>
        {({ events }) =>
          events.length === 0 ? (
            <p className="text-muted">Nenhuma mudança registrada.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {[...events]
                .sort((a, b) => b.seq - a.seq)
                .map((event) => {
                  const { tone, word } = OUTCOME[event.outcome];
                  return (
                    <li key={event.eventId} className="flex flex-col gap-1 py-2">
                      <div className="flex flex-wrap items-baseline gap-x-3">
                        <span className="min-w-0 break-all font-mono text-label">
                          {event.action}
                        </span>
                        <span className="ml-auto">
                          <StateWord tone={tone}>{word}</StateWord>
                        </span>
                      </div>
                      <p className="text-help text-muted">
                        {actorName(event.actor)} · {when.format(new Date(event.at))}
                      </p>
                    </li>
                  );
                })}
            </ul>
          )
        }
      </Remote>
    </Section>
  );
}
