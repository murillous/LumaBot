import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useApi, useLive, useLiveEvent } from '#components/context.tsx';
import { PageTitle } from '#components/PageTitle.tsx';
import { Segmented } from '#components/Segmented.tsx';
import { StateWord } from '#components/StateWord.tsx';
import { Button, ErrorNotice, inputClass, Loading } from '#components/ui.tsx';
import { ok } from '#lib/api.ts';
import { setSearch, useSearch } from '#lib/router.tsx';
import { EventsByPlugin } from './logs/EventsByPlugin.tsx';
import { LogTable } from './logs/LogTable.tsx';
import {
  asLogLine,
  BUFFER_LINES,
  countByLevel,
  eventsByPlugin,
  type Filters,
  filtersFromSearch,
  filtersToSearch,
  LEVEL_OPTIONS,
  matches,
  mergeLines,
  pluginsIn,
  streamReducer,
} from './logs/lines.ts';

/** A API aceita até 1000 por página: a 1ª já traz o buffer inteiro. "Mais antigas" segue o `next`. */
const PAGE = BUFFER_LINES;

const number = new Intl.NumberFormat('pt-BR');

const CHIP =
  'min-h-11 cursor-pointer rounded-full px-3 font-mono text-label text-muted shadow-[0_0_0_1px_var(--line2)] aria-pressed:bg-ink aria-pressed:text-bg aria-pressed:shadow-none';

/** Estado do stream em palavra; some quando a pessoa não tem `connection.read`. */
function LiveIndicator({ paused }: { paused: boolean }) {
  const { status } = useLive();
  if (status === 'off') return null;
  if (paused) return <span className="text-muted">Pausado</span>;
  if (status === 'live') return <StateWord tone="ok">Ao vivo</StateWord>;
  if (status === 'reconnecting') return <StateWord tone="warn">Reconectando</StateWord>;
  return <span className="text-muted">Conectando</span>;
}

