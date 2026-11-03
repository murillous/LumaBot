// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { LOG_READER, renderApp } from '#test-support.tsx';
import { fromSearch, toggleGroup, toQuery, toSearch, withWhere } from './metrics/filters.ts';
import { niceMax, periodLabel, periodsOf, type Row, seriesOf } from './metrics/series.ts';

afterEach(cleanup);

const NOW = new Date('2026-11-02T15:30:00Z');

const descriptor = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  type: 'counter',
  help: `Ajuda de ${name}`,
  labelNames: ['status'],
  live: true,
  ...over,
});

const CATALOG = {
  body: {
    metrics: [
      descriptor('bridger_messages_handled_total', { labelNames: ['status', 'plugin'] }),
      descriptor('ai_attempts_total', { labelNames: ['outcome'] }),
      descriptor('luma_replies_total', { labelNames: [] }),
    ],
  },
};

const counter = (period: string, value: number, labels: Record<string, string> = {}): Row => ({
  type: 'counter',
  period,
  labels,
  value,
});

describe('filtros', () => {
  it('ida e volta entre URL e filtros, sem o que é padrão', () => {
    const search = new URLSearchParams(
      'metrica=ai_attempts_total&grao=hora&onde=outcome:ok&onde=model:x&agrupar=outcome,model',
    );
    const filters = fromSearch(search);
    expect(filters).toMatchObject({
      metric: 'ai_attempts_total',
      period: '7d',
      granularity: 'hora',
      where: ['outcome:ok', 'model:x'],
      groupBy: ['outcome', 'model'],
    });
    expect(toSearch(filters).toString()).toBe(search.toString());
    expect(toSearch(fromSearch(new URLSearchParams())).toString()).toBe('');
  });

  it('valor desconhecido cai no padrão e where sem dois-pontos é descartado', () => {
    const filters = fromSearch(new URLSearchParams('periodo=zz&grao=zz&onde=solto&agrupar=a,,a'));
    expect(filters).toMatchObject({ period: '7d', granularity: 'dia', where: [], groupBy: ['a'] });
  });

  it('where e groupBy: troca, remoção e alternância', () => {
    expect(withWhere(['a:1', 'b:2'], 'a', ' 9 ')).toEqual(['b:2', 'a:9']);
    expect(withWhere(['a:1'], 'a', '  ')).toEqual([]);
    expect(toggleGroup(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleGroup(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('toQuery: períodos em UTC, hora com T00/T23 e groupBy vazio soma tudo', () => {
    const base = fromSearch(new URLSearchParams('metrica=m'));
    expect(toQuery(base, NOW)).toEqual({
      name: 'm',
      from: '2026-10-27',
      to: '2026-11-02',
      granularity: 'day',
      groupBy: '',
    });
    expect(toQuery({ ...base, period: 'hoje', granularity: 'hora' }, NOW)).toMatchObject({
      from: '2026-11-02T00',
      to: '2026-11-02T23',
      granularity: 'hour',
    });
    expect(toQuery({ ...base, period: '30d' }, NOW)).toMatchObject({ from: '2026-10-04' });
    expect(toQuery({ ...base, where: ['a:1', 'b:2'], groupBy: ['a', 'b'] }, NOW)).toMatchObject({
      where: ['a:1', 'b:2'],
      groupBy: 'a,b',
    });
  });

  it('toQuery: datas escolhidas; incompletas, invertidas ou sem métrica não consultam', () => {
    const base = fromSearch(new URLSearchParams('metrica=m&periodo=datas'));
    expect(toQuery(base, NOW)).toBeNull();
    expect(toQuery({ ...base, from: '2026-10-05', to: '2026-10-01' }, NOW)).toBeNull();
    expect(toQuery({ ...base, from: '2026-10-01', to: '2026-10-05' }, NOW)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-05',
    });
    expect(toQuery(fromSearch(new URLSearchParams()), NOW)).toBeNull();
  });
});

describe('séries', () => {
  it('uma série por grupo, as maiores primeiro, e conta o que passa do limite', () => {
    const rows = [
      counter('2026-11-01', 1, { s: 'a' }),
      counter('2026-11-01', 9, { s: 'b' }),
      counter('2026-11-02', 5, { s: 'c' }),
    ];
    const { series, hidden } = seriesOf(rows, 2);
    expect(series.map((s) => s.name)).toEqual(['s: b', 's: c']);
    expect(hidden).toBe(1);
    expect(seriesOf([counter('2026-11-01', 3)]).series[0]?.name).toBe('Total');
  });

  it('histograma usa o p95 e medidor o último valor', () => {
    const rows: Row[] = [
      {
        type: 'histogram',
        period: 'p',
        labels: {},
        count: 3,
        sum: 9,
        buckets: [],
        p50: 1,
        p95: 7,
        p99: 8,
      },
      { type: 'gauge', period: 'q', labels: {}, last: 4, max: 6 },
    ];
    const values = seriesOf(rows).series[0]?.values;
    expect(values?.get('p')).toBe(7);
    expect(values?.get('q')).toBe(4);
  });

  it('o eixo cobre todos os períodos do intervalo, mesmo os sem dado', () => {
    const { series } = seriesOf([counter('2026-11-02', 1)]);
    expect(periodsOf({ from: '2026-10-31', to: '2026-11-02' }, series)).toEqual([
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(
      periodsOf({ from: '2026-11-02T22', to: '2026-11-03T01', granularity: 'hour' }, []),
    ).toEqual(['2026-11-02T22', '2026-11-02T23', '2026-11-03T00', '2026-11-03T01']);
  });

  it('formatação auxiliar', () => {
    expect(periodLabel('2026-11-02')).toBe('02/11');
    expect(periodLabel('2026-11-02T13')).toBe('02/11 13h');
    expect(niceMax(0)).toBe(1);
    expect(niceMax(37)).toBe(50);
    expect(niceMax(200)).toBe(200);
  });
});

describe('tela Métricas', () => {
  const routes = (query?: (url: URL) => { status?: number; body: unknown }) => ({
    'GET /api/plugins/metrics/catalog': () => CATALOG,
    'GET /api/plugins/metrics/query': ({ url }: { url: URL }) =>
      query?.(url) ?? { body: { rows: [] } },
  });

  it('carrega o catálogo e a série da primeira métrica do kernel, com tabela e gráfico', async () => {
    const app = renderApp({
      path: '/metricas',
      routes: routes(() => ({
        body: { rows: [counter('2026-11-01', 12), counter('2026-11-02', 30)] },
      })),
    });
    expect(await screen.findByText('Carregando métricas…')).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Valores da série' });
    expect(within(table).getByText('30')).toBeTruthy();
    expect(within(table).getByText('12')).toBeTruthy();
    expect(screen.getByRole('img', { name: /bridger_messages_handled_total/ })).toBeTruthy();
    const call = app.calls.find((c) => c.path === '/api/plugins/metrics/query');
    expect(call).toBeDefined();
    const select = screen.getByLabelText('Métrica');
    expect((select as HTMLSelectElement).value).toBe('bridger_messages_handled_total');
    expect(
      within(select)
        .getAllByRole('group')
        .map((g) => g.getAttribute('label')),
    ).toEqual(['Kernel', 'IA', 'Luma']);
  });

  it('manda name, período UTC, granularidade, where e groupBy na query string', async () => {
    let seen: URL | undefined;
    renderApp({
      path: '/metricas?metrica=ai_attempts_total&periodo=hoje&grao=hora&onde=outcome:ok&agrupar=outcome',
      routes: routes((url) => {
        seen = url;
        return { body: { rows: [counter('2026-11-02T10', 4, { outcome: 'ok' })] } };
      }),
    });
    await screen.findByRole('table', { name: 'Valores da série' });
    const today = new Date().toISOString().slice(0, 10);
    expect(seen?.searchParams.get('name')).toBe('ai_attempts_total');
    expect(seen?.searchParams.get('from')).toBe(`${today}T00`);
    expect(seen?.searchParams.get('to')).toBe(`${today}T23`);
    expect(seen?.searchParams.get('granularity')).toBe('hour');
    expect(seen?.searchParams.getAll('where')).toEqual(['outcome:ok']);
    expect(seen?.searchParams.get('groupBy')).toBe('outcome');
    // Com agrupamento, a legenda e o nome do grupo aparecem.
    expect(screen.getAllByText('outcome: ok').length).toBeGreaterThan(0);
  });

  it('mudar filtros atualiza a URL e a consulta', async () => {
    const user = userEvent.setup();
    const urls: URL[] = [];
    renderApp({
      path: '/metricas?metrica=ai_attempts_total',
      routes: routes((url) => {
        urls.push(url);
        return { body: { rows: [counter('2026-11-02', 1, {})] } };
      }),
    });
    await screen.findByRole('table', { name: 'Valores da série' });

    await user.click(screen.getByRole('button', { name: '30 dias' }));
    await user.click(screen.getByRole('button', { name: 'Por hora' }));
    await user.click(screen.getByRole('checkbox', { name: 'outcome' }));
    const input = screen.getByLabelText('Filtrar outcome');
    await user.type(input, 'ok{Enter}');

    await waitFor(() => {
      const last = urls.at(-1);
      expect(last?.searchParams.get('granularity')).toBe('hour');
      expect(last?.searchParams.getAll('where')).toEqual(['outcome:ok']);
      expect(last?.searchParams.get('groupBy')).toBe('outcome');
    });
    const search = new URLSearchParams(location.search);
    expect(search.get('periodo')).toBe('30d');
    expect(search.get('grao')).toBe('hora');
    expect(search.get('agrupar')).toBe('outcome');
    expect(search.getAll('onde')).toEqual(['outcome:ok']);
  });

  it('trocar de métrica limpa filtro e agrupamento', async () => {
    const user = userEvent.setup();
    renderApp({
      path: '/metricas?metrica=ai_attempts_total&onde=outcome:ok&agrupar=outcome',
      routes: routes(() => ({ body: { rows: [counter('2026-11-02', 1)] } })),
    });
    await screen.findByRole('table', { name: 'Valores da série' });
    await user.selectOptions(screen.getByLabelText('Métrica'), 'luma_replies_total');
    await waitFor(() => expect(location.search).toBe('?metrica=luma_replies_total'));
    expect(screen.queryByText('Agrupar por')).toBeNull();
  });

  it('Escolher datas mostra os campos e só consulta com as duas datas', async () => {
    const user = userEvent.setup();
    const urls: URL[] = [];
    renderApp({
      path: '/metricas?metrica=ai_attempts_total&periodo=datas',
      routes: routes((url) => {
        urls.push(url);
        return { body: { rows: [] } };
      }),
    });
    expect(await screen.findByText(/Escolha as duas datas/)).toBeTruthy();
    expect(urls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-10-03' } });
    await waitFor(() => expect(urls.at(-1)?.searchParams.get('to')).toBe('2026-10-03'));
    expect(urls.at(-1)?.searchParams.get('from')).toBe('2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Hoje' }));
    await waitFor(() => expect(screen.queryByLabelText('De')).toBeNull());
  });

  it('avisa quando passa do limite de séries', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => counter('2026-11-02', i + 1, { s: `g${i}` }));
    renderApp({
      path: '/metricas?metrica=bridger_messages_handled_total&agrupar=status',
      routes: routes(() => ({ body: { rows } })),
    });
    expect(await screen.findByText(/mais 2 grupos ficaram de fora/)).toBeTruthy();
    const head = within(screen.getByRole('table', { name: 'Valores da série' })).getAllByRole(
      'columnheader',
    );
    // Período mais as 8 séries.
    expect(head).toHaveLength(9);
  });

  it('período vazio', async () => {
    renderApp({ path: '/metricas', routes: routes() });
    expect(await screen.findByText('Nenhum dado nesse período.')).toBeTruthy();
  });

  it('catálogo vazio', async () => {
    renderApp({
      path: '/metricas',
      routes: { 'GET /api/plugins/metrics/catalog': () => ({ body: { metrics: [] } }) },
    });
    expect(await screen.findByText('Nenhuma métrica registrada ainda.')).toBeTruthy();
  });

  it('erro da consulta mostra a mensagem e tenta de novo', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp({
      path: '/metricas',
      routes: routes(() =>
        fail
          ? {
              status: 500,
              body: { type: 'about:blank', title: 'Erro', status: 500, detail: 'quebrou' },
            }
          : { body: { rows: [counter('2026-11-02', 2)] } },
      ),
    });
    expect((await screen.findByRole('alert')).textContent).toContain('quebrou');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('table', { name: 'Valores da série' })).toBeTruthy();
  });

  it('erro do catálogo mostra a mensagem e tenta de novo', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp({
      path: '/metricas',
      routes: {
        'GET /api/plugins/metrics/catalog': () =>
          fail
            ? {
                status: 500,
                body: { type: 'about:blank', title: 'Erro', status: 500, detail: 'sem catálogo' },
              }
            : CATALOG,
        'GET /api/plugins/metrics/query': () => ({ body: { rows: [] } }),
      },
    });
    expect((await screen.findByRole('alert')).textContent).toContain('sem catálogo');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByLabelText('Métrica')).toBeTruthy();
  });

  it('sem o plugin metrics (404) avisa em linha, sem quebrar', async () => {
    renderApp({ path: '/metricas', routes: {} });
    expect(await screen.findByText(/plugin de métricas não está carregado/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Métricas' })).toBeTruthy();
  });

  it('sem metrics.read a tela é "Sem permissão" e nada é chamado', async () => {
    const app = renderApp({ me: LOG_READER, path: '/metricas', routes: routes() });
    expect(await screen.findByRole('heading', { name: 'Sem permissão' })).toBeTruthy();
    expect(app.calls.some((c) => c.path.startsWith('/api/plugins/metrics'))).toBe(false);
  });

  it('o menu leva à tela pelo grupo Observabilidade', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/', routes: routes() });
    await user.click(await screen.findByRole('link', { name: 'Métricas' }));
    expect(location.pathname).toBe('/metricas');
    expect(await screen.findByRole('heading', { name: 'Métricas' })).toBeTruthy();
  });
});
