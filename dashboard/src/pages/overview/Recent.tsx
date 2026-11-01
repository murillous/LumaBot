import { actorOf, whenOf } from '#pages/audit/format.ts';
import { titleOf } from '#pages/audit/titles.ts';
import { useRecentAudit } from './queries.ts';
import { Remote, Section } from './Remote.tsx';

/** Os últimos atos administrativos; o histórico inteiro fica na tela Auditoria. */
export function RecentChanges() {
  const recent = useRecentAudit();
  return (
    <Section title="Mudanças recentes" link={{ to: '/auditoria', label: 'Ver auditoria' }}>
      <Remote query={recent}>
        {({ events }) =>
          events.length === 0 ? (
            <p className="text-muted">Nenhuma mudança registrada.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {events.map((event) => (
                <li key={event.seq} className="flex flex-wrap items-baseline gap-x-3 py-2">
                  <span className="min-w-0">{titleOf(event.action)}</span>
                  <span className="min-w-0 break-all text-help text-muted">
                    {actorOf(event).name}
                  </span>
                  <span className="ml-auto font-mono text-label text-muted">
                    {whenOf(event.at)}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </Remote>
    </Section>
  );
}
