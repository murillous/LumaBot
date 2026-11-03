// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { LOG_READER, OVERVIEW_ROUTES, renderApp } from '#test-support.tsx';

afterEach(cleanup);

const session = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  createdAt: '2026-10-29T13:58:00.000Z',
  lastSeenAt: '2026-10-30T10:00:00.000Z',
  expiresAt: '2026-11-29T13:58:00.000Z',
  current: false,
  ...over,
});

const SESSIONS = { sessions: [session('s1', { current: true }), session('s2')] };

const problem = (status: number, detail: string, errors?: object[]) => ({
  status,
  body: { type: 'about:blank', title: 'Erro', status, detail, ...(errors && { errors }) },
});

const open = (options: Parameters<typeof renderApp>[0] = {}) =>
  renderApp({ path: '/conta', ...options });

async function fillPassword(user: ReturnType<typeof userEvent.setup>, again = 'nova-senha-1') {
  await user.type(await screen.findByLabelText('Senha atual'), 'velha');
  await user.type(screen.getByLabelText('Nova senha'), 'nova-senha-1');
  await user.type(screen.getByLabelText('Confirmar a nova senha'), again);
}

describe('Minha conta', () => {
  it('abre para quem só lê logs, sem nenhuma permissão da tela', async () => {
    open({
      me: LOG_READER,
      routes: { ...OVERVIEW_ROUTES, 'GET /api/auth/sessions': () => ({ body: SESSIONS }) },
    });
    expect(await screen.findByRole('heading', { name: 'Minha conta' })).toBeTruthy();
    expect(screen.queryByText('Sem permissão')).toBeNull();
  });

  it('mostra carregando e depois a lista, marcando a sessão atual', async () => {
    open({ routes: { 'GET /api/auth/sessions': () => ({ body: SESSIONS }) } });
    expect(await screen.findByText('Carregando sessões…')).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Sessões abertas' });
    expect(within(table).getAllByText('esta sessão')).toHaveLength(1);
    expect(within(table).getAllByRole('button', { name: /Encerrar a sessão/ })).toHaveLength(2);
  });

  it('mostra o vazio', async () => {
    open({ routes: { 'GET /api/auth/sessions': () => ({ body: { sessions: [] } }) } });
    expect(await screen.findByText('Nenhuma sessão aberta.')).toBeTruthy();
  });

  it('mostra o erro e tenta de novo', async () => {
    let fail = true;
    const app = open({
      routes: {
        'GET /api/auth/sessions': () => (fail ? problem(500, 'falhou') : { body: SESSIONS }),
      },
    });
    expect(await screen.findByText('falhou')).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('table', { name: 'Sessões abertas' })).toBeTruthy();
    expect(app.calls.filter((c) => c.path === '/api/auth/sessions')).toHaveLength(2);
  });

  it('encerra uma sessão só depois da confirmação e recarrega a lista', async () => {
    let list = SESSIONS;
    const app = open({
      routes: {
        'GET /api/auth/sessions': () => ({ body: list }),
        'DELETE /api/auth/sessions/s2': () => {
          list = { sessions: [session('s1', { current: true })] };
          return { body: {} };
        },
      },
    });
    const user = userEvent.setup();
    const table = await screen.findByRole('table', { name: 'Sessões abertas' });
    const buttons = within(table).getAllByRole('button', { name: /Encerrar a sessão/ });
    await user.click(buttons[1] as HTMLElement);
    expect(app.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Confirmar encerramento' }));
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getAllByRole('button')).toHaveLength(1),
    );
    const deleted = app.calls.filter((c) => c.method === 'DELETE');
    expect(deleted.map((c) => c.path)).toEqual(['/api/auth/sessions/s2']);
  });

  it('cancelar a confirmação não encerra nada', async () => {
    const app = open({ routes: { 'GET /api/auth/sessions': () => ({ body: SESSIONS }) } });
    const user = userEvent.setup();
    await screen.findByRole('table');
    const buttons = screen.getAllByRole('button', { name: /Encerrar a sessão/ });
    await user.click(buttons[0] as HTMLElement);
    expect(screen.getByText(/vai levar ao login/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(app.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('troca a senha mandando só a atual e a nova, e recarrega as sessões', async () => {
    const app = open({
      routes: {
        'GET /api/auth/sessions': () => ({ body: SESSIONS }),
        'POST /api/auth/password': () => ({ body: {} }),
      },
    });
    const user = userEvent.setup();
    await fillPassword(user);
    await user.click(screen.getByRole('button', { name: 'Trocar senha' }));
    expect(await screen.findByText(/Senha trocada/)).toBeTruthy();
    const post = app.calls.find((c) => c.method === 'POST' && c.path === '/api/auth/password');
    expect(post?.body).toEqual({ currentPassword: 'velha', newPassword: 'nova-senha-1' });
    await waitFor(() =>
      expect(app.calls.filter((c) => c.path === '/api/auth/sessions')).toHaveLength(2),
    );
    expect((screen.getByLabelText('Senha atual') as HTMLInputElement).value).toBe('');
  });

  it('confirmação diferente não chama a API e marca o campo', async () => {
    const app = open({ routes: { 'GET /api/auth/sessions': () => ({ body: SESSIONS }) } });
    const user = userEvent.setup();
    await fillPassword(user, 'outra');
    await user.click(screen.getByRole('button', { name: 'Trocar senha' }));
    const field = screen.getByLabelText('Confirmar a nova senha');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('A confirmação não é igual à nova senha.')).toBeTruthy();
    expect(app.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('senha atual errada (403) aparece junto do campo', async () => {
    open({
      routes: {
        'GET /api/auth/sessions': () => ({ body: SESSIONS }),
        'POST /api/auth/password': () => problem(403, 'senha atual incorreta'),
      },
    });
    const user = userEvent.setup();
    await fillPassword(user);
    await user.click(screen.getByRole('button', { name: 'Trocar senha' }));
    expect(await screen.findByText('senha atual incorreta')).toBeTruthy();
    expect(screen.getByLabelText('Senha atual').getAttribute('aria-invalid')).toBe('true');
  });

  it('erro 400 de validação cai no campo do path', async () => {
    open({
      routes: {
        'GET /api/auth/sessions': () => ({ body: SESSIONS }),
        'POST /api/auth/password': () =>
          problem(400, 'inválido', [
            { in: 'body', path: 'newPassword', message: 'Senha curta demais', code: 'too_small' },
          ]),
      },
    });
    const user = userEvent.setup();
    await fillPassword(user);
    await user.click(screen.getByRole('button', { name: 'Trocar senha' }));
    expect(await screen.findByText('Senha curta demais')).toBeTruthy();
    expect(screen.getByLabelText('Nova senha').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('entrada no rodapé da sidebar', () => {
  it('"Minha conta" não está nos grupos do menu e sim no rodapé, com o nome ao lado', async () => {
    open({ routes: { 'GET /api/auth/sessions': () => ({ body: SESSIONS }) } });
    await screen.findByRole('heading', { name: 'Minha conta' });
    const menu = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(menu).queryByText('Minha conta')).toBeNull();
    const link = screen.getByRole('link', { name: 'Minha conta' });
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Dona')).toBeTruthy();
  });

  it('clicar leva à tela e leva o foco ao título', async () => {
    renderApp({
      routes: { ...OVERVIEW_ROUTES, 'GET /api/auth/sessions': () => ({ body: SESSIONS }) },
    });
    const link = await screen.findByRole('link', { name: 'Minha conta' });
    expect(link.getAttribute('aria-current')).toBeNull();
    await userEvent.click(link);
    const title = await screen.findByRole('heading', { name: 'Minha conta' });
    expect(location.pathname).toBe('/conta');
    await waitFor(() => expect(document.activeElement).toBe(title));
  });
});
