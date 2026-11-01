import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useApi, useSession } from '#components/context.tsx';
import { PageTitle } from '#components/PageTitle.tsx';
import { Segmented } from '#components/Segmented.tsx';
import { StateWord } from '#components/StateWord.tsx';
import { ExpandRow, Table } from '#components/Table.tsx';
import { Button, ErrorNotice, Forbidden, inputClass, Loading } from '#components/ui.tsx';
import { ok } from '#lib/api.ts';
import { setSearch, useSearch } from '#lib/router.tsx';
import { ChainStatus } from './audit/ChainStatus.tsx';
import {
  type Filters,
  fromSearch,
  type Outcome,
  type Period,
  toQuery,
  toSearch,
  type Who,
} from './audit/filters.ts';
import {
  type AuditEvent,
  actorOf,
  detailsOf,
  OUTCOME,
  targetOf,
  whenOf,
  whoOf,
} from './audit/format.ts';
import { titleOf } from './audit/titles.ts';

const PAGE_SIZE = 100;

const WHO_OPTIONS: readonly { value: Who; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'user', label: 'Painel' },
  { value: 'contact', label: 'WhatsApp' },
  { value: 'system', label: 'Sistema' },
];

const OUTCOME_OPTIONS: readonly { value: Outcome | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Qualquer resultado' },
  { value: 'success', label: 'Ok' },
  { value: 'denied', label: 'Negado' },
  { value: 'error', label: 'Erro' },
];

const PERIOD_OPTIONS: readonly { value: Period; label: string }[] = [
  { value: '7d', label: 'Últimos 7 dias' },
  { value: 'hoje', label: 'Hoje' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'todo', label: 'Todo o período' },
  { value: 'datas', label: 'Escolher datas' },
];

export function Audit() {
  const { can } = useSession();
  if (!can('audit.read')) return <Forbidden />;
  return <AuditScreen />;
}

