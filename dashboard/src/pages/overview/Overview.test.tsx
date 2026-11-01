// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { type Handler, LOG_READER, OVERVIEW_ROUTES, renderApp } from '#test-support.tsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const problem = (detail: string) => ({ type: 'about:blank', title: 'Erro', status: 500, detail });

const CONNECTION = {
  status: 'open',
  transport: 'baileys',
  pairing: false,
  account: { id: '1', name: 'Luma', phone: null },
  reconnections: 0,
};

const HEALTHY = OVERVIEW_ROUTES;

const main = () => screen.getByRole('main');

describe('Visão geral', () => {
  it('mostra carregando enquanto as leituras não voltam', async () => {
    renderApp({ routes: HEALTHY });
    const card = (await screen.findByRole('heading', { name: 'Precisa de atenção' })).closest(
      'section',
    ) as HTMLElement;
    expect(within(card).getByRole('status').textContent).toBe('Carregando…');
    expect(within(card).queryByText('Nada pendente')).toBeNull();
    await within(card).findByText('Nada pendente');
  });

  it('sem pendência, uma linha "Nada pendente"', async () => {
    renderApp({ routes: HEALTHY });
    expect(await screen.findByText('Nada pendente')).toBeTruthy();
  });

  it('cada seção some sem a permissão da API que lê', async () => {
    const app = renderApp({ me: LOG_READER, routes: HEALTHY });
    // Só `logs.read`: o card de atenção fica (com a fonte de logs), o resto não existe.
    await screen.findByText('Nada pendente');
    const paths = app.calls.map((c) => c.path);
    expect(paths).toContain('/api/logs');
    for (const path of [
      '/api/connection',
      '/api/plugins/ai/status',
      '/api/plugins',
      '/api/plugins/metrics/catalog',
    ]) {
      expect(paths).not.toContain(path);
    }
    expect(screen.queryByText('WhatsApp')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Hoje (UTC)' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Cadeia de IA' })).toBeNull();
  });

  it('sem nenhuma permissão de leitura, só o título', async () => {
    const nobody = { ...LOG_READER, permissions: [] };
    renderApp({ me: nobody, routes: HEALTHY });
    await screen.findByRole('heading', { name: 'Visão geral' });
    expect(screen.queryByRole('heading', { name: 'Precisa de atenção' })).toBeNull();
  });

  describe('Precisa de atenção', () => {
    it('provider sem chave e modelo em cooldown levam à tela IA', async () => {
      renderApp({
        routes: {
          ...HEALTHY,
          'GET /api/plugins/ai/status': () => ({
            body: {
              models: [
                { model: 'anthropic:claude-haiku-5-5', state: 'unregistered' },
                {
                  model: 'deepseek:deepseek-chat',
                  state: 'cooldown',
                  until: new Date(Date.now() + 40_000).toISOString(),
                },
              ],
            },
          }),
        },
      });
      const card = (await screen.findByRole('heading', { name: 'Precisa de atenção' })).closest(
        'section',
      ) as HTMLElement;
      const items = await within(card).findAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(within(items[0] as HTMLElement).getByText('Sem chave')).toBeTruthy();
      expect(within(items[0] as HTMLElement).getByText('anthropic:claude-haiku-5-5')).toBeTruthy();
      expect(within(items[1] as HTMLElement).getByText(/Em espera, \d+ s/)).toBeTruthy();
      for (const item of items) {
        expect(within(item).getByRole('link').getAttribute('href')).toBe('/ia');
      }
      expect(within(card).queryByText('Nada pendente')).toBeNull();
    });

    it('avisos e erros recentes levam aos logs, o mais novo primeiro', async () => {
      const app = renderApp({
        routes: {
          ...HEALTHY,
          'GET /api/logs': () => ({
            body: {
              logs: [
                { level: 'warn', time: 1000, message: 'aviso antigo', fields: {} },
                { level: 'error', time: 2000, message: 'erro novo', fields: {} },
              ],
            },
          }),
        },
      });
      const error = await screen.findByText('erro novo');
      const item = error.closest('li') as HTMLElement;
      expect(within(item).getByText('Erro')).toBeTruthy();
      expect(within(item).getByRole('link').getAttribute('href')).toBe('/logs');
      const warn = screen.getByText('aviso antigo').closest('li') as HTMLElement;
      expect(within(warn).getByText('Aviso')).toBeTruthy();
      expect(error.compareDocumentPosition(screen.getByText('aviso antigo'))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      const call = app.calls.find((c) => c.path === '/api/logs');
      expect(call).toBeTruthy();
    });

    it('mostra 5 avisos e "e mais N"; com cursor de próxima página, "e mais de N"', async () => {
      const lines = Array.from({ length: 8 }, (_, i) => ({
        level: 'warn',
        time: 1000 + i,
        message: `aviso ${i}`,
        fields: {},
      }));
      renderApp({
        routes: { ...HEALTHY, 'GET /api/logs': () => ({ body: { logs: lines } }) },
      });
      const more = await screen.findByText('e mais 3 avisos e erros nas últimas 24 h');
      expect(within(more.closest('li') as HTMLElement).getByRole('link').textContent).toBe(
        'Ver logs',
      );
      expect(screen.queryByText('aviso 2')).toBeNull();
      cleanup();
      renderApp({
        routes: { ...HEALTHY, 'GET /api/logs': () => ({ body: { logs: lines, next: 99 } }) },
      });
      expect(await screen.findByText('e mais de 3 avisos e erros nas últimas 24 h')).toBeTruthy();
    });

    it('dependência ignorada por causa de outro plugin não conta como falha', async () => {
      renderApp({
        routes: {
          ...HEALTHY,
          'GET /api/plugins': () => ({
            body: {
              bootedAt: 1,
              plugins: [
                {
                  name: 'rank',
                  version: '1',
                  origin: 'x',
                  status: 'skipped',
                  reason: { kind: 'dependency-skipped', message: 'depende' },
                },
              ],
            },
          }),
        },
      });
      expect(await screen.findByText('Nada pendente')).toBeTruthy();
    });

    it('plugin que falhou no boot leva ao plugin; o desabilitado por config não conta', async () => {
      renderApp({
        routes: {
          ...HEALTHY,
          'GET /api/plugins': () => ({
            body: {
              bootedAt: 1,
              plugins: [
                {
                  name: 'sticker',
                  version: '1',
                  origin: 'x',
                  status: 'skipped',
                  reason: { kind: 'setup-failed', message: 'quebrou' },
                },
                {
                  name: 'poll',
                  version: '1',
                  origin: 'x',
                  status: 'skipped',
                  reason: { kind: 'disabled', message: 'desligado' },
                },
                { name: 'ai', version: '1', origin: 'x', status: 'loaded' },
              ],
            },
          }),
        },
      });
      expect(await screen.findByText('Falhou no boot')).toBeTruthy();
      const item = screen.getByText('sticker').closest('li') as HTMLElement;
      expect(within(item).getByRole('link').getAttribute('href')).toBe('/plugins/sticker');
      expect(screen.queryByText('poll')).toBeNull();
    });
  });

  describe('Hoje', () => {
    const wheres: string[][] = [];
    const metricsRoutes = (names: string[]): Record<string, Handler> => ({
      ...HEALTHY,
      'GET /api/plugins/metrics/catalog': () => ({
        body: {
          metrics: names.map((name) => ({
            name,
            type: 'counter',
            help: '',
            labelNames: [],
            live: true,
          })),
        },
      }),
      'GET /api/plugins/metrics/query': ({ url }) => {
        const name = url.searchParams.get('name');
        const where = url.searchParams.getAll('where');
        wheres.push(where);
        const value =
          name === 'ai_attempts_total'
            ? 7
            : where.includes('status:failed')
              ? 3
              : where.includes('status:timeout')
                ? 2
                : 1520;
        return { body: { rows: [{ type: 'counter', period: 'x', labels: {}, value }] } };
      },
    });

    it('mostra em linha só o que o catálogo tem', async () => {
      renderApp({ routes: metricsRoutes(['bridger_messages_handled_total']) });
      const today = (await screen.findByRole('heading', { name: 'Hoje (UTC)' })).closest(
        'section',
      ) as HTMLElement;
      await within(today).findByText('1.520');
      expect(within(today).getByText('Mensagens')).toBeTruthy();
      // Erros = failed + timeout, duas consultas somadas.
      const errors = within(today).getByText('Erros');
      await waitFor(() => expect(errors.nextElementSibling?.textContent).toBe('5'));
      expect(wheres).toContainEqual(['status:failed']);
      expect(wheres).toContainEqual(['status:timeout']);
      expect(within(today).queryByText('Respostas da IA')).toBeNull();
      expect(within(today).queryByText('Custo')).toBeNull();
    });

    it('com a métrica da IA no catálogo, mostra as respostas', async () => {
      renderApp({
        routes: metricsRoutes(['bridger_messages_handled_total', 'ai_attempts_total']),
      });
      const label = await screen.findByText('Respostas da IA');
      expect(label.tagName).toBe('DT');
      expect((label.nextElementSibling as HTMLElement).textContent).toBe('…');
      await waitFor(() => expect((label.nextElementSibling as HTMLElement).textContent).toBe('7'));
      expect(wheres).toContainEqual(['outcome:ok']);
    });

    it('indicador que falha mostra a mensagem e tenta de novo só ele', async () => {
      const user = userEvent.setup();
      let fail = true;
      renderApp({
        routes: {
          ...metricsRoutes(['bridger_messages_handled_total', 'ai_attempts_total']),
          'GET /api/plugins/metrics/query': ({ url }) =>
            url.searchParams.get('name') === 'ai_attempts_total' && fail
              ? { status: 500, body: problem('métrica fora do ar') }
              : { body: { rows: [{ type: 'counter', period: 'x', labels: {}, value: 4 }] } },
        },
      });
      const retry = await screen.findByRole('button', { name: 'Tentar de novo: Respostas da IA' });
      const dd = retry.closest('dd') as HTMLElement;
      expect(within(dd).getByRole('alert').textContent).toContain('métrica fora do ar');
      fail = false;
      await user.click(retry);
      await waitFor(() => expect(dd.textContent).toBe('4'));
    });
  });

  describe('Conexão', () => {
    it('mostra o estado e acompanha o evento connection.status', async () => {
      const app = renderApp({ routes: HEALTHY });
      await screen.findByRole('heading', { name: 'Visão geral' });
      expect(await within(main()).findByText('conectado')).toBeTruthy();
      expect(within(main()).getByText('Luma')).toBeTruthy();

      // A releitura que o evento dispara já devolve o estado novo, como o bot faria.
      app.routes['GET /api/connection'] = () => ({
        body: { ...CONNECTION, status: 'closed', reason: 'logged-out', account: null },
      });
      app.stream().emit('connection.status', { status: 'closed', reason: 'logged-out' });
      expect(await within(main()).findByText('desconectado')).toBeTruthy();
      expect(within(main()).getByText('logged-out')).toBeTruthy();
    });
  });

  describe('Cadeia de IA', () => {
    it('lista a cadeia numerada com o estado em palavra e link para editar', async () => {
      renderApp({
        routes: {
          ...HEALTHY,
          'GET /api/plugins/ai/status': () => ({
            body: {
              models: [
                { model: 'google:gemini-2.5-flash', state: 'ready' },
                { model: 'anthropic:claude-haiku-5-5', state: 'unregistered' },
              ],
            },
          }),
        },
      });
      const chain = (await screen.findByRole('heading', { name: 'Cadeia de IA' })).closest(
        'section',
      ) as HTMLElement;
      const items = await within(chain).findAllByRole('listitem');
      expect(items.map((i) => i.textContent)).toEqual([
        '1.google:gemini-2.5-flashpronto',
        '2.anthropic:claude-haiku-5-5pulado, sem chave',
      ]);
      expect(within(chain).getByRole('link', { name: 'Editar' }).getAttribute('href')).toBe('/ia');
    });
  });

  describe('erro por seção', () => {
    it('uma seção que falha mostra o erro e tenta de novo sem derrubar as outras', async () => {
      const user = userEvent.setup();
      let fail = true;
      const app = renderApp({
        routes: {
          ...HEALTHY,
          'GET /api/plugins/ai/status': () =>
            fail
              ? { status: 500, body: problem('ia fora do ar') }
              : { body: { models: [{ model: 'google:gemini-2.5-flash', state: 'ready' }] } },
        },
      });
      const chain = (await screen.findByRole('heading', { name: 'Cadeia de IA' })).closest(
        'section',
      ) as HTMLElement;
      expect((await within(chain).findByRole('alert')).textContent).toContain('ia fora do ar');
      // As outras seguem de pé.
      expect(await within(main()).findByText('conectado')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Hoje (UTC)' })).toBeTruthy();

      fail = false;
      await user.click(within(chain).getByRole('button', { name: 'Tentar de novo' }));
      expect(await within(chain).findByText('google:gemini-2.5-flash')).toBeTruthy();
      expect(app.calls.filter((c) => c.path === '/api/plugins/ai/status').length).toBe(2);
    });

    it('fonte do card que falha mostra o erro e não vira "Nada pendente"', async () => {
      renderApp({
        routes: {
          ...HEALTHY,
          'GET /api/logs': () => ({ status: 500, body: problem('logs fora do ar') }),
        },
      });
      const card = (await screen.findByRole('heading', { name: 'Precisa de atenção' })).closest(
        'section',
      ) as HTMLElement;
      expect((await within(card).findByRole('alert')).textContent).toContain('logs fora do ar');
      expect(within(card).getByText('Não deu para ler os avisos e erros recentes.')).toBeTruthy();
      expect(within(card).queryByText('Nada pendente')).toBeNull();
      expect(within(card).getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
    });
  });
});
