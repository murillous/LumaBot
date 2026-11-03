import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useApi, useSession } from '#components/context.tsx';
import { PageTitle } from '#components/PageTitle.tsx';
import { Segmented } from '#components/Segmented.tsx';
import { Table } from '#components/Table.tsx';
import { ErrorNotice, Field, Forbidden, inputClass, Loading } from '#components/ui.tsx';
import { ApiFailure, ok, type Schemas } from '#lib/api.ts';
import { setSearch, useSearch } from '#lib/router.tsx';
import { Chart, Legend } from './metrics/Chart.tsx';
import {
  type Filters,
  fromSearch,
  type Granularity,
  type Period,
  toggleGroup,
  toQuery,
  toSearch,
  whereValue,
  withWhere,
} from './metrics/filters.ts';
import { formatValue, MEASURE, periodsOf, seriesOf } from './metrics/series.ts';

type Descriptor = Schemas['MetricDescriptor'];

const PERIOD_OPTIONS: readonly { value: Period; label: string }[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'datas', label: 'Escolher datas' },
];

const GRANULARITY_OPTIONS: readonly { value: Granularity; label: string }[] = [
  { value: 'dia', label: 'Por dia' },
  { value: 'hora', label: 'Por hora' },
];

const TYPE_LABEL: Record<Descriptor['type'], string> = {
  counter: 'Contador',
  histogram: 'Histograma',
  gauge: 'Medidor',
};

/** Grupo do `select` pelo prefixo do nome: `ai_*` da IA, `luma_*` da Luma, o resto é do kernel. */
const groupOf = (name: string): string =>
  name.startsWith('ai_') ? 'IA' : name.startsWith('luma_') ? 'Luma' : 'Kernel';

const GROUP_ORDER = ['Kernel', 'IA', 'Luma'];

/** Sem o plugin `metrics` carregado, as duas rotas respondem 404. */
const isMissing = (error: unknown): boolean => error instanceof ApiFailure && error.status === 404;

export function Metrics() {
  const { can } = useSession();
  if (!can('metrics.read')) return <Forbidden />;
  return <MetricsScreen />;
}

function MetricsScreen() {
  const { client } = useApi();
  const search = useSearch();
  const filters = useMemo(() => fromSearch(search), [search]);

  const catalog = useQuery({
    queryKey: ['metrics', 'catalog'],
    queryFn: () => ok(client.GET('/api/plugins/metrics/catalog')),
  });

  const metrics = catalog.data?.metrics ?? [];
  // Sem métrica na URL, a primeira do kernel (ou do catálogo) para a tela não abrir vazia.
  const metric =
    filters.metric !== ''
      ? filters.metric
      : (metrics.find((m) => groupOf(m.name) === 'Kernel') ?? metrics[0])?.name;
  const descriptor = metrics.find((m) => m.name === metric);

  const change = (patch: Partial<Filters>) =>
    setSearch(toSearch({ ...filters, metric: metric ?? '', ...patch }), { replace: true });

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <PageTitle>Métricas</PageTitle>
        <p className="text-help text-muted">
          Qualquer métrica do catálogo, no tempo. Os períodos são em UTC.
        </p>
      </header>

      {catalog.isPending && <Loading label="Carregando métricas…" />}
      {catalog.isError &&
        (isMissing(catalog.error) ? (
          <p role="status" className="rounded-field bg-warn-soft p-4 text-warn">
            O plugin de métricas não está carregado neste bot. Ligue o <code>metrics</code> em
            Plugins para ver as séries.
          </p>
        ) : (
          <ErrorNotice error={catalog.error} onRetry={() => void catalog.refetch()} />
        ))}
      {catalog.data !== undefined &&
        (metrics.length === 0 ? (
          <p className="rounded-card bg-raised p-8 text-center text-muted shadow-[var(--e1),var(--top)]">
            Nenhuma métrica registrada ainda.
          </p>
        ) : (
          <>
            <Controls
              metrics={metrics}
              filters={filters}
              metric={metric ?? ''}
              descriptor={descriptor}
              change={change}
            />
            {descriptor === undefined ? (
              <p role="status" className="text-muted">
                A métrica {metric} não está no catálogo.
              </p>
            ) : (
              <Result filters={filters} metric={descriptor.name} />
            )}
          </>
        ))}
    </section>
  );
}

