// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { LOG_READER, OWNER, renderApp } from '#test-support.tsx';

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
});

const plugin = (name: string, extra: object = {}) => ({
  name,
  version: '1.0.0',
  origin: 'app',
  status: 'loaded',
  ...extra,
});

const LIST = {
  bootedAt: 1,
  plugins: [
    plugin('sticker'),
    plugin('luma'),
    plugin('outro', { unregistered: [{ command: 'x', missing: ['y'] }] }),
    plugin('quebrado', { status: 'skipped', reason: { kind: 'setup', message: 'sem ffmpeg' } }),
    plugin('parado', { status: 'skipped', reason: { kind: 'disabled', message: 'off' } }),
  ],
};

const SCHEMA = {
  type: 'object',
  properties: {
    temperature: { type: 'number', title: 'Temperatura', minimum: 0, maximum: 2 },
    timeoutMs: { type: 'integer', title: 'Tempo limite' },
    mode: { type: 'string', title: 'Modo', enum: ['a', 'b'] },
    tags: { type: 'array', title: 'Etiquetas', items: { type: 'string' } },
    key: { type: 'string', title: 'Chave', secret: true, writeOnly: true },
    fixed: { type: 'string', title: 'Fixo' },
    models: { type: 'array', items: { type: 'object' } },
  },
};

const CONFIG = {
  view: {
    config: {
      temperature: 0.5,
      timeoutMs: 1000,
      mode: 'a',
      tags: ['x'],
      key: '********',
      fixed: 'do-env',
      models: [],
    },
    messages: {},
    sources: { timeoutMs: 'override', key: 'secret', fixed: 'env', models: 'default' },
  },
  schema: SCHEMA,
  secretsWritable: true,
};

const routes = (config: object = CONFIG) => ({
  'GET /api/plugins': () => ({ body: LIST }),
  'GET /api/plugins/sticker/config': () => ({ body: config }),
});

