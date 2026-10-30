// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOG_READER, renderApp } from '#test-support.tsx';

afterEach(cleanup);

const T0 = Date.UTC(2026, 9, 29, 14, 0, 0);

const download = {
  level: 'error',
  time: T0 + 5000,
  message: 'yt-dlp saiu com código 1',
  fields: { plugin: 'download', event: 'download.media.failed', host: 'instagram.com' },
};
const sticker = {
  level: 'info',
  time: T0 + 4000,
  message: 'Figurinha criada',
  fields: { plugin: 'sticker', event: 'sticker.create.done' },
};
const reminders = {
  level: 'warn',
  time: T0 + 3000,
  message: 'lembrete atrasado',
  fields: { plugin: 'reminders' },
};
const noise = { level: 'debug', time: T0 + 2000, message: 'ruído', fields: { plugin: 'luma' } };

const PAGE_1 = { logs: [download, sticker, reminders], next: 77 };
const PAGE_2 = { logs: [noise] };

const logsRoute = (calls: URL[] = []) => ({
  'GET /api/logs': ({ url }: { url: URL }) => {
    calls.push(url);
    return { body: url.searchParams.get('before') === '77' ? PAGE_2 : PAGE_1 };
  },
});

const table = () => screen.getByRole('table', { name: 'Linhas de log' });
const messages = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent ?? '');

