import type { UseQueryResult } from '@tanstack/react-query';
import { Chip } from '#components/Chip.tsx';
import { useSession } from '#components/context.tsx';
import type { Tone } from '#components/StateWord.tsx';
import { Card, ErrorNotice, Loading } from '#components/ui.tsx';
import { useAiStatus, usePlugins, useRecentProblems } from './queries.ts';
import { PageLink, Section } from './Remote.tsx';

interface Item {
  readonly key: string;
  readonly tone: Tone;
  readonly chip: string;
  readonly text: string;
  readonly mono?: boolean;
  readonly to: string;
  readonly link: string;
}

const SHOWN_LOGS = 5;

/** Quantos segundos faltam até `until`; o `ai/status` manda o fim do cooldown em ISO. */
const secondsUntil = (until: string): number =>
  Math.max(0, Math.ceil((Date.parse(until) - Date.now()) / 1000));

/** Uma fonte do card: o que ela leu ou o erro dela, sem derrubar as outras. */
function readSource<T>(
  query: UseQueryResult<T>,
  label: string,
  items: (data: T) => Item[],
): {
  items: Item[];
  pending: boolean;
  failure: { label: string; query: UseQueryResult<T> } | null;
} {
  if (query.isError) return { items: [], pending: false, failure: { label, query } };
  if (query.data === undefined) return { items: [], pending: query.isPending, failure: null };
  return { items: items(query.data), pending: false, failure: null };
}

/**
 * "Precisa de atenção": primeiro e em card. Cada fonte entra só com a permissão da API que lê, e o
 * card some quando a pessoa não tem nenhuma.
 */
export function Attention() {
  const { can } = useSession();
  const canAi = can('config.read');
  const canLogs = can('logs.read');
  const canPlugins = can('plugins.read');

  const ai = readSource(useAiStatus(canAi), 'o estado dos modelos de IA', (data) =>
    data.models.flatMap((m): Item[] => {
      if (m.state === 'unregistered')
        return [
          {
            key: `ai-${m.model}`,
            tone: 'warn',
            chip: 'Sem chave',
            text: m.model,
            mono: true,
            to: '/ia',
            link: 'Abrir IA',
          },
        ];
      if (m.state === 'cooldown')
        return [
          {
            key: `ai-${m.model}`,
            tone: 'warn',
            chip: m.until ? `Em espera, ${secondsUntil(m.until)} s` : 'Em espera',
            text: m.model,
            mono: true,
            to: '/ia',
            link: 'Abrir IA',
          },
        ];
      return [];
    }),
  );

  const logs = readSource(useRecentProblems(canLogs), 'os avisos e erros recentes', (data) => {
    const recent = [...data.logs].sort((a, b) => b.time - a.time);
    const shown = recent.slice(0, SHOWN_LOGS).map(
      (line, i): Item => ({
        key: `log-${line.time}-${i}`,
        tone: line.level === 'warn' ? 'warn' : 'danger',
        chip: line.level === 'warn' ? 'Aviso' : 'Erro',
        text: line.message,
        to: '/logs',
        link: 'Ver logs',
      }),
    );
    const more = recent.length - SHOWN_LOGS;
    return more > 0
      ? [
          ...shown,
          {
            key: 'log-more',
            tone: 'info',
            chip: 'Mais',
            text: `e mais ${more} avisos e erros nas últimas 24 h`,
            to: '/logs',
            link: 'Ver logs',
          },
        ]
      : shown;
  });

  const plugins = readSource(usePlugins(canPlugins), 'a lista de plugins', (data) =>
    data.plugins
      // `disabled` é escolha de quem configurou; o resto é plugin que não subiu.
      .filter((p) => p.status === 'skipped' && p.reason?.kind !== 'disabled')
      .map(
        (p): Item => ({
          key: `plugin-${p.name}`,
          tone: 'danger',
          chip: 'Falhou no boot',
          text: p.name,
          mono: true,
          to: `/plugins/${encodeURIComponent(p.name)}`,
          link: 'Ver plugin',
        }),
      ),
  );

  if (!canAi && !canLogs && !canPlugins) return null;

  const sources = [
    ...(canAi ? [ai] : []),
    ...(canPlugins ? [plugins] : []),
    ...(canLogs ? [logs] : []),
  ];
  const items = sources.flatMap((s) => s.items);
  const failures = sources.flatMap((s) => (s.failure ? [s.failure] : []));
  const pending = sources.some((s) => s.pending);

  return (
    <Section title="Precisa de atenção">
      <Card className="flex flex-col gap-4">
        {items.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                <Chip tone={item.tone}>{item.chip}</Chip>
                <span className={`min-w-0 break-words ${item.mono ? 'font-mono text-label' : ''}`}>
                  {item.text}
                </span>
                <span className="ml-auto">
                  <PageLink to={item.to}>{item.link}</PageLink>
                </span>
              </li>
            ))}
          </ul>
        )}
        {failures.map(({ label, query }) => (
          <div key={label} className="flex flex-col gap-2">
            <p className="text-help text-muted">Não deu para ler {label}.</p>
            <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ))}
        {pending && <Loading />}
        {!pending && items.length === 0 && failures.length === 0 && <p>Nada pendente</p>}
      </Card>
    </Section>
  );
}