function Controls({
  metrics,
  filters,
  metric,
  descriptor,
  change,
}: {
  metrics: readonly Descriptor[];
  filters: Filters;
  metric: string;
  descriptor: Descriptor | undefined;
  change: (patch: Partial<Filters>) => void;
}) {
  const groups = GROUP_ORDER.map((name) => ({
    name,
    items: metrics.filter((m) => groupOf(m.name) === name),
  })).filter((group) => group.items.length > 0);
  const labels = descriptor?.labelNames ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Métrica"
        {...(descriptor && {
          help: `${TYPE_LABEL[descriptor.type]}${descriptor.help === '' ? '' : `. ${descriptor.help}`}`,
        })}
      >
        {(props) => (
          <select
            {...props}
            className={`${inputClass} md:max-w-xl`}
            value={metric}
            // Rótulos são de cada métrica: filtro e agrupamento da anterior não valem na nova.
            onChange={(e) => change({ metric: e.target.value, where: [], groupBy: [] })}
          >
            {descriptor === undefined && <option value={metric}>{metric}</option>}
            {groups.map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.items.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Período"
          options={PERIOD_OPTIONS}
          value={filters.period}
          onChange={(period) => change({ period })}
        />
        <Segmented
          label="Granularidade"
          options={GRANULARITY_OPTIONS}
          value={filters.granularity}
          onChange={(granularity) => change({ granularity })}
        />
        {filters.period === 'datas' && (
          <>
            <input
              type="date"
              aria-label="De"
              className={`${inputClass} w-auto`}
              value={filters.from}
              onChange={(e) => change({ from: e.target.value })}
            />
            <input
              type="date"
              aria-label="Até"
              className={`${inputClass} w-auto`}
              value={filters.to}
              onChange={(e) => change({ to: e.target.value })}
            />
          </>
        )}
      </div>

      {labels.length > 0 && (
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
            <legend className="mb-1 font-medium">Agrupar por</legend>
            <div className="flex flex-wrap gap-x-4">
              {labels.map((label) => (
                <label
                  key={label}
                  className="flex min-h-11 items-center gap-2 font-mono text-label"
                >
                  <input
                    type="checkbox"
                    checked={filters.groupBy.includes(label)}
                    onChange={() => change({ groupBy: toggleGroup(filters.groupBy, label) })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="m-0 flex min-w-0 flex-1 flex-col gap-1 border-0 p-0">
            <legend className="mb-1 font-medium">Filtrar por rótulo</legend>
            <div className="flex flex-wrap gap-3">
              {labels.map((label) => (
                <WhereInput
                  key={label}
                  label={label}
                  value={whereValue(filters.where, label)}
                  onCommit={(value) => change({ where: withWhere(filters.where, label, value) })}
                />
              ))}
            </div>
            <p className="text-help text-muted">
              Valor exato do rótulo. Enter ou sair do campo aplica; vazio tira o filtro.
            </p>
          </fieldset>
        </div>
      )}
    </div>
  );
}

/** Campo de um rótulo: digita à vontade e só consulta ao confirmar, para não refazer a série a cada tecla. */
function WhereInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft);
  };
  return (
    <input
      type="text"
      aria-label={`Filtrar ${label}`}
      placeholder={label}
      className={`${inputClass} w-44 font-mono`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

function Result({ filters, metric }: { filters: Filters; metric: string }) {
  const { client } = useApi();
  // O "agora" do período vale enquanto o filtro não muda: refazer a cada render trocaria a chave
  // da query e a série recarregaria sem parar.
  const query = useMemo(() => toQuery({ ...filters, metric }, new Date()), [filters, metric]);

  const result = useQuery({
    queryKey: ['metrics', 'query', query],
    enabled: query !== null,
    queryFn: () =>
      ok(
        client.GET('/api/plugins/metrics/query', {
          params: { query: query as NonNullable<typeof query> },
        }),
      ),
  });

  const rows = result.data?.rows;
  const { series, hidden } = useMemo(() => seriesOf(rows ?? []), [rows]);

  if (query === null) {
    return (
      <p role="status" className="text-muted">
        Escolha as duas datas, com a inicial antes da final.
      </p>
    );
  }
  if (result.isPending) return <Loading label="Carregando série…" />;
  if (result.isError) {
    return isMissing(result.error) ? (
      <p role="status" className="rounded-field bg-warn-soft p-4 text-warn">
        O plugin de métricas não está carregado neste bot.
      </p>
    ) : (
      <ErrorNotice error={result.error} onRetry={() => void result.refetch()} />
    );
  }
  if (series.length === 0) {
    return (
      <p className="rounded-card bg-raised p-8 text-center text-muted shadow-[var(--e1),var(--top)]">
        Nenhum dado nesse período.
      </p>
    );
  }

  const type = result.data.rows[0]?.type ?? 'counter';
  const periods = periodsOf(query, series);
  const filled = periods.filter((period) => series.some((s) => s.values.has(period)));
  const grouped = filters.groupBy.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-help text-muted">
        {metric}: {MEASURE[type]}, {filters.granularity === 'hora' ? 'por hora' : 'por dia'}.
      </p>
      <div className="overflow-x-auto rounded-card bg-raised p-4 shadow-[var(--e1),var(--top)]">
        <Chart
          label={`Gráfico de linhas de ${metric}, ${series.length} ${series.length === 1 ? 'série' : 'séries'}. Os mesmos valores estão na tabela abaixo.`}
          periods={periods}
          series={series}
        />
      </div>
      {grouped && <Legend series={series} />}
      {hidden > 0 && (
        <p role="status" className="text-help text-warn">
          Mostrando as {series.length} séries de maior valor; mais {hidden}{' '}
          {hidden === 1 ? 'grupo ficou' : 'grupos ficaram'} de fora. Filtre por rótulo para ver
          {hidden === 1 ? ' o' : ' os'} outro{hidden === 1 ? '' : 's'}.
        </p>
      )}
      <Table label="Valores da série">
        <thead>
          <tr>
            <th scope="col">Período</th>
            {series.map((s) => (
              <th key={s.name} scope="col" className="break-all">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filled.map((period) => (
            <tr key={period}>
              <th scope="row" className="font-mono text-label font-normal text-muted">
                {period}
              </th>
              {series.map((s) => {
                const value = s.values.get(period);
                return (
                  <td key={s.name}>
                    {value === undefined ? (
                      <span className="text-muted">sem dado</span>
                    ) : (
                      formatValue(value)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
