// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Handler, LOG_READER, OWNER, renderApp } from '#test-support.tsx';

afterEach(cleanup);

const user = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Pessoa ${id}`,
  email: `${id}@exemplo.com`,
  role: 'viewer',
  status: 'active',
  createdAt: '2026-10-01T10:00:00.000Z',
  lastLoginAt: '2026-10-29T13:58:00.000Z',
  mustChangePassword: false,
  pendingInvite: false,
  ...over,
});

const list =
  (...users: Record<string, unknown>[]): Handler =>
  () => ({ body: { users } });
const one =
  (data: Record<string, unknown>): Handler =>
  () => ({ body: data });

const ADMIN = { ...OWNER, id: 'a1', name: 'Admin', role: 'admin' as const };

describe('Usuários', () => {
  it('lista as pessoas com papel, estado e último acesso', async () => {
    renderApp({
      path: '/usuarios',
      routes: {
        'GET /api/users': list(
          user('u2', { role: 'admin' }),
          user('u3', { status: 'disabled', lastLoginAt: null }),
          user('u4', { pendingInvite: true }),
        ),
      },
    });
    const table = await screen.findByRole('table', { name: 'Usuários' });
    expect(within(table).getByText('Pessoa u2')).toBeTruthy();
    expect(within(table).getByText('Administrador')).toBeTruthy();
    expect(within(table).getByText('desativado')).toBeTruthy();
    expect(within(table).getByText('convite pendente')).toBeTruthy();
    expect(within(table).getByText('nunca')).toBeTruthy();
  });

  it('mostra carregando, vazio e erro com tentar de novo', async () => {
    let calls = 0;
    renderApp({
      path: '/usuarios',
      routes: {
        'GET /api/users': () => {
          calls += 1;
          return calls === 1
            ? { status: 500, body: { status: 500, title: 'Erro', detail: 'quebrou' } }
            : { body: { users: [] } };
        },
      },
    });
    expect(await screen.findByText('quebrou')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Nenhuma pessoa cadastrada.')).toBeTruthy();
  });

  it('mostra carregando enquanto a lista não chega', async () => {
    renderApp({ path: '/usuarios', routes: { 'GET /api/users': list(user('u2')) } });
    expect(await screen.findByRole('heading', { name: 'Usuários' })).toBeTruthy();
    expect(screen.getByText('Carregando…')).toBeTruthy();
    await screen.findByRole('table', { name: 'Usuários' });
  });

  it('sem users.manage mostra sem permissão e não chama a API', async () => {
    const app = renderApp({ me: LOG_READER, path: '/usuarios' });
    expect(await screen.findByRole('heading', { name: 'Sem permissão' })).toBeTruthy();
    expect(app.calls.some((c) => c.path === '/api/users')).toBe(false);
  });

  it('abre uma pessoa pela lista e lê GET /api/users/{id}', async () => {
    const u = userEvent.setup();
    const app = renderApp({
      path: '/usuarios',
      routes: {
        'GET /api/users': list(user('u2')),
        'GET /api/users/u2': one(user('u2')),
      },
    });
    await u.click(await screen.findByRole('link', { name: /Pessoa u2/ }));
    expect(await screen.findByRole('heading', { name: 'Pessoa u2', level: 2 })).toBeTruthy();
    expect(location.pathname).toBe('/usuarios/u2');
    expect(app.calls.some((c) => c.method === 'GET' && c.path === '/api/users/u2')).toBe(true);
  });

  it('abre direto pela URL e mostra o erro de pessoa inexistente', async () => {
    renderApp({
      path: '/usuarios/zz',
      routes: {
        'GET /api/users': list(user('u2')),
        'GET /api/users/zz': () => ({
          status: 404,
          body: { status: 404, title: 'Erro', detail: 'usuário não existe' },
        }),
      },
    });
    expect(await screen.findByText('usuário não existe')).toBeTruthy();
  });

  it('convida: manda o corpo, mostra o link absoluto uma vez e copia', async () => {
    const u = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    let invited = false;
    const app = renderApp({
      path: '/usuarios',
      routes: {
        'GET /api/users': () => ({ body: { users: invited ? [user('u9')] : [] } }),
        'POST /api/users': () => {
          invited = true;
          return {
            status: 201,
            body: {
              user: user('u9', { name: 'Ana', pendingInvite: true }),
              invite: { token: 'tok en/1', expiresAt: '2026-11-05T10:00:00.000Z' },
            },
          };
        },
      },
    });
    await u.click(await screen.findByRole('button', { name: 'Convidar pessoa' }));
    await u.type(screen.getByLabelText('Nome'), 'Ana');
    await u.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await u.click(screen.getByRole('button', { name: 'Administrador' }));
    await u.click(screen.getByRole('button', { name: 'Criar convite' }));

    const link = (await screen.findByLabelText('Link do convite')) as HTMLInputElement;
    expect(link.value).toBe(`${location.origin}/convite?token=tok%20en%2F1`);
    expect(screen.getByText(/não aparece de novo/)).toBeTruthy();
    expect(app.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Ana',
      email: 'ana@exemplo.com',
      role: 'admin',
    });

    await u.click(screen.getByRole('button', { name: 'Copiar link' }));
    expect(writeText).toHaveBeenCalledWith(link.value);
    expect(await screen.findByText('Link copiado.')).toBeTruthy();
    // A lista foi relida depois do convite.
    expect(await screen.findByText('Pessoa u9')).toBeTruthy();

    await u.click(screen.getByRole('button', { name: 'Já copiei, fechar' }));
    expect(screen.queryByLabelText('Link do convite')).toBeNull();
    expect(screen.queryByText(/tok/)).toBeNull();
  });

  it('falha ao copiar avisa para copiar à mão', async () => {
    const u = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('bloqueado');
        },
      },
      configurable: true,
    });
    renderApp({
      path: '/usuarios',
      routes: {
        'GET /api/users': list(),
        'POST /api/users': () => ({
          status: 201,
          body: {
            user: user('u9'),
            invite: { token: 't', expiresAt: '2026-11-05T10:00:00.000Z' },
          },
        }),
      },
    });
    await u.click(await screen.findByRole('button', { name: 'Convidar pessoa' }));
    await u.type(screen.getByLabelText('Nome'), 'Ana');
    await u.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await u.click(screen.getByRole('button', { name: 'Criar convite' }));
    await u.click(await screen.findByRole('button', { name: 'Copiar link' }));
    expect(await screen.findByText(/Não consegui copiar: bloqueado/)).toBeTruthy();
  });

  it('erro ao convidar aparece no formulário', async () => {
    const u = userEvent.setup();
    renderApp({
      path: '/usuarios',
      routes: {
        'GET /api/users': list(),
        'POST /api/users': () => ({
          status: 409,
          body: { status: 409, title: 'Erro', detail: 'e-mail já cadastrado' },
        }),
      },
    });
    await u.click(await screen.findByRole('button', { name: 'Convidar pessoa' }));
    await u.type(screen.getByLabelText('Nome'), 'Ana');
    await u.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await u.click(screen.getByRole('button', { name: 'Criar convite' }));
    expect(await screen.findByText('e-mail já cadastrado')).toBeTruthy();
    expect(screen.queryByLabelText('Link do convite')).toBeNull();
  });

  it('admin não escolhe dono ao convidar', async () => {
    const u = userEvent.setup();
    renderApp({ me: ADMIN, path: '/usuarios', routes: { 'GET /api/users': list() } });
    await u.click(await screen.findByRole('button', { name: 'Convidar pessoa' }));
    expect(screen.queryByRole('button', { name: 'Dono' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Administrador' })).toBeTruthy();
  });

  it('muda o papel com PATCH', async () => {
    const u = userEvent.setup();
    let current = user('u2');
    const app = renderApp({
      path: '/usuarios/u2',
      routes: {
        'GET /api/users': () => ({ body: { users: [current] } }),
        'GET /api/users/u2': () => ({ body: current }),
        'PATCH /api/users/u2': ({ body }) => {
          current = { ...current, ...(body as object) };
          return { body: current };
        },
      },
    });
    const group = await screen.findByRole('group', { name: 'Papel' });
    expect(within(group).getByRole('button', { name: 'Leitor' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await u.click(within(group).getByRole('button', { name: 'Administrador' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('group', { name: 'Papel' }))
          .getByRole('button', { name: 'Administrador' })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    expect(app.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ role: 'admin' });
  });

  it('erro ao mudar o papel (último dono) aparece', async () => {
    const u = userEvent.setup();
    renderApp({
      path: '/usuarios/u2',
      routes: {
        'GET /api/users': list(user('u2', { role: 'owner' })),
        'GET /api/users/u2': one(user('u2', { role: 'owner' })),
        'PATCH /api/users/u2': () => ({
          status: 409,
          body: {
            status: 409,
            title: 'Erro',
            detail: 'o último owner ativo não pode ser rebaixado',
          },
        }),
      },
    });
    const group = await screen.findByRole('group', { name: 'Papel' });
    await u.click(within(group).getByRole('button', { name: 'Leitor' }));
    expect(await screen.findByText('o último owner ativo não pode ser rebaixado')).toBeTruthy();
  });

  it('desativar pede confirmação e depois chama disable; reativar chama enable', async () => {
    const u = userEvent.setup();
    let current = user('u2');
    const app = renderApp({
      path: '/usuarios/u2',
      routes: {
        'GET /api/users': () => ({ body: { users: [current] } }),
        'GET /api/users/u2': () => ({ body: current }),
        'POST /api/users/u2/disable': () => {
          current = { ...current, status: 'disabled' };
          return { body: current };
        },
        'POST /api/users/u2/enable': () => {
          current = { ...current, status: 'active' };
          return { body: current };
        },
      },
    });
    await u.click(await screen.findByRole('button', { name: 'Desativar' }));
    expect(app.calls.some((c) => c.path.endsWith('/disable'))).toBe(false);
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(app.calls.some((c) => c.path.endsWith('/disable'))).toBe(false);

    await u.click(screen.getByRole('button', { name: 'Desativar' }));
    const alert = screen.getByRole('alert');
    await u.click(within(alert).getByRole('button', { name: 'Desativar' }));
    await u.click(await screen.findByRole('button', { name: 'Reativar' }));
    await waitFor(() => expect(app.calls.some((c) => c.path.endsWith('/enable'))).toBe(true));
    expect(await screen.findByRole('button', { name: 'Desativar' })).toBeTruthy();
  });

  it('encerrar sessões confirma, chama DELETE e informa quantas', async () => {
    const u = userEvent.setup();
    const app = renderApp({
      path: '/usuarios/u2',
      routes: {
        'GET /api/users': list(user('u2')),
        'GET /api/users/u2': one(user('u2')),
        'DELETE /api/users/u2/sessions': () => ({ body: { revoked: 3 } }),
      },
    });
    await u.click(await screen.findByRole('button', { name: 'Encerrar sessões' }));
    expect(app.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await u.click(
      within(screen.getByRole('alert')).getByRole('button', { name: 'Encerrar sessões' }),
    );
    expect(await screen.findByText('3 sessões encerradas.')).toBeTruthy();
  });

  it('redefinir senha confirma e mostra o link uma única vez', async () => {
    const u = userEvent.setup();
    const app = renderApp({
      path: '/usuarios/u2',
      routes: {
        'GET /api/users': list(user('u2')),
        'GET /api/users/u2': one(user('u2')),
        'POST /api/users/u2/reset-password': () => ({
          body: { token: 'reset-1', expiresAt: '2026-11-05T10:00:00.000Z' },
        }),
      },
    });
    await u.click(await screen.findByRole('button', { name: 'Redefinir senha' }));
    expect(app.calls.some((c) => c.path.endsWith('/reset-password'))).toBe(false);
    await u.click(
      within(screen.getByRole('alert')).getByRole('button', { name: 'Redefinir senha' }),
    );
    const link = (await screen.findByLabelText('Link do convite')) as HTMLInputElement;
    expect(link.value).toBe(`${location.origin}/convite?token=reset-1`);
    expect(screen.getByText(/não aparece de novo/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Já copiei, fechar' }));
    expect(screen.queryByLabelText('Link do convite')).toBeNull();
  });

  it('admin não altera conta de dono: ações somem com aviso', async () => {
    renderApp({
      me: ADMIN,
      path: '/usuarios/u2',
      routes: {
        'GET /api/users': list(user('u2', { role: 'owner' })),
        'GET /api/users/u2': one(user('u2', { role: 'owner' })),
      },
    });
    expect(await screen.findByText('Só um dono pode alterar uma conta de dono.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Desativar' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Papel' })).toBeNull();
  });

  it('desativar a si mesmo avisa que a pessoa sai agora', async () => {
    const u = userEvent.setup();
    renderApp({
      path: '/usuarios/u1',
      routes: {
        'GET /api/users': list(user('u1', { role: 'owner' })),
        'GET /api/users/u1': one(user('u1', { role: 'owner' })),
      },
    });
    await u.click(await screen.findByRole('button', { name: 'Desativar' }));
    expect(within(screen.getByRole('alert')).getByText(/você sai agora/)).toBeTruthy();
  });

  it('não oferece redefinir a própria senha', async () => {
    renderApp({
      path: '/usuarios/u1',
      routes: {
        'GET /api/users': list(user('u1', { role: 'owner' })),
        'GET /api/users/u1': one(user('u1', { role: 'owner' })),
      },
    });
    await screen.findByRole('button', { name: 'Desativar' });
    expect(screen.queryByRole('button', { name: 'Redefinir senha' })).toBeNull();
    expect(screen.getByText(/troque a senha em Minha conta/)).toBeTruthy();
  });

  it('não oferece redefinir senha de conta desativada, com a razão', async () => {
    renderApp({
      path: '/usuarios/u2',
      routes: {
        'GET /api/users': list(user('u2', { status: 'disabled' })),
        'GET /api/users/u2': one(user('u2', { status: 'disabled' })),
      },
    });
    await screen.findByRole('button', { name: 'Reativar' });
    expect(screen.queryByRole('button', { name: 'Redefinir senha' })).toBeNull();
    expect(screen.getByText(/só vale para conta ativa/)).toBeTruthy();
  });

  it('rebaixar o próprio papel pede confirmação e relê a sessão (me)', async () => {
    const u = userEvent.setup();
    const app = renderApp({
      path: '/usuarios/u1',
      routes: {
        'GET /api/users': list(user('u1', { role: 'owner' })),
        'GET /api/users/u1': one(user('u1', { role: 'owner' })),
        'PATCH /api/users/u1': () => ({ body: user('u1', { role: 'admin' }) }),
      },
    });
    const meCalls = () => app.calls.filter((c) => c.path === '/api/auth/me').length;
    const group = await screen.findByRole('group', { name: 'Papel' });
    await u.click(within(group).getByRole('button', { name: 'Administrador' }));
    expect(app.calls.some((c) => c.method === 'PATCH')).toBe(false);
    const confirm = within(screen.getByRole('alert')).getByRole('button', {
      name: 'Mudar o meu papel',
    });
    expect(document.activeElement).toBe(confirm);
    const before = meCalls();
    await u.click(confirm);
    await waitFor(() => expect(app.calls.some((c) => c.method === 'PATCH')).toBe(true));
    await waitFor(() => expect(meCalls()).toBeGreaterThan(before));
  });

  it('encerrar as próprias sessões relê a sessão (me)', async () => {
    const u = userEvent.setup();
    const app = renderApp({
      path: '/usuarios/u1',
      routes: {
        'GET /api/users': list(user('u1', { role: 'owner' })),
        'GET /api/users/u1': one(user('u1', { role: 'owner' })),
        'DELETE /api/users/u1/sessions': () => ({ body: { revoked: 1 } }),
      },
    });
    await u.click(await screen.findByRole('button', { name: 'Encerrar sessões' }));
    const before = app.calls.filter((c) => c.path === '/api/auth/me').length;
    await u.click(
      within(screen.getByRole('alert')).getByRole('button', { name: 'Encerrar sessões' }),
    );
    await waitFor(() =>
      expect(app.calls.filter((c) => c.path === '/api/auth/me').length).toBeGreaterThan(before),
    );
  });

  it('o token de convite e de redefinição não ficam no cache de mutations', async () => {
    const u = userEvent.setup();
    const app = renderApp({
      path: '/usuarios/u2',
      routes: {
        'GET /api/users': list(user('u2')),
        'GET /api/users/u2': one(user('u2')),
        'POST /api/users/u2/reset-password': () => ({
          body: { token: 'segredo-reset', expiresAt: '2026-11-05T10:00:00.000Z' },
        }),
        'POST /api/users': () => ({
          status: 201,
          body: {
            user: user('u9'),
            invite: { token: 'segredo-convite', expiresAt: '2026-11-05T10:00:00.000Z' },
          },
        }),
      },
    });
    await u.click(await screen.findByRole('button', { name: 'Redefinir senha' }));
    await u.click(
      within(screen.getByRole('alert')).getByRole('button', { name: 'Redefinir senha' }),
    );
    await screen.findByLabelText('Link do convite');
    await u.click(screen.getByRole('button', { name: 'Já copiei, fechar' }));
    await u.click(screen.getByRole('button', { name: 'Convidar pessoa' }));
    await u.type(screen.getByLabelText('Nome'), 'Ana');
    await u.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await u.click(screen.getByRole('button', { name: 'Criar convite' }));
    await screen.findByLabelText('Link do convite');
    await waitFor(() => {
      const cached = JSON.stringify(
        app.client
          .getMutationCache()
          .getAll()
          .map((m) => m.state.data),
      );
      expect(cached).not.toContain('segredo-');
    });
  });

  it('uma nova ação limpa o erro da anterior', async () => {
    const u = userEvent.setup();
    renderApp({
      path: '/usuarios/u2',
      routes: {
        'GET /api/users': list(user('u2')),
        'GET /api/users/u2': one(user('u2')),
        'DELETE /api/users/u2/sessions': () => ({
          status: 500,
          body: { status: 500, title: 'Erro', detail: 'falha nas sessões' },
        }),
        'PATCH /api/users/u2': () => ({ body: user('u2', { role: 'admin' }) }),
      },
    });
    await u.click(await screen.findByRole('button', { name: 'Encerrar sessões' }));
    await u.click(
      within(screen.getByRole('alert')).getByRole('button', { name: 'Encerrar sessões' }),
    );
    expect(await screen.findByText('falha nas sessões')).toBeTruthy();
    await u.click(
      within(screen.getByRole('group', { name: 'Papel' })).getByRole('button', {
        name: 'Administrador',
      }),
    );
    await waitFor(() => expect(screen.queryByText('falha nas sessões')).toBeNull());
  });

  it('foco vai ao botão de confirmar e volta ao de origem ao cancelar', async () => {
    const u = userEvent.setup();
    renderApp({
      path: '/usuarios/u2',
      routes: {
        'GET /api/users': list(user('u2')),
        'GET /api/users/u2': one(user('u2')),
      },
    });
    const origin = await screen.findByRole('button', { name: 'Desativar' });
    await u.click(origin);
    const confirm = within(screen.getByRole('alert')).getByRole('button', { name: 'Desativar' });
    expect(document.activeElement).toBe(confirm);
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(document.activeElement).toBe(origin);
  });
});
