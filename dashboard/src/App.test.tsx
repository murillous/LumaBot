// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { LOG_READER, OWNER, renderApp } from './test-support.tsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

const problem = (status: number, detail: string) => ({
  type: 'about:blank',
  title: 'Erro',
  status,
  detail,
});

describe('login', () => {
  it('entra com e-mail e senha e mostra o app', async () => {
    const user = userEvent.setup();
    const app = renderApp({
      me: null,
      routes: {
        'POST /api/auth/login': () => {
          app.signIn(OWNER);
          return { body: { user: OWNER } };
        },
      },
    });
    await user.type(await screen.findByLabelText('E-mail'), 'dona@luma.test');
    await user.type(screen.getByLabelText('Senha'), 'senha-muito-longa');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('heading', { name: 'Visão geral' })).toBeTruthy();
    expect(app.calls.find((c) => c.path === '/api/auth/login')?.body).toEqual({
      email: 'dona@luma.test',
      password: 'senha-muito-longa',
    });
  });

  it('mostra o erro da API e continua na tela de entrada', async () => {
    const user = userEvent.setup();
    renderApp({
      me: null,
      routes: {
        'POST /api/auth/login': () => ({ status: 401, body: problem(401, 'senha errada') }),
      },
    });
    await user.type(await screen.findByLabelText('E-mail'), 'dona@luma.test');
    await user.type(screen.getByLabelText('Senha'), 'errada');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect((await screen.findByRole('alert')).textContent).toContain('senha errada');
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy();
  });

  it('sair volta ao login, esquece a sessão e fecha o stream', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    await screen.findByRole('heading', { name: 'Visão geral' });

    await user.click(screen.getByRole('button', { name: 'Sair' }));

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Principal' })).toBeNull();
    expect(app.stream().closed).toBe(true);
    expect(app.calls.some((c) => c.method === 'POST' && c.path === '/api/auth/logout')).toBe(true);
  });
});

describe('primeiro acesso', () => {
  it('aceita o token de bootstrap com nome e e-mail', async () => {
    const user = userEvent.setup();
    const app = renderApp({
      me: null,
      path: '/convite?token=abc123',
      routes: {
        'POST /api/auth/invites/accept': () => {
          app.signIn(OWNER);
          return { body: { user: OWNER } };
        },
      },
    });
    const token = await screen.findByLabelText('Convite');
    expect((token as HTMLInputElement).value).toBe('abc123');
    await user.type(screen.getByLabelText('Nova senha'), 'uma-senha-bem-longa');
    await user.click(screen.getByLabelText('Primeiro acesso (token de bootstrap)'));
    await user.type(screen.getByLabelText('Nome'), 'Dona');
    await user.type(screen.getByLabelText('E-mail'), 'dona@luma.test');
    await user.click(screen.getByRole('button', { name: 'Definir senha e entrar' }));

    expect(await screen.findByRole('heading', { name: 'Visão geral' })).toBeTruthy();
    expect(app.calls.find((c) => c.path === '/api/auth/invites/accept')?.body).toEqual({
      token: 'abc123',
      password: 'uma-senha-bem-longa',
      name: 'Dona',
      email: 'dona@luma.test',
    });
    expect(location.pathname).toBe('/');
  });
});

describe('GET /api/auth/me', () => {
  it('mostra "carregando" enquanto não responde', async () => {
    renderApp();
    expect(screen.getByRole('status').textContent).toBe('Carregando…');
    await screen.findByRole('heading', { name: 'Visão geral' });
  });

  it('mostra o erro com "tentar de novo" e se recupera', async () => {
    const user = userEvent.setup();
    let falhas = 1;
    renderApp({
      routes: {
        'GET /api/auth/me': () =>
          falhas-- > 0 ? { status: 503, body: problem(503, 'bot fora do ar') } : { body: OWNER },
      },
    });
    expect((await screen.findByRole('alert')).textContent).toContain('bot fora do ar');
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('heading', { name: 'Visão geral' })).toBeTruthy();
  });
});

