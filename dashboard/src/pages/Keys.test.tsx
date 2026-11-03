// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOG_READER, OWNER, renderApp } from '#test-support.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SECRET = 'lk_segredo_unico_123';

const key = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Chave ${id}`,
  permissions: ['logs.read'],
  createdBy: 'u1',
  createdAt: '2026-10-29T13:58:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  ...over,
});

const list = (keys: unknown[]) => ({ 'GET /api/keys': () => ({ body: { keys } }) });

describe('tela Chaves de API', () => {
  it('mostra carregando e depois a tabela, com estado e último uso', async () => {
    renderApp({
      path: '/chaves',
      routes: list([
        key('k1', { lastUsedAt: '2026-10-30T10:00:00.000Z' }),
        key('k2', { revokedAt: '2026-10-31T10:00:00.000Z' }),
      ]),
    });
    expect(await screen.findByRole('status')).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Chaves de API' });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText('ativa')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('revogada')).toBeTruthy();
    // Chave revogada não oferece revogar de novo.
    expect(within(rows[2] as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('lista vazia', async () => {
    renderApp({ path: '/chaves', routes: list([]) });
    expect(await screen.findByText('Nenhuma chave criada.')).toBeTruthy();
  });

  it('erro da API com "tentar de novo"', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp({
      path: '/chaves',
      routes: {
        'GET /api/keys': () =>
          fail
            ? { status: 500, body: { title: 'Erro', status: 500, detail: 'banco fora' } }
            : { body: { keys: [] } },
      },
    });
    expect((await screen.findByRole('alert')).textContent).toContain('banco fora');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Nenhuma chave criada.')).toBeTruthy();
  });

  it('sem keys.manage avisa em vez de abrir', async () => {
    const { calls } = renderApp({ me: LOG_READER, path: '/chaves' });
    expect(await screen.findByRole('heading', { name: 'Sem permissão' })).toBeTruthy();
    expect(calls.some((c) => c.path === '/api/keys')).toBe(false);
  });

  it('cria com escopo escolhido entre as permissões da pessoa e mostra o segredo uma vez', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    let keys = [key('k1')];
    const app = renderApp({
      path: '/chaves',
      routes: {
        'GET /api/keys': () => ({ body: { keys } }),
        'POST /api/keys': ({ body }) => {
          const { name, permissions } = body as { name: string; permissions: string[] };
          keys = [...keys, key('k2', { name, permissions })];
          return { status: 201, body: { ...key('k2', { name, permissions }), secret: SECRET } };
        },
      },
    });
    await screen.findByRole('table', { name: 'Chaves de API' });
    await user.click(screen.getByRole('button', { name: 'Nova chave' }));

    // As opções são exatamente as permissões da pessoa.
    const group = screen.getByRole('group', { name: 'Permissões' });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(OWNER.permissions.length);

    const submit = screen.getByRole('button', { name: 'Criar chave' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(screen.getByLabelText('Nome'), '  Painel externo ');
    expect(submit.disabled).toBe(true);
    await user.click(within(group).getByRole('checkbox', { name: 'metrics.read' }));
    await user.click(within(group).getByRole('checkbox', { name: 'logs.read' }));
    await user.click(submit);

    const box = await screen.findByRole('region', { name: 'Chave criada' });
    expect(within(box).getByText(SECRET)).toBeTruthy();
    expect(box.textContent).toContain('não aparece de novo');
    const post = app.calls.find((c) => c.method === 'POST' && c.path === '/api/keys');
    expect(post?.body).toEqual({
      name: 'Painel externo',
      permissions: ['logs.read', 'metrics.read'],
    });

    await user.click(within(box).getByRole('button', { name: 'Copiar' }));
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(await within(box).findByText('Copiado.')).toBeTruthy();

    // A lista recarregou com a chave nova, sem segredo.
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Painel externo' })).toBeTruthy());

    // Fechar apaga o segredo da tela e nada dele fica no cache do react-query.
    await user.click(within(box).getByRole('button', { name: 'Já copiei, fechar' }));
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Chave criada' })).toBeNull();
    const cached = JSON.stringify([
      app.client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
      app.client
        .getMutationCache()
        .getAll()
        .map((m) => m.state.data),
    ]);
    expect(cached).not.toContain(SECRET);
  });

  it('o segredo não volta ao recarregar a lista nem ao sair e voltar para a tela', async () => {
    const user = userEvent.setup();
    const app = renderApp({
      path: '/chaves',
      routes: {
        'GET /api/keys': () => ({ body: { keys: [key('k1')] } }),
        'POST /api/keys': () => ({ status: 201, body: { ...key('k2'), secret: SECRET } }),
      },
    });
    await screen.findByRole('table', { name: 'Chaves de API' });
    await user.click(screen.getByRole('button', { name: 'Nova chave' }));
    await user.type(screen.getByLabelText('Nome'), 'x');
    await user.click(screen.getByRole('checkbox', { name: 'logs.read' }));
    await user.click(screen.getByRole('button', { name: 'Criar chave' }));
    expect(await screen.findByText(SECRET)).toBeTruthy();

    // Sem fechar: navegar para outra tela e voltar descarta o aviso (a guarda de saída é aceita).
    window.confirm = vi.fn(() => true);
    const menu = screen.getByRole('navigation', { name: 'Principal' });
    await user.click(within(menu).getByRole('link', { name: 'Visão geral' }));
    await screen.findByRole('heading', { name: 'Visão geral' });
    expect(screen.queryByText(SECRET)).toBeNull();
    await user.click(within(menu).getByRole('link', { name: 'Chaves de API' }));
    await screen.findByRole('table', { name: 'Chaves de API' });
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);
    expect(
      JSON.stringify(
        app.client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain(SECRET);
  });

  it('avisa quando o clipboard falha, e o segredo segue visível', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('negado')) },
    });
    renderApp({
      path: '/chaves',
      routes: {
        ...list([]),
        'POST /api/keys': () => ({ status: 201, body: { ...key('k2'), secret: SECRET } }),
      },
    });
    await screen.findByText('Nenhuma chave criada.');
    await user.click(screen.getByRole('button', { name: 'Nova chave' }));
    await user.type(screen.getByLabelText('Nome'), 'x');
    await user.click(screen.getByRole('checkbox', { name: 'logs.read' }));
    await user.click(screen.getByRole('button', { name: 'Criar chave' }));
    const box = await screen.findByRole('region', { name: 'Chave criada' });
    await user.click(within(box).getByRole('button', { name: 'Copiar' }));
    expect(await within(box).findByText(/Não consegui copiar/)).toBeTruthy();
    expect(within(box).getByText(SECRET)).toBeTruthy();
  });

  it('erro ao criar aparece no formulário e não mostra segredo', async () => {
    const user = userEvent.setup();
    renderApp({
      path: '/chaves',
      routes: {
        ...list([]),
        'POST /api/keys': () => ({
          status: 400,
          body: { title: 'Erro', status: 400, detail: 'permissão inválida' },
        }),
      },
    });
    await screen.findByText('Nenhuma chave criada.');
    await user.click(screen.getByRole('button', { name: 'Nova chave' }));
    await user.type(screen.getByLabelText('Nome'), 'x');
    await user.click(screen.getByRole('checkbox', { name: 'logs.read' }));
    await user.click(screen.getByRole('button', { name: 'Criar chave' }));
    expect((await screen.findByRole('alert')).textContent).toContain('permissão inválida');
    expect(screen.queryByRole('region', { name: 'Chave criada' })).toBeNull();
  });

  it('revogar pede confirmação, cancelar não chama a API e confirmar manda o DELETE', async () => {
    const user = userEvent.setup();
    let keys = [key('k1')];
    const app = renderApp({
      path: '/chaves',
      routes: {
        'GET /api/keys': () => ({ body: { keys } }),
        'DELETE /api/keys/k1': () => {
          keys = [key('k1', { revokedAt: '2026-11-01T10:00:00.000Z' })];
          return { body: { id: 'k1', revokedAt: '2026-11-01T10:00:00.000Z' } };
        },
      },
    });
    await screen.findByRole('table', { name: 'Chaves de API' });
    await user.click(screen.getByRole('button', { name: 'Revogar Chave k1' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(app.calls.some((c) => c.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Revogar Chave k1' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar revogação de Chave k1' }));
    expect(await screen.findByText('revogada')).toBeTruthy();
    expect(app.calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([
      '/api/keys/k1',
    ]);
  });

  it('erro ao revogar fica junto da linha', async () => {
    const user = userEvent.setup();
    renderApp({
      path: '/chaves',
      routes: {
        ...list([key('k1')]),
        'DELETE /api/keys/k1': () => ({
          status: 404,
          body: { title: 'Erro', status: 404, detail: 'chave não existe' },
        }),
      },
    });
    await screen.findByRole('table', { name: 'Chaves de API' });
    await user.click(screen.getByRole('button', { name: 'Revogar Chave k1' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar revogação de Chave k1' }));
    expect((await screen.findByRole('alert')).textContent).toContain('chave não existe');
  });

  const createOne = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByText('Nenhuma chave criada.');
    await user.click(screen.getByRole('button', { name: 'Nova chave' }));
    await user.type(screen.getByLabelText('Nome'), 'x');
    await user.click(screen.getByRole('checkbox', { name: 'logs.read' }));
    await user.click(screen.getByRole('button', { name: 'Criar chave' }));
    return screen.findByRole('region', { name: 'Chave criada' });
  };
  const created = {
    ...list([]),
    'POST /api/keys': () => ({ status: 201, body: { ...key('k2'), secret: SECRET } }),
  };

  it('leva o foco ao aviso do segredo e esconde "Nova chave" enquanto ele está à mostra', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/chaves', routes: created });
    const box = await createOne(user);
    expect(document.activeElement).toBe(box);
    expect(screen.queryByRole('button', { name: 'Nova chave' })).toBeNull();
    await user.click(within(box).getByRole('button', { name: 'Já copiei, fechar' }));
    expect(screen.getByRole('button', { name: 'Nova chave' })).toBeTruthy();
  });

  it('pede confirmação ao sair com o segredo à mostra e fica se a pessoa recusar', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    window.confirm = confirm;
    renderApp({ path: '/chaves', routes: created });
    await createOne(user);
    const menu = screen.getByRole('navigation', { name: 'Principal' });
    await user.click(within(menu).getByRole('link', { name: 'Visão geral' }));
    expect(confirm).toHaveBeenCalledWith('A chave criada não aparece de novo. Sair mesmo assim?');
    expect(location.pathname).toBe('/chaves');
    expect(screen.getByText(SECRET)).toBeTruthy();
  });

  it('o foco acompanha a confirmação de revogar e fecha a confirmação ao revogar', async () => {
    const user = userEvent.setup();
    let calls = 0;
    renderApp({
      path: '/chaves',
      routes: {
        // O refetch depois do DELETE falha: a confirmação precisa ter fechado mesmo assim.
        'GET /api/keys': () =>
          ++calls === 1
            ? { body: { keys: [key('k1')] } }
            : { status: 500, body: { title: 'Erro', status: 500, detail: 'fora' } },
        'DELETE /api/keys/k1': () => ({
          body: { id: 'k1', revokedAt: '2026-11-01T10:00:00.000Z' },
        }),
      },
    });
    await screen.findByRole('table', { name: 'Chaves de API' });
    await user.click(screen.getByRole('button', { name: 'Revogar Chave k1' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Confirmar revogação de Chave k1' }),
    );
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Revogar Chave k1' }));

    await user.click(screen.getByRole('button', { name: 'Revogar Chave k1' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar revogação de Chave k1' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Confirmar revogação de Chave k1' })).toBeNull(),
    );
  });
});