function AuditScreen() {
  const { client } = useApi();
  const search = useSearch();
  const filters = useMemo(() => fromSearch(search), [search]);
  const [open, setOpen] = useState<number | null>(null);

  // O "agora" do período vale enquanto o filtro não muda: refazer a cada render trocaria a chave
  // da query e a lista recarregaria sem parar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: o filtro é a identidade do período
  const query = useMemo(
    () => toQuery(filters, new Date()),
    [filters.period, filters.from, filters.to, filters.outcome, filters.action],
  );

  const events = useInfiniteQuery({
    queryKey: ['audit-page', query],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      ok(
        client.GET('/api/audit', {
          params: {
            query: {
              ...query,
              limit: PAGE_SIZE,
              ...(pageParam !== undefined && { after: pageParam }),
            },
          },
        }),
      ),
    // Página curta é a última; a API devolve em ordem crescente de seq e o cursor é o último seq.
    getNextPageParam: (page) => (page.events.length < PAGE_SIZE ? undefined : page.next),
  });

  const verify = useMutation({ mutationFn: () => ok(client.POST('/api/audit/verify')) });

  const change = (patch: Partial<Filters>) =>
    setSearch(toSearch({ ...filters, ...patch }), { replace: true });

  // "Quem" é do cliente: a API só filtra por id de ator, não por tipo (issue 316 do usebridger, `actorKind`).
  const all = events.data?.pages.flatMap((page) => page.events) ?? [];
  const shown = filters.who === 'todos' ? all : all.filter((event) => whoOf(event) === filters.who);

  // Mesma origem do bot: o cookie vai no download, sem fetch.
  const exportHref = (format: 'csv' | 'json') =>
    `/api/audit/export?${new URLSearchParams([...Object.entries(query).map(([k, v]) => [k, String(v)] as [string, string]), ['format', format]])}`;

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-72 flex-1 flex-col gap-1">
          <PageTitle>Auditoria</PageTitle>
          <p className="text-help text-muted">
            Atos administrativos no painel e no WhatsApp. Conversas e respostas da IA não entram.
          </p>
        </div>
        <a
          href={exportHref('csv')}
          download
          className="inline-flex min-h-11 items-center justify-center rounded-btn bg-plate px-4 font-medium text-ink"
        >
          Exportar CSV
        </a>
        <a
          href={exportHref('json')}
          download
          className="inline-flex min-h-11 items-center justify-center rounded-btn bg-plate px-4 font-medium text-ink"
        >
          Exportar JSON
        </a>
      </header>
      {filters.who !== 'todos' && (
        <p className="text-help text-muted">
          A exportação leva todos os atores: a API ainda não filtra por tipo de ator.
        </p>
      )}

      <ChainStatus verify={verify} />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Quem"
          options={WHO_OPTIONS}
          value={filters.who}
          onChange={(who) => change({ who })}
        />
        <Segmented
          label="Resultado"
          options={OUTCOME_OPTIONS}
          value={filters.outcome}
          onChange={(outcome) => change({ outcome })}
        />
        <select
          aria-label="Período"
          className={`${inputClass} w-auto`}
          value={filters.period}
          onChange={(e) => change({ period: e.target.value as Period })}
        >
          {PERIOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
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

      {events.isPending && <Loading label="Carregando eventos…" />}
      {events.isError && events.data === undefined && (
        <ErrorNotice error={events.error} onRetry={() => void events.refetch()} />
      )}
      {events.data !== undefined && (
        <>
          {shown.length === 0 ? (
            <p className="rounded-card bg-raised p-8 text-center text-muted shadow-[var(--e1),var(--top)]">
              Nenhum evento com esses filtros.
            </p>
          ) : (
            <Table label="Eventos">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>O quê</th>
                  <th>Quem</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((event) => (
                  <EventRow
                    key={event.seq}
                    event={event}
                    expanded={open === event.seq}
                    onToggle={() => setOpen(open === event.seq ? null : event.seq)}
                    onOnlyAction={() => {
                      setOpen(null);
                      change({ action: event.action });
                    }}
                  />
                ))}
              </tbody>
            </Table>
          )}
          {events.isError && (
            <ErrorNotice error={events.error} onRetry={() => void events.fetchNextPage()} />
          )}
          {/* A API pagina do mais antigo para o mais novo; ordem decrescente é issue 315 do usebridger. */}
          <p className="text-help text-muted">
            A lista vai do evento mais antigo para o mais novo no período.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-60 flex-1 text-help text-muted">
              {shown.length} {shown.length === 1 ? 'evento' : 'eventos'}
              {events.hasNextPage && ' carregados'}
              {filters.action !== '' && ` de ${filters.action}`}. Contatos aparecem pseudonimizados.
            </p>
            {filters.action !== '' && (
              <Button onClick={() => change({ action: '' })}>Todas as ações</Button>
            )}
            {events.hasNextPage && (
              <Button
                disabled={events.isFetchingNextPage}
                onClick={() => void events.fetchNextPage()}
              >
                Carregar mais
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function EventRow({
  event,
  expanded,
  onToggle,
  onOnlyAction,
}: {
  event: AuditEvent;
  expanded: boolean;
  onToggle: () => void;
  onOnlyAction: () => void;
}) {
  const who = actorOf(event);
  const outcome = OUTCOME[event.outcome];
  return (
    <ExpandRow
      expanded={expanded}
      onToggle={onToggle}
      cells={[
        <span key="when" className="font-mono text-label text-muted">
          {whenOf(event.at)}
        </span>,
        <span key="what" className="flex min-w-0 flex-col">
          <span>{titleOf(event.action)}</span>
          <span className="break-all font-mono text-label text-muted">{event.action}</span>
        </span>,
        <span key="who" className="flex min-w-0 flex-col">
          <span className="break-all">{who.name}</span>
          <span className="text-help text-muted">{who.origin}</span>
        </span>,
        <StateWord key="outcome" tone={outcome.tone}>
          {outcome.label}
        </StateWord>,
      ]}
      detail={
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <dl className="m-0 grid min-w-60 flex-1 grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
            <dt className="text-help text-muted">Alvo</dt>
            <dd className="m-0 break-all font-mono text-label">{targetOf(event)}</dd>
            <dt className="text-help text-muted">Detalhes</dt>
            <dd className="m-0">
              <pre className="m-0 whitespace-pre-wrap break-all font-mono text-label text-ink2">
                {detailsOf(event)}
              </pre>
            </dd>
            <dt className="text-help text-muted">Seq e hash</dt>
            <dd className="m-0 break-all font-mono text-label text-muted">
              #{event.seq} · {event.hash}
            </dd>
          </dl>
          <div>
            <Button onClick={onOnlyAction}>Só esta ação</Button>
          </div>
        </div>
      }
    />
  );
}