describe('lista', () => {
  it('agrupa, mostra só o estado fora do normal e liga com o interruptor', async () => {
    const user = userEvent.setup();
    const app = renderApp({
      path: '/plugins',
      routes: {
        ...routes(),
        'POST /api/plugins/parado/enable': () => ({
          body: { plugin: LIST.plugins[4], dependents: [] },
        }),
      },
    });
    expect(await screen.findByRole('heading', { name: 'Conversa' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Mídia' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sistema' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Utilidades' })).toBeNull();
    expect(screen.getByText('com avisos')).toBeTruthy();
    expect(screen.getByText('falhou no boot')).toBeTruthy();

    const toggle = screen.getByRole('switch', { name: 'parado' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await user.click(toggle);
    await waitFor(() =>
      expect(app.calls.some((c) => c.path === '/api/plugins/parado/enable')).toBe(true),
    );
  });

  it('sem plugins.manage não há interruptor', async () => {
    renderApp({
      path: '/plugins',
      me: { ...OWNER, permissions: ['plugins.read', 'config.read'] },
      routes: routes(),
    });
    expect(await screen.findByRole('heading', { name: 'Conversa' })).toBeTruthy();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.getByText('desligado')).toBeTruthy();
  });

  it('plugin.status no stream relê a lista', async () => {
    const app = renderApp({ path: '/plugins', routes: routes() });
    await screen.findByRole('heading', { name: 'Conversa' });
    const before = app.calls.filter((c) => c.path === '/api/plugins').length;
    app.stream().emit('plugin.status', { name: 'luma' });
    await waitFor(() =>
      expect(app.calls.filter((c) => c.path === '/api/plugins').length).toBe(before + 1),
    );
  });

  it('carregando, erro com tentar de novo e vazio', async () => {
    const user = userEvent.setup();
    let fail = true;
    const app = renderApp({
      path: '/plugins',
      routes: {
        'GET /api/plugins': () =>
          fail
            ? {
                status: 500,
                body: { type: 'about:blank', title: 'x', status: 500, detail: 'caiu' },
              }
            : { body: { bootedAt: 1, plugins: [] } },
      },
    });
    expect(screen.queryByRole('status')).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain('caiu');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Nenhum plugin registrado.')).toBeTruthy();
    expect(app.calls.length).toBeGreaterThan(1);
  });

  it('sem plugins.read a tela é Sem permissão', async () => {
    renderApp({ path: '/plugins', me: LOG_READER });
    expect(await screen.findByText('Você não tem permissão para ver esta tela.')).toBeTruthy();
  });
});

describe('formulário', () => {
  it('gera os controles do schema e trata models, env e segredo', async () => {
    renderApp({ path: '/plugins/sticker', routes: routes() });
    const slider = (await screen.findByLabelText('Temperatura')) as HTMLInputElement;
    expect(slider.type).toBe('range');
    expect(slider.value).toBe('0.5');
    expect((screen.getByLabelText('Tempo limite') as HTMLInputElement).type).toBe('number');
    expect(screen.getByText('ms')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'a' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Adicionar a Etiquetas')).toBeTruthy();
    expect((screen.getByLabelText('Chave') as HTMLInputElement).placeholder).toBe('********');
    const fixed = screen.getByLabelText('Fixo') as HTMLInputElement;
    expect(fixed.disabled).toBe(true);
    expect(screen.getByText(/BRIDGER_STICKER__FIXED/)).toBeTruthy();
    expect(screen.getByText('Ordem principal')).toBeTruthy();
    expect(
      screen
        .getByText(/O modelo se escolhe/)
        .querySelector('a')
        ?.getAttribute('href'),
    ).toBe('/ia');
  });

  it('salva overrides existentes mais a mudança, mantém o segredo e tira o campo esvaziado', async () => {
    const user = userEvent.setup();
    const app = renderApp({
      path: '/plugins/sticker',
      routes: {
        ...routes(),
        'PUT /api/plugins/sticker/config': () => ({ body: CONFIG }),
      },
    });
    const save = await screen.findByRole('button', { name: 'Salvar' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'b' }));
    await user.type(screen.getByLabelText('Adicionar a Etiquetas'), 'novo{Enter}');
    expect(screen.getByText('Alterações não salvas')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(app.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(app.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      timeoutMs: 1000,
      mode: 'b',
      tags: ['x', 'novo'],
      key: '********',
    });
    expect(await screen.findByText('Config salva; o plugin recarregou.')).toBeTruthy();

    await user.clear(screen.getByLabelText('Tempo limite'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(app.calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    expect(app.calls.filter((c) => c.method === 'PUT')[1]?.body).not.toHaveProperty('timeoutMs');
  });

  it('segredo novo substitui a máscara', async () => {
    const user = userEvent.setup();
    const app = renderApp({
      path: '/plugins/sticker',
      routes: { ...routes(), 'PUT /api/plugins/sticker/config': () => ({ body: CONFIG }) },
    });
    await user.type(await screen.findByLabelText('Chave'), 'sk-novo');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(app.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(app.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ key: 'sk-novo' });
  });

  it('erro 400 aparece junto do campo', async () => {
    const user = userEvent.setup();
    renderApp({
      path: '/plugins/sticker',
      routes: {
        ...routes(),
        'PUT /api/plugins/sticker/config': () => ({
          status: 400,
          body: {
            type: 'about:blank',
            title: 'Inválido',
            status: 400,
            errors: [{ in: 'body', path: 'timeoutMs', message: 'precisa ser positivo', code: 'x' }],
          },
        }),
      },
    });
    const field = await screen.findByLabelText('Tempo limite');
    fireEvent.change(field, { target: { value: '-3' } });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('precisa ser positivo')).toBeTruthy();
    expect(screen.getByLabelText('Tempo limite').getAttribute('aria-invalid')).toBe('true');
  });

  it('sem config.write o formulário é só leitura e sem Salvar', async () => {
    renderApp({
      path: '/plugins/sticker',
      me: { ...OWNER, permissions: ['plugins.read', 'config.read'] },
      routes: routes(),
    });
    expect(((await screen.findByLabelText('Tempo limite')) as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
  });

  it('sem config.read não pede a config', async () => {
    const app = renderApp({
      path: '/plugins/sticker',
      me: { ...OWNER, permissions: ['plugins.read'] },
      routes: routes(),
    });
    expect(await screen.findByText(/não tem permissão para ver a config/)).toBeTruthy();
    expect(app.calls.some((c) => c.path.endsWith('/config'))).toBe(false);
  });

  it('config atual inválida pede confirmação antes de substituir', async () => {
    const user = userEvent.setup();
    const app = renderApp({
      path: '/plugins/sticker',
      routes: {
        ...routes({
          view: null,
          schema: SCHEMA,
          secretsWritable: true,
          issues: [{ path: 'mode', message: 'valor inválido', kind: 'enum' }],
        }),
        'PUT /api/plugins/sticker/config': () => ({ body: CONFIG }),
      },
    });
    expect(await screen.findByText(/valor inválido/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(app.calls.some((c) => c.method === 'PUT')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Substituir e salvar' }));
    await waitFor(() => expect(app.calls.some((c) => c.method === 'PUT')).toBe(true));
  });

  it('plugin sem config e erro ao ler com tentar de novo', async () => {
    renderApp({
      path: '/plugins/sticker',
      routes: routes({ view: null, schema: null, secretsWritable: false }),
    });
    expect(await screen.findByText('Este plugin não tem config.')).toBeTruthy();
  });

  it('erro ao ler a config oferece tentar de novo', async () => {
    renderApp({
      path: '/plugins/sticker',
      routes: {
        'GET /api/plugins': () => ({ body: LIST }),
        'GET /api/plugins/sticker/config': () => ({
          status: 500,
          body: { type: 'about:blank', title: 'x', status: 500, detail: 'sem config' },
        }),
      },
    });
    expect((await screen.findByText('sem config')).closest('[role=alert]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