export function Logs() {
  const { client } = useApi();
  const { status } = useLive();
  const search = useSearch();
  const filters = useMemo(() => filtersFromSearch(search), [search]);

  const history = useInfiniteQuery({
    queryKey: ['logs'],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      ok(
        client.GET('/api/logs', {
          params: {
            query: { limit: PAGE, ...(pageParam !== undefined && { before: pageParam }) },
          },
        }),
      ),
    getNextPageParam: (page) => page.next,
  });

  // Linhas do stream, da mais nova para a mais antiga. Pausado, o que chega espera em `pending`
  // e entra de uma vez ao retomar.
  const [{ live, pending, paused }, dispatch] = useReducer(streamReducer, {
    live: [],
    pending: [],
    paused: false,
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  useLiveEvent('log', (data) => {
    const line = asLogLine(data);
    if (line === null) return;
    dispatch({ type: 'line', line });
  });

  // Ao voltar de "reconectando", as linhas do intervalo não vieram pelo stream: busca de novo o
  // histórico (o dedupe de `mergeLines` cobre a sobreposição).
  // Pausada, a reconexão só marca o buraco; a releitura espera o "Retomar".
  const previous = useRef(status);
  const [gap, setGap] = useState(false);
  const { refetch } = history;
  useEffect(() => {
    if (previous.current === 'reconnecting' && status === 'live') {
      if (paused) setGap(true);
      else void refetch();
    }
    previous.current = status;
  }, [status, paused, refetch]);
  useEffect(() => {
    if (!paused && gap) {
      setGap(false);
      void refetch();
    }
  }, [paused, gap, refetch]);

  const loaded = useMemo(
    () => mergeLines(live, history.data?.pages.flatMap((page) => page.logs) ?? []),
    [live, history.data],
  );
  const visible = useMemo(() => loaded.filter((line) => matches(line, filters)), [loaded, filters]);
  const counts = useMemo(() => countByLevel(loaded), [loaded]);
  const plugins = useMemo(
    () => [...new Set([...pluginsIn(loaded), ...filters.plugins])].sort(),
    [loaded, filters.plugins],
  );
  const coverage = useMemo(() => eventsByPlugin(loaded), [loaded]);

  // Clique empilha no histórico (o "voltar" desfaz o filtro); a busca de texto muda a cada tecla e
  // por isso troca a entrada em vez de empilhar.
  const update = useCallback(
    (patch: Partial<Filters>, replace = false) =>
      setSearch(filtersToSearch({ ...filters, ...patch }), { replace }),
    [filters],
  );
  const togglePlugin = (name: string) =>
    update({
      plugins: filters.plugins.includes(name)
        ? filters.plugins.filter((p) => p !== name)
        : [...filters.plugins, name],
    });

  // Falha da 1ª página troca a tela pelo erro; falha de "Mais antigas" mantém o que já veio.
  const firstLoadFailed = history.isError && history.data === undefined;
  const canPause = status !== 'off';

  return (
    <section className="flex max-w-[1100px] flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-[1_1_320px]">
          <PageTitle>Logs</PageTitle>
          <p className="text-help text-muted">
            Últimas {number.format(BUFFER_LINES)} linhas desde o restart.
          </p>
        </div>
        <span role="status" aria-label="Fluxo ao vivo">
          <LiveIndicator paused={paused} />
        </span>
        {canPause && (
          <Button onClick={() => dispatch({ type: 'toggle' })} aria-pressed={paused}>
            {paused
              ? `Retomar${pending.length > 0 ? ` (${number.format(pending.length)} ${pending.length === 1 ? 'nova' : 'novas'})` : ''}`
              : 'Pausar'}
          </Button>
        )}
      </header>

      <section aria-label="Filtros" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Nível mínimo"
            value={filters.level}
            onChange={(level) => update({ level })}
            options={LEVEL_OPTIONS.map((level) => ({
              value: level,
              label: `${level} ${number.format(counts[level])}`,
            }))}
          />
          <input
            type="search"
            aria-label="Buscar evento ou texto"
            placeholder="evento ou texto"
            value={filters.query}
            onChange={(e) => update({ query: e.target.value }, true)}
            className={`${inputClass} max-w-80 flex-[1_1_220px] font-mono`}
          />
          {filters.event !== '' && (
            <Button onClick={() => update({ event: '' })}>
              Evento: <span className="font-mono">{filters.event}</span> (limpar)
            </Button>
          )}
        </div>
        {plugins.length > 0 && (
          <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
            <legend className="sr-only">Plugins</legend>
            {plugins.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={filters.plugins.includes(name)}
                onClick={() => togglePlugin(name)}
                className={CHIP}
              >
                {name}
              </button>
            ))}
            {filters.plugins.length > 0 && (
              <Button onClick={() => update({ plugins: [] })}>Todos</Button>
            )}
          </fieldset>
        )}
      </section>

      {history.isPending ? (
        <Loading label="Carregando logs…" />
      ) : firstLoadFailed ? (
        <ErrorNotice error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <section aria-label="Histórico" className="flex flex-col gap-3">
          {visible.length === 0 ? (
            <p className="rounded-card bg-raised p-8 text-center text-muted shadow-e1">
              {loaded.length === 0
                ? 'Nenhuma linha desde o restart'
                : 'Nenhuma linha com esses filtros'}
            </p>
          ) : (
            <LogTable
              lines={visible}
              expanded={expanded}
              onToggle={(key) => setExpanded((current) => (current === key ? null : key))}
              onSameEvent={(event) => {
                setExpanded(null);
                update({ event });
              }}
            />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-[1_1_260px] text-help text-muted">
              {number.format(visible.length)} de {number.format(BUFFER_LINES)} linhas. Chat e
              contato aparecem pseudonimizados.
            </p>
            {history.hasNextPage && loaded.length < BUFFER_LINES && (
              <Button
                onClick={() => void history.fetchNextPage()}
                disabled={history.isFetchingNextPage}
              >
                Mais antigas
              </Button>
            )}
          </div>
          {history.isFetchNextPageError && (
            <ErrorNotice error={history.error} onRetry={() => void history.fetchNextPage()} />
          )}
          <EventsByPlugin rows={coverage} />
        </section>
      )}
    </section>
  );
}