describe('Logs', () => {
  it('lista o histórico com hora, nível, plugin, evento e mensagem', async () => {
    renderApp({ path: '/logs', routes: logsRoute() });
    expect(await screen.findByText('yt-dlp saiu com código 1')).toBeTruthy();
    const rows = messages();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('download.media.failed');
    expect(rows[0]).toContain('error');
    // Sem `fields.event`: texto livre.
    expect(rows[2]).toContain('texto livre');
    expect(screen.getByText(/3 de 1\.000 linhas/)).toBeTruthy();
    expect(screen.getByText(/pseudonimizados/)).toBeTruthy();
  });

  it('o nível mínimo mostra a contagem do buffer e filtra, e vai para a URL', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/logs', routes: logsRoute() });
    await screen.findByText('yt-dlp saiu com código 1');
    expect(screen.getByRole('button', { name: 'warn 2' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'error 1' }));
    expect(messages()).toHaveLength(1);
    expect(location.search).toBe('?nivel=error');
    expect(screen.getByRole('button', { name: 'error 1' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('plugins combinam e a busca filtra por evento ou texto', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/logs', routes: logsRoute() });
    await screen.findByText('yt-dlp saiu com código 1');
    const group = screen.getByRole('group', { name: 'Plugins' });
    await user.click(within(group).getByRole('button', { name: 'download' }));
    await user.click(within(group).getByRole('button', { name: 'sticker' }));
    expect(messages()).toHaveLength(2);
    expect(location.search).toBe('?plugins=download%2Csticker');
    expect(
      within(group).getByRole('button', { name: 'sticker' }).getAttribute('aria-pressed'),
    ).toBe('true');

    await user.click(within(group).getByRole('button', { name: 'Todos' }));
    await user.type(screen.getByLabelText('Buscar evento ou texto'), 'sticker.create');
    expect(messages()).toHaveLength(1);
    expect(location.search).toBe('?q=sticker.create');
  });

  it('abre a tela já filtrada pela URL', async () => {
    renderApp({ path: '/logs?nivel=warn&plugins=reminders', routes: logsRoute() });
    await screen.findByText('lembrete atrasado');
    expect(messages()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'warn 2' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('a linha expande com os campos em JSON e "Só este evento" filtra pelo evento', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/logs', routes: logsRoute() });
    await screen.findByText('yt-dlp saiu com código 1');
    const first = within(table()).getAllByRole('button', { expanded: false })[0] as HTMLElement;
    await user.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/"host": "instagram.com"/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Só este evento' }));
    expect(messages()).toHaveLength(1);
    expect(location.search).toBe('?evento=download.media.failed');
    await user.click(screen.getByRole('button', { name: /Evento: download.media.failed/ }));
    expect(messages()).toHaveLength(3);
  });

  it('linha sem evento não oferece "Só este evento"', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/logs', routes: logsRoute() });
    await screen.findByText('lembrete atrasado');
    const buttons = within(table()).getAllByRole('button', { expanded: false });
    await user.click(buttons[2] as HTMLElement);
    expect(screen.queryByRole('button', { name: 'Só este evento' })).toBeNull();
  });

  it('"Mais antigas" pede a página pelo cursor e some quando acaba', async () => {
    const user = userEvent.setup();
    const calls: URL[] = [];
    renderApp({ path: '/logs?nivel=debug', routes: logsRoute(calls) });
    await screen.findByText('yt-dlp saiu com código 1');
    expect(calls[0]?.searchParams.get('before')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mais antigas' }));
    expect(await screen.findByText('ruído')).toBeTruthy();
    expect(calls[1]?.searchParams.get('before')).toBe('77');
    expect(screen.queryByRole('button', { name: 'Mais antigas' })).toBeNull();
  });

  it('"Eventos por plugin" sai das linhas, e plugin sem evento mostra "só texto livre"', async () => {
    renderApp({ path: '/logs', routes: logsRoute() });
    await screen.findByText('yt-dlp saiu com código 1');
    const events = screen.getByRole('table', { name: 'Eventos por plugin' });
    const rows = within(events).getAllByRole('row');
    const of = (plugin: string) => rows.find((r) => r.textContent?.startsWith(plugin))?.textContent;
    expect(of('download')).toContain('download.media.failed1');
    expect(of('reminders')).toContain('só texto livre');
  });

  it('ao vivo: mostra o indicador, junta linhas novas, pausa congela e retomar junta', async () => {
    const user = userEvent.setup();
    const app = renderApp({ path: '/logs', routes: logsRoute() });
    await screen.findByText('yt-dlp saiu com código 1');
    app.stream().open();
    expect(screen.getByRole('status', { name: 'Fluxo ao vivo' }).textContent).toBe('Ao vivo');

    const fresh = (n: number) => ({
      level: 'info',
      time: T0 + 10000 + n,
      message: `nova ${n}`,
      fields: { plugin: 'ai', event: 'ai.generate.done' },
    });
    app.stream().emit('log', fresh(1));
    expect(await screen.findByText('nova 1')).toBeTruthy();
    expect(messages()[0]).toContain('nova 1');

    await user.click(screen.getByRole('button', { name: 'Pausar' }));
    expect(screen.getByRole('status', { name: 'Fluxo ao vivo' }).textContent).toBe('Pausado');
    app.stream().emit('log', fresh(2));
    expect(screen.queryByText('nova 2')).toBeNull();
    const resume = screen.getByRole('button', { name: 'Retomar (1 nova)' });
    expect(resume.getAttribute('aria-pressed')).toBe('true');

    await user.click(resume);
    expect(await screen.findByText('nova 2')).toBeTruthy();
    expect(messages()[0]).toContain('nova 2');
    expect(screen.getByRole('status', { name: 'Fluxo ao vivo' }).textContent).toBe('Ao vivo');
  });

  it('não repete a linha que o histórico e o stream trazem os dois', async () => {
    const app = renderApp({ path: '/logs', routes: logsRoute() });
    await screen.findByText('yt-dlp saiu com código 1');
    app.stream().open();
    app.stream().emit('log', download);
    await waitFor(() => expect(messages()).toHaveLength(3));
  });

  it('stream caído mostra "Reconectando"', async () => {
    const app = renderApp({ path: '/logs', routes: logsRoute() });
    await screen.findByText('yt-dlp saiu com código 1');
    app.stream().open();
    app.stream().fail();
    expect(screen.getByRole('status', { name: 'Fluxo ao vivo' }).textContent).toBe('Reconectando');
  });

  it('sem connection.read não há indicador nem pausa, mas o histórico aparece', async () => {
    const app = renderApp({ me: LOG_READER, path: '/logs', routes: logsRoute() });
    await screen.findByText('yt-dlp saiu com código 1');
    expect(app.streams).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    expect(screen.getByRole('status', { name: 'Fluxo ao vivo' }).textContent).toBe('');
  });

  it('filtro sem resultado mostra o estado vazio', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/logs', routes: logsRoute() });
    await screen.findByText('yt-dlp saiu com código 1');
    await user.type(screen.getByLabelText('Buscar evento ou texto'), 'zzz');
    expect(screen.getByText('Nenhuma linha com esses filtros')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Linhas de log' })).toBeNull();
  });

  it('mostra o carregando e depois o erro com "Tentar de novo"', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp({
      path: '/logs',
      routes: {
        'GET /api/logs': () =>
          fail
            ? {
                status: 500,
                body: {
                  type: 'about:blank',
                  title: 'Erro',
                  status: 500,
                  detail: 'buffer indisponível',
                },
              }
            : { body: PAGE_1 },
      },
    });
    expect(await screen.findByText('Carregando logs…')).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain('buffer indisponível');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('yt-dlp saiu com código 1')).toBeTruthy();
  });

  it('pede o buffer inteiro de uma vez', async () => {
    const calls: URL[] = [];
    renderApp({ path: '/logs', routes: logsRoute(calls) });
    await screen.findByText('yt-dlp saiu com código 1');
    expect(calls[0]?.searchParams.get('limit')).toBe('1000');
  });

  it('reconexão com a tela pausada só relê o histórico ao retomar', async () => {
    const user = userEvent.setup();
    const calls: URL[] = [];
    const app = renderApp({ path: '/logs', routes: logsRoute(calls) });
    await screen.findByText('yt-dlp saiu com código 1');
    app.stream().open();
    await user.click(screen.getByRole('button', { name: 'Pausar' }));
    app.stream().fail();
    app.stream().open();
    expect(calls).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Retomar' }));
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it('"Mais antigas" some com o buffer cheio mesmo havendo cursor', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({
      level: 'debug',
      time: T0 + i,
      message: `m${i}`,
      fields: {},
    }));
    renderApp({
      path: '/logs?q=zzz',
      routes: { 'GET /api/logs': () => ({ body: { logs: full, next: 5 } }) },
    });
    await screen.findByText('Nenhuma linha com esses filtros');
    expect(screen.queryByRole('button', { name: 'Mais antigas' })).toBeNull();
  });

  it('buffer vazio diz que não há linha desde o restart', async () => {
    renderApp({ path: '/logs', routes: { 'GET /api/logs': () => ({ body: { logs: [] } }) } });
    expect(await screen.findByText('Nenhuma linha desde o restart')).toBeTruthy();
    expect(screen.queryByText('Nenhuma linha com esses filtros')).toBeNull();
  });

  it('clique empilha no histórico e o voltar desfaz; a busca de texto só troca a entrada', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/logs', routes: logsRoute() });
    await screen.findByText('yt-dlp saiu com código 1');
    await user.click(screen.getByRole('button', { name: 'error 1' }));
    expect(location.search).toBe('?nivel=error');
    history.back();
    await waitFor(() => expect(location.search).toBe(''));
    expect(messages()).toHaveLength(3);

    const push = vi.spyOn(history, 'pushState');
    await user.type(screen.getByLabelText('Buscar evento ou texto'), 'abc');
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });

  it('nível fora do segmentado na URL cai em info', async () => {
    renderApp({ path: '/logs?nivel=fatal', routes: logsRoute() });
    await screen.findByText('yt-dlp saiu com código 1');
    expect(screen.getByRole('button', { name: /^info/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('ao voltar de "reconectando" busca o histórico de novo', async () => {
    const calls: URL[] = [];
    const app = renderApp({ path: '/logs', routes: logsRoute(calls) });
    await screen.findByText('yt-dlp saiu com código 1');
    app.stream().open();
    expect(calls).toHaveLength(1);
    app.stream().fail();
    app.stream().open();
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it('o erro da 1ª página não mostra "Eventos por plugin"', async () => {
    renderApp({
      path: '/logs',
      routes: {
        'GET /api/logs': () => ({
          status: 500,
          body: { type: 'about:blank', title: 'Erro', status: 500 },
        }),
      },
    });
    await screen.findByRole('alert');
    expect(screen.queryByRole('heading', { name: 'Eventos por plugin' })).toBeNull();
  });

  it('sem logs.read mostra "Sem permissão" e não chama a API', async () => {
    const app = renderApp({
      me: { ...LOG_READER, permissions: ['plugins.read'] },
      path: '/logs',
      routes: logsRoute(),
    });
    expect(await screen.findByRole('heading', { name: 'Sem permissão' })).toBeTruthy();
    expect(app.calls.some((c) => c.path === '/api/logs')).toBe(false);
  });
});
