// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOG_READER, renderApp } from '#test-support.tsx';
import { ChainStatus } from './audit/ChainStatus.tsx';
import { fromSearch, toQuery, toSearch } from './audit/filters.ts';
import { titleOf } from './audit/titles.ts';

afterEach(cleanup);

const chain = () =>
  within(screen.getByRole('region', { name: 'Cadeia de hash' })).getByRole('status');

type Event = Record<string, unknown>;

const event = (seq: number, over: Event = {}): Event => ({
  v: 1,
  eventId: `e${seq}`,
  seq,
  at: '2026-10-29T13:58:00.000Z',
  actor: { kind: 'user', id: 'u1', name: 'Murilo' },
  action: 'ai.model.change',
  target: { type: 'plugin', id: 'ai' },
  outcome: 'success',
  session: 'default',
  details: { to: ['google:gemini'] },
  actorId: 'u1',
  targetId: 'ai',
  prevHash: 'p',
  hash: `hash-${seq}`,
  ...over,
});

const CONTACT = { kind: 'contact', transport: 'whatsapp', id: 'u_8f3a' };

const page = (events: Event[], next?: number) => ({ body: { events, ...(next && { next }) } });

describe('mapa de títulos', () => {
  it('traduz as ações do kernel e da Luma e devolve a própria action quando não conhece', () => {
    expect(titleOf('kernel.plugin.disable')).toBe('Desligou um plugin');
    for (const action of [
      'luma.persona.set',
      'luma.history.clear',
      'ai.model.change',
      'rank.reset',
      'command.owner',
      'transport.pairing',
    ]) {
      expect(titleOf(action)).not.toBe(action);
    }
    expect(titleOf('plugin.novo.acao')).toBe('plugin.novo.acao');
  });
});

describe('filtros', () => {
  it('ida e volta entre URL e filtros, sem o que é padrão', () => {
    const filters = fromSearch(
      new URLSearchParams('quem=contact&resultado=denied&acao=rank.reset'),
    );
    expect(filters).toMatchObject({ who: 'contact', outcome: 'denied', period: '7d' });
    expect(toSearch(filters).toString()).toBe('quem=contact&resultado=denied&acao=rank.reset');
    expect(fromSearch(new URLSearchParams('quem=xx&periodo=zz')).who).toBe('todos');
  });

  it('período por datas vira from/to ISO da query', () => {
    const filters = fromSearch(new URLSearchParams('periodo=datas&de=2026-10-01&ate=2026-10-02'));
    const query = toQuery(filters, new Date());
    expect(new Date(query.from ?? '').getDate()).toBe(1);
    expect(new Date(query.to ?? '').getDate()).toBe(2);
  });
});