describe('permissões', () => {
  it('o menu mostra só o que a pessoa pode ver', async () => {
    renderApp({ me: LOG_READER });
    const menu = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(menu).getByRole('link', { name: 'Visão geral' })).toBeTruthy();
    expect(within(menu).getByRole('link', { name: 'Logs' })).toBeTruthy();
    for (const hidden of ['IA', 'Plugins', 'Auditoria', 'Conexão', 'Usuários', 'Chaves de API']) {
      expect(within(menu).queryByRole('link', { name: hidden })).toBeNull();
    }
    expect(within(menu).queryByRole('heading', { name: 'Administração' })).toBeNull();
  });

  it('o dono vê os três grupos e o painel genérico na Administração', async () => {
    renderApp();
    const menu = await screen.findByRole('navigation', { name: 'Principal' });
    for (const group of ['Bot', 'Observabilidade', 'Administração']) {
      expect(within(menu).getByRole('heading', { name: group })).toBeTruthy();
    }
    expect(within(menu).getByRole('link', { name: 'Usuários' }).getAttribute('href')).toBe(
      '/plugins/dashboard/#/usuarios',
    );
  });

  it('a tela sem permissão avisa em vez de abrir', async () => {
    renderApp({ me: LOG_READER, path: '/ia' });
    expect(await screen.findByRole('heading', { name: 'Sem permissão' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'IA' })).toBeNull();
  });

  it('o item ativo leva aria-current e navegar troca a tela', async () => {
    const user = userEvent.setup();
    renderApp();
    const menu = await screen.findByRole('navigation', { name: 'Principal' });
    expect(
      within(menu).getByRole('link', { name: 'Visão geral' }).getAttribute('aria-current'),
    ).toBe('page');
    await user.click(within(menu).getByRole('link', { name: 'Plugins' }));
    expect(await screen.findByRole('heading', { name: 'Plugins' })).toBeTruthy();
    expect(location.pathname).toBe('/plugins');
    expect(within(menu).getByRole('link', { name: 'Plugins' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      within(menu).getByRole('link', { name: 'Visão geral' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('caminho desconhecido mostra "tela não encontrada"', async () => {
    renderApp({ path: '/nada' });
    expect(await screen.findByRole('heading', { name: 'Tela não encontrada' })).toBeTruthy();
  });

  it('/plugins/:nome abre a tela de Plugins com o item ativo', async () => {
    renderApp({ path: '/plugins/ai' });
    expect(await screen.findByRole('heading', { name: 'Plugins' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Plugins' }).getAttribute('aria-current')).toBe('page');
  });
});

describe('indicador ao vivo', () => {
  it('abre um EventSource em /api/events e diz "ao vivo" quando conecta', async () => {
    const app = renderApp();
    await screen.findByRole('heading', { name: 'Visão geral' });
    expect(app.streams).toHaveLength(1);
    expect(app.stream().url).toBe('http://bot.test/api/events');
    expect(screen.getByRole('status', { name: 'Conexão em tempo real' }).textContent).toBe(
      'conectando',
    );

    app.stream().open();
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Conexão em tempo real' }).textContent).toBe(
        'ao vivo',
      ),
    );
  });

  it('diz "reconectando" quando o stream cai', async () => {
    const app = renderApp();
    await screen.findByRole('heading', { name: 'Visão geral' });
    app.stream().open();
    app.stream().fail();
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Conexão em tempo real' }).textContent).toBe(
        'reconectando',
      ),
    );
  });

  it('some, e nem abre o EventSource, sem connection.read', async () => {
    const app = renderApp({ me: LOG_READER });
    await screen.findByRole('heading', { name: 'Visão geral' });
    expect(screen.queryByRole('status', { name: 'Conexão em tempo real' })).toBeNull();
    expect(app.streams).toHaveLength(0);
  });
});

describe('tema', () => {
  it('alterna Sistema, Claro e Escuro, aplica no documento e guarda', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('heading', { name: 'Visão geral' });

    await user.click(screen.getByRole('button', { name: 'Tema: Sistema' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('luma-dashboard-theme')).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Tema: Claro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Tema: Escuro' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('luma-dashboard-theme')).toBeNull();
  });
});

describe('gaveta no celular', () => {
  it('abre pelo botão Menu, fecha com Esc e ao navegar', async () => {
    const user = userEvent.setup();
    renderApp();
    const button = await screen.findByRole('button', { name: 'Menu' });
    expect(button.getAttribute('aria-expanded')).toBe('false');

    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    await user.keyboard('{Escape}');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);

    await user.click(button);
    await user.click(screen.getByRole('link', { name: 'Logs' }));
    expect(await screen.findByRole('heading', { name: 'Logs' })).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('fecha ao tocar fora, no fundo', async () => {
    const user = userEvent.setup();
    renderApp();
    const button = await screen.findByRole('button', { name: 'Menu' });
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'Fechar o menu' }));
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});
