import { useQueries } from '@tanstack/react-query';
import { useApi } from '#components/context.tsx';
import { ok } from '#lib/api.ts';
import { useMetricCatalog } from './queries.ts';
import { Remote, Section } from './Remote.tsx';

interface Indicator {
  readonly label: string;
  /** Métrica do catálogo; sem ela no catálogo, o indicador não aparece. */
  readonly metric: string;
  readonly where?: string;
}

// Só o que o `plugin-metrics` entrega hoje. Custo não está aqui: o `aiMetrics.summary` calcula o
// custo na consulta e nenhuma métrica o guarda, então não há número com fonte para mostrar.
const INDICATORS: readonly Indicator[] = [
  { label: 'Mensagens', metric: 'bridger_messages_handled_total' },
  { label: 'Respostas da IA', metric: 'ai_attempts_total', where: 'outcome:ok' },
  { label: 'Erros', metric: 'bridger_messages_handled_total', where: 'status:error' },
];

const number = new Intl.NumberFormat('pt-BR');

/** O dia de hoje em UTC, que é o fuso padrão do `plugin-metrics`. */
const today = (): string => new Date().toISOString().slice(0, 10);

function Values({ indicators }: { indicators: readonly Indicator[] }) {
  const api = useApi();
  const results = useQueries({
    queries: indicators.map((i) => ({
      queryKey: ['overview', 'metric', i.metric, i.where ?? ''],
      queryFn: async () => {
        const day = today();
        const { rows } = await ok(
          api.client.GET('/api/plugins/metrics/query', {
            params: {
              query: {
                name: i.metric,
                from: day,
                to: day,
                groupBy: '',
                ...(i.where && { where: i.where }),
              },
            },
          }),
        );
        return rows.reduce((sum, row) => sum + (row.type === 'counter' ? row.value : 0), 0);
      },
    })),
  });

  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-4">
      {indicators.map((indicator, i) => {
        const result = results[i];
        return (
          <div key={indicator.label} className="flex flex-col">
            <dt className="text-help text-muted">{indicator.label}</dt>
            <dd className="font-display text-section font-semibold">
              {result?.data !== undefined ? (
                number.format(result.data)
              ) : result?.isError ? (
                <button
                  type="button"
                  onClick={() => void result.refetch()}
                  className="min-h-11 text-body font-normal underline"
                >
                  Tentar de novo
                </button>
              ) : (
                <span className="text-muted">…</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** "Hoje" em linha, sem cards: contagens do `plugin-metrics`, só das métricas que existem. */
export function Today() {
  const catalog = useMetricCatalog();
  return (
    <Section title="Hoje">
      <Remote query={catalog}>
        {({ metrics }) => {
          const known = new Set(metrics.map((m) => m.name));
          const shown = INDICATORS.filter((i) => known.has(i.metric));
          if (shown.length === 0) return <p className="text-muted">Nenhuma métrica registrada.</p>;
          return <Values indicators={shown} />;
        }}
      </Remote>
    </Section>
  );
}