describe('ChainStatus', () => {
  const base = { isPending: false, isError: false, error: null, data: undefined, mutate: vi.fn() };

  it('rodando: diz que verifica e desabilita o botão', () => {
    render(<ChainStatus verify={{ ...base, isPending: true }} />);
    expect(screen.getByRole('status').textContent).toBe('Verificando…');
    expect(
      (screen.getByRole('button', { name: 'Verificar a cadeia de hash' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('parada: botão habilitado chama mutate', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn();
    render(<ChainStatus verify={{ ...base, mutate }} />);
    await user.click(screen.getByRole('button', { name: 'Verificar a cadeia de hash' }));
    expect(mutate).toHaveBeenCalledOnce();
  });
});

describe('tela Auditoria', () => {
  it('lista com título legível, action em mono, quem e resultado', async () => {
    renderApp({
      path: '/auditoria',
      routes: {
        'GET /api/audit': () =>
          page([
            event(2, { action: 'rank.reset', actor: CONTACT, outcome: 'denied' }),
            event(1, { action: 'plugin.novo.acao', outcome: 'error' }),
          ]),
      },
    });
    const table = await screen.findByRole('table', { name: 'Eventos' });
    expect(within(table).getByText('Zerou o ranking')).toBeTruthy();
    expect(within(table).getByText('rank.reset')).toBeTruthy();
    expect(within(table).getByText('u_8f3a')).toBeTruthy();
    expect(within(table).getByText('negado').className).toContain('text-warn');
    expect(within(table).getByText('erro').className).toContain('text-danger');
    // Ação sem título aparece só com a própria action.
    expect(within(table).getAllByText('plugin.novo.acao')).toHaveLength(2);
  });

  it('filtros vão para a URL e para a query; padrão é 7 dias', async () => {
    const user = userEvent.setup();
    const app = renderApp({
      path: '/auditoria',
      routes: { 'GET /api/audit': () => page([event(1)]) },
    });
    await screen.findByRole('table', { name: 'Eventos' });
    const first = app.calls.find((c) => c.path === '/api/audit');
    expect(first).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Negado' }));
    await waitFor(() => expect(location.search).toBe('?resultado=denied'));
    await waitFor(() => {
      const calls = app.calls.filter((c) => c.path === '/api/audit');
      expect(calls.length).toBeGreaterThan(1);
    });
    await user.selectOptions(screen.getByLabelText('Período'), 'todo');
    await waitFor(() => expect(location.search).toBe('?resultado=denied&periodo=todo'));
  });

  it('abre já filtrada pela URL', async () => {
    let seen: URL | undefined;
    renderApp({
      path: '/auditoria?resultado=error&periodo=todo&acao=rank.reset',
      routes: {
        'GET /api/audit': ({ url }) => {
          seen = url;
          return page([event(1, { action: 'rank.reset', outcome: 'error' })]);
        },
      },
    });
    await screen.findByRole('table', { name: 'Eventos' });
    expect(seen?.searchParams.get('outcome')).toBe('error');
    expect(seen?.searchParams.get('action')).toBe('rank.reset');
    expect(seen?.searchParams.get('from')).toBeNull();
    expect(screen.getByRole('button', { name: 'Erro' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('"Quem" filtra no cliente: WhatsApp só mostra contatos', async () => {
    const user = userEvent.setup();
    renderApp({
      path: '/auditoria',
      routes: {
        'GET /api/audit': () =>
          page([event(2, { actor: CONTACT, action: 'rank.reset' }), event(1)]),
      },
    });
    await screen.findByRole('table', { name: 'Eventos' });
    await user.click(screen.getByRole('button', { name: 'WhatsApp' }));
    expect(location.search).toBe('?quem=contact');
    const table = screen.getByRole('table', { name: 'Eventos' });
    expect(within(table).getByText('Zerou o ranking')).toBeTruthy();
    expect(within(table).queryByText('Mudou o modelo da IA')).toBeNull();
  });

  it('exportar leva os filtros da tela', async () => {
    renderApp({
      path: '/auditoria?resultado=denied&periodo=todo&acao=rank.reset',
      routes: { 'GET /api/audit': () => page([event(1)]) },
    });
    await screen.findByRole('table', { name: 'Eventos' });
    const csv = new URL(
      screen.getByRole('link', { name: 'Exportar CSV' }).getAttribute('href') ?? '',
      'http://x',
    );
    expect(csv.pathname).toBe('/api/audit/export');
    expect(csv.searchParams.get('format')).toBe('csv');
    expect(csv.searchParams.get('outcome')).toBe('denied');
    expect(csv.searchParams.get('action')).toBe('rank.reset');
    const json = screen.getByRole('link', { name: 'Exportar JSON' }).getAttribute('href');
    expect(json).toContain('format=json');
  });

  it('linha expande com alvo, detalhes, seq e hash; "Só esta ação" filtra e "Todas as ações" limpa', async () => {
    const user = userEvent.setup();
    renderApp({
      path: '/auditoria',
      routes: { 'GET /api/audit': () => page([event(7, { details: { persona: 'sarcastica' } })]) },
    });
    const row = within(await screen.findByRole('table', { name: 'Eventos' })).getByRole('button', {
      expanded: false,
    });
    await user.click(row);
    expect(screen.getByText('plugin ai')).toBeTruthy();
    expect(screen.getByText(/"persona": "sarcastica"/)).toBeTruthy();
    expect(screen.getByText(/#7 · hash-7/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Só esta ação' }));
    expect(location.search).toBe('?acao=ai.model.change');
    await user.click(await screen.findByRole('button', { name: 'Todas as ações' }));
    expect(location.search).toBe('');
  });

  it('verifica a cadeia: rodando, íntegra e quebrada', async () => {
    let broken = false;
    const app = renderApp({
      path: '/auditoria',
      routes: {
        'GET /api/audit': () => page([event(1)]),
        'POST /api/audit/verify': () => {
          return broken
            ? {
                body: {
                  ok: false,
                  checked: 57,
                  brokenAt: { seq: 58, eventId: 'e58', reason: 'hash difere' },
                },
              }
            : { body: { ok: true, checked: 1288 } };
        },
      },
    });
    await screen.findByRole('table', { name: 'Eventos' });
    expect(chain().textContent).toContain('ainda não verificada');

    const button = screen.getByRole('button', { name: 'Verificar a cadeia de hash' });
    fireEvent.click(button);
    await waitFor(() => expect(chain().textContent).toBe('Cadeia íntegra'));
    expect(screen.getByText(/1.288 eventos/)).toBeTruthy();
    // Enquanto roda o botão fica desabilitado, para não disparar duas verificações.
    expect((button as HTMLButtonElement).disabled).toBe(false);

    broken = true;
    fireEvent.click(button);
    await waitFor(() => expect(chain().textContent).toBe('Cadeia quebrada no #58'));
    expect(screen.getByText('hash difere')).toBeTruthy();
    expect(app.calls.filter((c) => c.path === '/api/audit/verify')).toHaveLength(2);
  });

  it('erro na verificação aparece em vez de "íntegra"', async () => {
    renderApp({
      path: '/auditoria',
      routes: {
        'GET /api/audit': () => page([event(1)]),
        'POST /api/audit/verify': () => ({
          status: 500,
          body: { type: 'about:blank', title: 'Erro', status: 500, detail: 'storage fora' },
        }),
      },
    });
    await screen.findByRole('table', { name: 'Eventos' });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar a cadeia de hash' }));
    await waitFor(() => expect(chain().textContent).toBe('Não foi possível verificar'));
    expect(screen.getByText('storage fora')).toBeTruthy();
  });

  it('pagina por cursor: "Mais antigos" pede o next e some no fim', async () => {
    const user = userEvent.setup();
    const seen: (string | null)[] = [];
    renderApp({
      path: '/auditoria',
      routes: {
        'GET /api/audit': ({ url }) => {
          const after = url.searchParams.get('after');
          seen.push(after);
          return after === null
            ? page([event(3), event(2)], 2)
            : page([event(1, { action: 'rank.reset' })]);
        },
      },
    });
    await screen.findByRole('table', { name: 'Eventos' });
    await user.click(screen.getByRole('button', { name: 'Mais antigos' }));
    await screen.findByText('Zerou o ranking');
    expect(seen).toEqual([null, '2']);
    expect(screen.queryByRole('button', { name: 'Mais antigos' })).toBeNull();
    expect(screen.getByText(/3 eventos/)).toBeTruthy();
  });

  it('mostra carregando, vazio e erro com "Tentar de novo"', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp({
      path: '/auditoria',
      routes: {
        'GET /api/audit': () =>
          fail
            ? {
                status: 500,
                body: { type: 'about:blank', title: 'Erro', status: 500, detail: 'storage fora' },
              }
            : page([]),
      },
    });
    expect((await screen.findByRole('alert')).textContent).toContain('storage fora');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Nenhum evento com esses filtros.')).toBeTruthy();
  });

  it('mostra carregando enquanto a primeira página não chega', async () => {
    renderApp({ path: '/auditoria', routes: { 'GET /api/audit': () => page([event(1)]) } });
    expect(await screen.findByText('Carregando eventos…')).toBeTruthy();
    await screen.findByRole('table', { name: 'Eventos' });
  });

  it('sem audit.read mostra sem permissão e não consulta a API', async () => {
    const app = renderApp({ me: LOG_READER, path: '/auditoria' });
    expect(await screen.findByText('Você não tem permissão para ver esta tela.')).toBeTruthy();
    expect(app.calls.some((c) => c.path === '/api/audit')).toBe(false);
  });
});
