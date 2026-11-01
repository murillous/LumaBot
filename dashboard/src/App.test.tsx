// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigate, useLeaveGuard } from '#lib/router.tsx';
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

describe('guarda de saída', () => {
  function Pending() {
    useLeaveGuard(true, 'Descarta?');
    return null;
  }

  it('Sair pergunta antes: recusar mantém a sessão, aceitar sai', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    await screen.findByRole('heading', { name: 'Visão geral' });
    render(<Pending />);
    const ask = vi.fn(() => false);
    window.confirm = ask;

    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(ask).toHaveBeenCalledWith('Descarta?');
    expect(app.calls.some((c) => c.path === '/api/auth/logout')).toBe(false);

    ask.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
  });
});

describe('foco na troca de rota', () => {
  it('só a tela nova leva o foco; mudar o parâmetro da mesma tela não', async () => {
    renderApp({ path: '/plugins/a' });
    const title = await screen.findByRole('heading', { name: 'Plugins' });
    expect(document.title).toBe('Plugins · Luma');
    expect(document.activeElement).not.toBe(title);

    act(() => navigate('/plugins/b'));
    expect(document.activeElement).not.toBe(title);

    act(() => navigate('/'));
    const overview = await screen.findByRole('heading', { name: 'Visão geral' });
    await waitFor(() => expect(document.activeElement).toBe(overview));
    expect(document.title).toBe('Visão geral · Luma');

    act(() => navigate('/plugins/c'));
    const plugins = await screen.findByRole('heading', { name: 'Plugins' });
    await waitFor(() => expect(document.activeElement).toBe(plugins));
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

describe('foco e gaveta (acessibilidade)', () => {
  it('ao abrir, o foco vai ao primeiro link e o resto da página fica inerte', async () => {
    const user = userEvent.setup();
    renderApp();
    const button = await screen.findByRole('button', { name: 'Menu' });
    await user.click(button);

    const menu = screen.getByRole('navigation', { name: 'Principal' });
    expect(document.activeElement).toBe(within(menu).getAllByRole('link')[0]);
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('header')?.hasAttribute('inert')).toBe(true);

    await user.keyboard('{Escape}');
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(false);
  });

  it('ao fechar por navegação, o foco vai ao título da tela nova', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('link', { name: 'Logs' }));
    const title = await screen.findByRole('heading', { name: 'Logs' });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('clicar no item da tela atual também fecha a gaveta e leva o foco ao título', async () => {
    const user = userEvent.setup();
    renderApp();
    const button = await screen.findByRole('button', { name: 'Menu' });
    await user.click(button);
    await user.click(screen.getByRole('link', { name: 'Visão geral' }));
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Visão geral' })),
    );
  });

  it('o título da aba acompanha a tela', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('heading', { name: 'Visão geral' });
    expect(document.title).toBe('Visão geral · Luma');
    await user.click(screen.getByRole('link', { name: 'Auditoria' }));
    expect(document.title).toBe('Auditoria · Luma');
  });
});

describe('histórico do navegador', () => {
  it('voltar e avançar (popstate) trocam a tela e o item ativo', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('link', { name: 'Logs' }));
    expect(await screen.findByRole('heading', { name: 'Logs' })).toBeTruthy();

    // O que o botão "voltar" faz: muda a URL e dispara popstate.
    act(() => {
      history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByRole('heading', { name: 'Visão geral' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Visão geral' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: 'Logs' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('sessão que acaba no meio do uso', () => {
  it('stream fechado revalida a sessão: /me 401 volta ao login', async () => {
    const app = renderApp();
    await screen.findByRole('heading', { name: 'Visão geral' });
    app.stream().open();

    app.signIn(null);
    app.stream().fail(2);

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    expect(app.calls.filter((c) => c.path === '/api/auth/me')).toHaveLength(2);
  });

  it('o 401 esquece as queries da sessão que acabou', async () => {
    const app = renderApp();
    await screen.findByRole('heading', { name: 'Visão geral' });
    app.client.setQueryData(['plugins'], [{ name: 'ai' }]);
    app.stream().open();

    app.signIn(null);
    app.stream().fail(2);

    await screen.findByRole('heading', { name: 'Entrar' });
    expect(app.client.getQueryData(['plugins'])).toBeUndefined();
    expect(app.client.getQueryData(['me'])).toBeNull();
  });

  it('stream que caiu reabre depois de 5 s e fecha o antigo', async () => {
    const app = renderApp();
    await screen.findByRole('heading', { name: 'Visão geral' });
    app.stream().open();

    vi.useFakeTimers();
    try {
      app.stream().fail(2);
      expect(app.streams).toHaveLength(1);
      expect(app.streams[0]?.closed).toBe(true);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(app.streams).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('tema salvo', () => {
  it('um tema escuro guardado aparece já no botão, no início', async () => {
    localStorage.setItem('luma-dashboard-theme', 'dark');
    renderApp();
    expect(await screen.findByRole('button', { name: 'Tema: Escuro' })).toBeTruthy();
  });
});

describe('queda do bot com sessão carregada', () => {
  it('/me falhando na revalidação mantém o shell e o menu', async () => {
    const app = renderApp();
    await screen.findByRole('heading', { name: 'Visão geral' });
    app.stream().open();

    // O proxy responde 503 enquanto o bot está fora: a revalidação do /me falha, mas há sessão.
    app.routes['GET /api/auth/me'] = () => ({ status: 503, body: problem(503, 'bot fora do ar') });
    app.stream().fail(2);

    // Espera a revalidação terminar em erro: só então vale conferir que o shell resistiu.
    await waitFor(() => expect(app.client.getQueryState(['me'])?.status).toBe('error'));
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('gaveta e largura da janela', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it('passar de 768 px fecha a gaveta e tira o inert', async () => {
    const user = userEvent.setup();
    const listeners: ((event: { matches: boolean }) => void)[] = [];
    window.matchMedia = (() => ({
      matches: false,
      addEventListener: (_: string, fn: (event: { matches: boolean }) => void) => {
        listeners.push(fn);
      },
      removeEventListener: (_: string, fn: (event: { matches: boolean }) => void) => {
        listeners.splice(listeners.indexOf(fn), 1);
      },
    })) as unknown as typeof window.matchMedia;
    renderApp();
    const button = await screen.findByRole('button', { name: 'Menu' });
    await user.click(button);
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(true);

    act(() => {
      for (const fn of [...listeners]) fn({ matches: true });
    });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(false);
    expect(listeners).toHaveLength(0);
  });
});
