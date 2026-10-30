// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Handler, LOG_READER, OWNER, renderApp } from '#test-support.tsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const GEMINI = 'google:gemini-2.5-flash';
const CLAUDE = 'anthropic:claude-sonnet-5-5';
const DEEPSEEK = 'deepseek:deepseek-chat';

const CATALOG = {
  providers: [
    {
      id: 'google',
      name: 'Google',
      key: 'configured',
      temperature: { min: 0, max: 2 },
      models: [
        { id: 'gemini-2.5-flash', audio: true, nativeSearch: true },
        { id: 'gemini-2.5-flash-lite', audio: true, nativeSearch: true },
      ],
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      key: 'configured',
      temperature: { min: 0, max: 1 },
      models: [
        { id: 'claude-haiku-5-5', audio: false, nativeSearch: false },
        { id: 'claude-sonnet-5-5', audio: false, nativeSearch: false },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      key: 'env',
      temperature: { min: 0, max: 2 },
      models: [{ id: 'gpt-5', audio: false, nativeSearch: false }],
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      key: 'missing',
      temperature: { min: 0, max: 2 },
      models: [{ id: 'deepseek-chat', audio: false, nativeSearch: false }],
    },
  ],
};

type Cfg = {
  view: { config: unknown; messages: Record<string, string>; sources: Record<string, string> };
  schema: unknown;
  secretsWritable: boolean;
};

const view = (
  config: unknown,
  sources: Record<string, string> = {},
  messages: Record<string, string> = {},
): Cfg => ({
  view: { config, messages, sources },
  schema: {
    properties: {
      keys: {
        properties: { google: {}, anthropic: {}, openai: {}, deepseek: {} },
      },
    },
  },
  secretsWritable: true,
});

const AI_CONFIG = (
  models: unknown[] = [{ model: GEMINI, temperature: 1.5 }, { model: CLAUDE }, { model: DEEPSEEK }],
) =>
  view(
    {
      models,
      timeoutMs: 60_000,
      cooldownMs: 30_000,
      maxToolSteps: 5,
      keys: { google: '********' },
    },
    { models: 'override', timeoutMs: 'default', cooldownMs: 'default', 'keys.google': 'secret' },
  );

interface Setup {
  ai?: Cfg;
  plugins?: Record<string, Cfg>;
  put?: Handler;
  extra?: Record<string, Handler>;
}

function routes({ ai = AI_CONFIG(), plugins = {}, put, extra = {} }: Setup = {}) {
  const base: Record<string, Handler> = {
    'GET /api/plugins/ai/config': () => ({ body: ai }),
    'GET /api/plugins/ai/catalog': () => ({ body: CATALOG }),
    'GET /api/plugins/ai/status': () => ({
      body: {
        models: [
          { model: GEMINI, state: 'ready' },
          { model: CLAUDE, state: 'cooldown', until: new Date(Date.now() + 38_000).toISOString() },
          { model: DEEPSEEK, state: 'unregistered' },
        ],
      },
    }),
    'PUT /api/plugins/ai/config':
      put ??
      (({ body }) => ({
        body: view(
          { timeoutMs: 60_000, cooldownMs: 30_000, maxToolSteps: 5, ...(body as object) },
          { models: 'override' },
        ),
      })),
  };
  for (const name of ['luma', 'resumo', 'transcribe', 'spontaneous', 'web-search']) {
    base[`GET /api/plugins/${name}/config`] = () => ({
      body: plugins[name] ?? view({ models: [] }),
    });
    base[`PUT /api/plugins/${name}/config`] = ({ body }) => ({ body: view(body) });
  }
  return { ...base, ...extra };
}

/** O happy-dom não tem `confirm`: troca por um espião que responde `answer`. */
const stubConfirm = (answer: boolean) => {
  const fn = vi.fn(() => answer);
  window.confirm = fn;
  return fn;
};

const WITH_KEYS = { ...OWNER, permissions: [...OWNER.permissions, 'secrets.write'] };

const open = async (setup: Setup = {}, me: object = WITH_KEYS) => {
  const app = renderApp({ me, path: '/ia', routes: routes(setup) });
  await screen.findByRole('list', { name: /Ordem de tentativa, ordem principal/ });
  return app;
};

const chainNames = () =>
  within(screen.getByRole('list', { name: /ordem principal/ }))
    .getAllByRole('button', { name: /^Editar / })
    .map((b) => b.getAttribute('aria-label')?.replace('Editar ', ''));

const putBody = (app: Awaited<ReturnType<typeof open>>, name = 'ai') =>
  app.calls.find((c) => c.method === 'PUT' && c.path === `/api/plugins/${name}/config`)?.body;

describe('IA: cadeia', () => {
  it('lista a ordem numerada com o estado de cada posição', async () => {
    await open();
    const list = screen.getByRole('list', { name: /ordem principal/ });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(chainNames()).toEqual([GEMINI, CLAUDE, DEEPSEEK]);
    expect(await within(list).findByText('pronto')).toBeTruthy();
    expect(within(list).getByText(/^em espera, \d+ s$/)).toBeTruthy();
    expect(within(list).getByText('pulado, sem chave')).toBeTruthy();
    expect(
      screen.getByText('Se todos falharem, a Luma avisa no chat que está indisponível.'),
    ).toBeTruthy();
  });

  it('sobe, desce e remove; o botão de salvar só vale com alteração', async () => {
    const user = userEvent.setup();
    const app = await open();
    const save = screen.getByRole('button', { name: 'Salvar alterações' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Alterações não salvas')).toBeNull();

    await user.click(screen.getByRole('button', { name: `Subir ${CLAUDE}` }));
    expect(chainNames()).toEqual([CLAUDE, GEMINI, DEEPSEEK]);
    await user.click(screen.getByRole('button', { name: `Descer ${CLAUDE}` }));
    await user.click(screen.getByRole('button', { name: `Remover ${DEEPSEEK}` }));
    expect(chainNames()).toEqual([GEMINI, CLAUDE]);
    expect(screen.getByText('Alterações não salvas')).toBeTruthy();
    expect((save as HTMLButtonElement).disabled).toBe(false);

    await user.click(save);
    await waitFor(() => expect(putBody(app)).toBeTruthy());
    expect(putBody(app)).toEqual({
      models: [{ model: GEMINI, temperature: 1.5 }, { model: CLAUDE }],
    });
    expect(await screen.findByText('Alterações salvas')).toBeTruthy();
    expect(screen.queryByText('Alterações não salvas')).toBeNull();
  });

  it('não deixa remover a última posição', async () => {
    renderApp({ path: '/ia', routes: routes({ ai: AI_CONFIG([{ model: GEMINI }]) }) });
    const button = await screen.findByRole('button', { name: `Remover ${GEMINI}` });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('adiciona do catálogo e desabilita o que já está na cadeia', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Adicionar modelo' }));
    const disabled = screen.getByRole('button', { name: `Adicionar ${GEMINI}` });
    expect((disabled as HTMLButtonElement).disabled).toBe(true);
    await user.click(
      screen.getByRole('button', { name: 'Adicionar google:gemini-2.5-flash-lite' }),
    );
    expect(chainNames()).toEqual([GEMINI, CLAUDE, DEEPSEEK, 'google:gemini-2.5-flash-lite']);
    expect(screen.queryByRole('button', { name: `Adicionar ${CLAUDE}` })).toBeNull();
  });

  it('modelo fora do catálogo aparece marcado e não bloqueia', async () => {
    const user = userEvent.setup();
    const app = await open({ ai: AI_CONFIG([{ model: 'google:gemini-9' }]) });
    const edit = screen.getByRole('region', { name: /Edição da posição 1/ });
    expect(within(edit).getByText('fora do catálogo')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Adicionar modelo' }));
    await user.click(screen.getByRole('button', { name: `Adicionar ${CLAUDE}` }));
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(putBody(app)).toBeTruthy());
    expect(putBody(app)).toEqual({ models: [{ model: 'google:gemini-9' }, { model: CLAUDE }] });
  });
});

describe('IA: edição da posição', () => {
  it('trocar de provedor limita a temperatura ao novo máximo', async () => {
    const user = userEvent.setup();
    const app = await open();
    const edit = screen.getByRole('region', { name: /Edição da posição 1/ });
    const slider = within(edit).getByLabelText('Temperatura') as HTMLInputElement;
    expect(slider.max).toBe('2');
    expect(slider.value).toBe('1.5');

    await user.click(within(edit).getByRole('button', { name: 'Anthropic' }));
    const after = screen.getByRole('region', { name: /Edição da posição 1/ });
    expect((within(after).getByLabelText('Temperatura') as HTMLInputElement).max).toBe('1');
    expect(chainNames()[0]).toBe('anthropic:claude-haiku-5-5');

    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(putBody(app)).toBeTruthy());
    expect((putBody(app) as { models: unknown[] }).models[0]).toEqual({
      model: 'anthropic:claude-haiku-5-5',
      temperature: 1,
    });
  });

  it('"padrão do provedor" tira a temperatura e a saída máxima vem do segmentado', async () => {
    const user = userEvent.setup();
    const app = await open();
    const edit = screen.getByRole('region', { name: /Edição da posição 1/ });
    await user.click(within(edit).getByRole('checkbox', { name: 'Padrão do provedor' }));
    await user.click(within(edit).getByRole('button', { name: '2.048' }));
    await user.click(within(edit).getByRole('radio', { name: /^gemini-2.5-flash-lite/ }));
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(putBody(app)).toBeTruthy());
    expect((putBody(app) as { models: unknown[] }).models[0]).toEqual({
      model: 'google:gemini-2.5-flash-lite',
      maxOutputTokens: 2048,
    });
  });

  it('selecionar outra linha abre a edição dela', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: `Editar ${CLAUDE}` }));
    expect(screen.getByRole('region', { name: /Edição da posição 2/ })).toBeTruthy();
  });
});

describe('IA: limites', () => {
  it('mostra segundos e passos e manda em ms', async () => {
    const user = userEvent.setup();
    const app = await open();
    expect(screen.getByRole('table', { name: 'Quando passa para o próximo modelo' })).toBeTruthy();
    const timeout = screen.getByLabelText(/Tempo limite por tentativa/) as HTMLInputElement;
    expect(timeout.value).toBe('60');
    expect((screen.getByLabelText(/Espera depois do 429/) as HTMLInputElement).value).toBe('30');
    await user.clear(timeout);
    await user.type(timeout, '45');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(putBody(app)).toBeTruthy());
    expect(putBody(app)).toMatchObject({ timeoutMs: 45_000 });
    expect(putBody(app)).not.toHaveProperty('cooldownMs');
  });

  it('valor inválido aparece junto do campo e trava o salvar', async () => {
    const user = userEvent.setup();
    await open();
    const steps = screen.getByLabelText(/Passos por resposta/);
    await user.clear(steps);
    await user.type(steps, '0');
    expect(steps.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Informe um número inteiro, 1 ou mais.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Salvar alterações' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('IA: por recurso', () => {
  const plugins = {
    luma: view({ persona: 'Luma', models: [] }, { persona: 'override' }),
    resumo: view(
      { models: [{ model: 'google:gemini-2.5-flash-lite' }], maxMessages: 50 },
      { models: 'override', maxMessages: 'override' },
    ),
  };

  it('mostra "Ordem principal" ou "Própria" por recurso', async () => {
    await open({ plugins });
    const table = screen.getByRole('table', { name: 'Cadeia de cada recurso' });
    for (const label of ['Conversa', 'Resumo', 'Transcrição', 'Reação com emoji']) {
      expect(within(table).getByText(label)).toBeTruthy();
    }
    expect(within(table).getByRole('button', { name: 'Própria', pressed: true })).toBeTruthy();
  });

  it('virar própria copia a ordem principal e preserva os overrides do plugin', async () => {
    const user = userEvent.setup();
    const app = await open({ plugins });
    const group = screen.getByRole('group', { name: 'Cadeia de Conversa' });
    await user.click(within(group).getByRole('button', { name: 'Própria' }));
    const own = screen.getByRole('list', { name: /Ordem de tentativa, Conversa/ });
    expect(within(own).getAllByRole('listitem')).toHaveLength(3);
    await user.click(within(own).getByRole('button', { name: `Remover ${DEEPSEEK}` }));
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(putBody(app, 'luma')).toBeTruthy());
    expect(putBody(app, 'luma')).toEqual({
      persona: 'Luma',
      models: [{ model: GEMINI, temperature: 1.5 }, { model: CLAUDE }],
    });
    expect(putBody(app)).toBeUndefined();
  });

  it('voltar à ordem principal tira models e preserva o resto', async () => {
    const user = userEvent.setup();
    const app = await open({ plugins });
    const group = screen.getByRole('group', { name: 'Cadeia de Resumo' });
    await user.click(within(group).getByRole('button', { name: 'Ordem principal' }));
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(putBody(app, 'resumo')).toBeTruthy());
    expect(putBody(app, 'resumo')).toEqual({ maxMessages: 50 });
  });

  it('plugin sem config carregada fica indisponível', async () => {
    renderApp({
      path: '/ia',
      routes: routes({
        extra: { 'GET /api/plugins/spontaneous/config': () => ({ status: 404, body: {} }) },
      }),
    });
    expect(await screen.findByText('indisponível')).toBeTruthy();
  });
});

describe('IA: chaves', () => {
  it('uma linha por provedor, com o estado de cada chave', async () => {
    await open();
    const table = screen.getByRole('table', { name: 'Chaves dos provedores' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getAllByText('configurada')).toHaveLength(2);
    expect(within(table).getByText('sem chave')).toBeTruthy();
    expect(within(table).getByText('BRIDGER_AI__KEYS__OPENAI')).toBeTruthy();
    expect(within(table).queryByLabelText('Chave de OpenAI')).toBeNull();
    expect((within(table).getByLabelText('Chave de Google') as HTMLInputElement).type).toBe(
      'password',
    );
  });

  it('a chave digitada vai no corpo e o campo volta vazio depois de salvar', async () => {
    const user = userEvent.setup();
    const app = await open();
    const field = screen.getByLabelText('Chave de DeepSeek') as HTMLInputElement;
    await user.type(field, 'sk-novo');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(putBody(app)).toBeTruthy());
    expect(putBody(app)).toEqual({ models: expect.any(Array), keys: { deepseek: 'sk-novo' } });
    await waitFor(() => expect(field.value).toBe(''));
  });

  it('sem secrets.write, o campo de chave some', async () => {
    await open({}, OWNER);
    expect(screen.queryByLabelText('Chave de DeepSeek')).toBeNull();
  });
});

describe('IA: salvar e erros', () => {
  it('erro 400 aparece junto do campo, sem perder a edição', async () => {
    const user = userEvent.setup();
    const app = await open({
      put: () => ({
        status: 400,
        body: {
          type: 'about:blank',
          title: 'Erro',
          status: 400,
          errors: [
            { in: 'body', path: 'models.0.temperature', message: 'acima do máximo', code: 'x' },
            { in: 'body', path: 'cooldownMs', message: 'valor inválido', code: 'x' },
            { in: 'body', path: 'keys.deepseek', message: 'chave inválida', code: 'x' },
          ],
        },
      }),
    });
    await user.type(screen.getByLabelText('Chave de DeepSeek'), 'ruim');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('acima do máximo')).toBeTruthy();
    expect(screen.getByText('valor inválido')).toBeTruthy();
    expect(screen.getByLabelText('Chave de DeepSeek').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('chave inválida')).toBeTruthy();
    expect(screen.getByText('Alterações não salvas')).toBeTruthy();
    expect(putBody(app)).toBeTruthy();
  });

  it('falha que não é de campo vira aviso', async () => {
    const user = userEvent.setup();
    await open({
      put: () => ({
        status: 500,
        body: { type: 'about:blank', title: 'Erro', status: 500, detail: 'bot caiu' },
      }),
    });
    await user.click(screen.getByRole('button', { name: `Remover ${DEEPSEEK}` }));
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect((await screen.findByRole('alert')).textContent).toContain('bot caiu');
  });

  it('descartar volta ao que está salvo', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: `Remover ${DEEPSEEK}` }));
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(chainNames()).toEqual([GEMINI, CLAUDE, DEEPSEEK]);
    expect(screen.queryByText('Alterações não salvas')).toBeNull();
  });
});

describe('IA: sair com alteração pendente', () => {
  it('pede confirmação ao seguir um link interno e fica se a pessoa recusar', async () => {
    const user = userEvent.setup();
    const confirm = stubConfirm(false);
    await open();
    await user.click(screen.getByRole('button', { name: `Remover ${DEEPSEEK}` }));
    await user.click(screen.getAllByRole('link', { name: 'Plugins' })[0] as HTMLElement);
    expect(confirm).toHaveBeenCalledOnce();
    expect(location.pathname).toBe('/ia');

    confirm.mockReturnValue(true);
    await user.click(screen.getAllByRole('link', { name: 'Plugins' })[0] as HTMLElement);
    expect(location.pathname).toBe('/plugins');
  });

  it('sem alteração, navega sem perguntar', async () => {
    const user = userEvent.setup();
    const confirm = stubConfirm(false);
    await open();
    await user.click(screen.getAllByRole('link', { name: 'Plugins' })[0] as HTMLElement);
    expect(confirm).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/plugins');
  });

  it('avisa também ao fechar a aba (beforeunload)', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: `Remover ${DEEPSEEK}` }));
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('IA: estados e permissões', () => {
  it('carregando', async () => {
    renderApp({
      path: '/ia',
      routes: { ...routes(), 'GET /api/plugins/ai/catalog': () => ({ body: CATALOG }) },
    });
    expect((await screen.findByRole('status')).textContent).toContain('Carregando');
  });

  it('erro da API com "Tentar de novo"', async () => {
    const user = userEvent.setup();
    let fail = true;
    const app = renderApp({
      path: '/ia',
      routes: routes({
        extra: {
          'GET /api/plugins/ai/catalog': () =>
            fail
              ? {
                  status: 500,
                  body: { type: 'about:blank', title: 'Erro', status: 500, detail: 'sem catálogo' },
                }
              : { body: CATALOG },
        },
      }),
    });
    expect((await screen.findByRole('alert')).textContent).toContain('sem catálogo');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('list', { name: /ordem principal/ })).toBeTruthy();
    expect(app.calls.filter((c) => c.path === '/api/plugins/ai/catalog').length).toBeGreaterThan(1);
  });

  it('cadeia vazia pede para adicionar um modelo', async () => {
    renderApp({ path: '/ia', routes: routes({ ai: AI_CONFIG([]) }) });
    expect(await screen.findByText(/Nenhum modelo na cadeia/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Adicionar modelo' })).toBeTruthy();
  });

  it('sem config.read, a tela é "Sem permissão"', async () => {
    renderApp({ me: LOG_READER, path: '/ia', routes: routes() });
    expect(await screen.findByRole('heading', { name: 'Sem permissão' })).toBeTruthy();
  });

  it('só com config.read vê a cadeia, sem editar nem salvar', async () => {
    const me = { ...OWNER, permissions: ['config.read', 'connection.read'] };
    await open({}, me);
    expect(screen.queryByRole('button', { name: /^Subir / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remover / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adicionar modelo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).toBeNull();
    expect(screen.queryByRole('region', { name: /Edição da posição/ })).toBeNull();
    expect(screen.queryByLabelText('Chave de DeepSeek')).toBeNull();
    expect((screen.getByLabelText(/Tempo limite por tentativa/) as HTMLInputElement).disabled).toBe(
      true,
    );
  });
});

describe('IA: revisão', () => {
  const cfg = (extra: Record<string, unknown> = {}) => ({
    models: [{ model: GEMINI }, { model: 'google:gemini-2.5-flash-lite' }, { model: CLAUDE }],
    timeoutMs: 60_000,
    cooldownMs: 30_000,
    maxToolSteps: 5,
    ...extra,
  });

  it('as mensagens em override voltam no corpo do PUT', async () => {
    const user = userEvent.setup();
    const app = await open({
      ai: view(cfg(), { models: 'override', 'messages.oi': 'override' }, { oi: 'Olá' }),
    });
    const timeout = screen.getByLabelText(/Tempo limite por tentativa/);
    await user.clear(timeout);
    await user.type(timeout, '10');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(putBody(app)).toBeTruthy());
    expect(putBody(app)).toMatchObject({ messages: { oi: 'Olá' }, timeoutMs: 10_000 });
  });

  it('chave por variável (fonte da config) é só leitura, mesmo com o catálogo dizendo configurada', async () => {
    await open({ ai: view(cfg(), { models: 'override', 'keys.google': 'env' }) });
    const table = screen.getByRole('table', { name: 'Chaves dos provedores' });
    expect(within(table).getAllByText('BRIDGER_AI__KEYS__GOOGLE')).toHaveLength(1);
    expect(within(table).queryByLabelText('Chave de Google')).toBeNull();
  });

  it('só há campo de chave para provedor que o schema declara', async () => {
    await open({
      ai: {
        ...view(cfg(), { models: 'override' }),
        schema: { properties: { keys: { properties: { google: {} } } } },
      },
    });
    expect(screen.getByLabelText('Chave de Google')).toBeTruthy();
    expect(screen.queryByLabelText('Chave de DeepSeek')).toBeNull();
  });

  it('409 de segredo sombreado aparece junto da linha da chave', async () => {
    const user = userEvent.setup();
    await open({
      put: () => ({
        status: 409,
        body: {
          type: 'about:blank',
          title: 'Conflito',
          status: 409,
          errors: [
            { in: 'body', path: 'keys.deepseek', message: 'definida pela env X', code: 'shadowed' },
          ],
        },
      }),
    });
    await user.type(screen.getByLabelText('Chave de DeepSeek'), 'k');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('definida pela env X')).toBeTruthy();
    expect(screen.getByLabelText('Chave de DeepSeek').getAttribute('aria-invalid')).toBe('true');
  });

  it('campos definidos por env ou arquivo ficam só leitura com a origem', async () => {
    await open({ ai: view(cfg(), { models: 'env', timeoutMs: 'file', cooldownMs: 'default' }) });
    expect(screen.queryByRole('button', { name: /^Subir / })).toBeNull();
    expect(screen.getByText(/definido por BRIDGER_AI__MODELS/)).toBeTruthy();
    expect((screen.getByLabelText(/Tempo limite por tentativa/) as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/definido pelo arquivo de config/)).toBeTruthy();
    expect((screen.getByLabelText(/Espera depois do 429/) as HTMLInputElement).disabled).toBe(
      false,
    );
  });

  it('models de recurso por env não deixa trocar a cadeia', async () => {
    const user = userEvent.setup();
    await open({
      plugins: { resumo: view({ models: [{ model: 'openai:gpt-5' }] }, { models: 'env' }) },
    });
    expect(screen.queryByRole('group', { name: 'Cadeia de Resumo' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Resumo/ }));
    expect(screen.getByText(/definido por BRIDGER_RESUMO__MODELS/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remover openai:gpt-5' })).toBeNull();
  });

  it('não repete modelo: o rádio de outra posição fica desabilitado', async () => {
    const user = userEvent.setup();
    await open({ ai: view(cfg(), { models: 'override' }) });
    const edit = screen.getByRole('region', { name: /Edição da posição 1/ });
    const radio = within(edit).getByRole('radio', { name: /^gemini-2.5-flash-lite/ });
    expect((radio as HTMLInputElement).disabled).toBe(true);
    await user.click(within(edit).getByRole('button', { name: 'Anthropic' }));
    // claude-sonnet-5-5 já está na posição 3: a troca cai no primeiro livre.
    expect(chainNames()[0]).toBe('anthropic:claude-haiku-5-5');
  });

  it('a edição dentro da tabela não vira outro card', async () => {
    const user = userEvent.setup();
    await open({
      plugins: { resumo: view({ models: [{ model: GEMINI }] }, { models: 'override' }) },
    });
    await user.click(screen.getByRole('button', { name: /^Resumo/ }));
    const edit = screen.getByRole('region', { name: /Edição da posição 1, Resumo/ });
    expect(edit.className).not.toContain('shadow');
    expect(edit.className).toContain('border-t');
  });

  it('saída máxima fora dos presets ganha a própria opção', async () => {
    await open({ ai: view(cfg({ models: [{ model: GEMINI, maxOutputTokens: 3000 }] })) });
    expect(screen.getByRole('button', { name: '3.000 (atual)', pressed: true })).toBeTruthy();
  });

  it('"Própria" com a principal vazia não deixa alteração pendente', async () => {
    const user = userEvent.setup();
    await open({ ai: AI_CONFIG([]) });
    const group = screen.getByRole('group', { name: 'Cadeia de Conversa' });
    await user.click(within(group).getByRole('button', { name: 'Própria' }));
    expect(screen.queryByText('Alterações não salvas')).toBeNull();
  });

  it('temperatura acima do máximo do provedor avisa sem reescrever', async () => {
    await open({ ai: view(cfg({ models: [{ model: CLAUDE, temperature: 1.8 }] })) });
    expect(screen.getByText(/acima do máximo do provedor/)).toBeTruthy();
    expect(screen.queryByText('Alterações não salvas')).toBeNull();
  });

  it('posição sem chave avisa e linka a seção Chaves; modelo mostra áudio e busca', async () => {
    await open({ ai: view(cfg({ models: [{ model: DEEPSEEK }] })) });
    const edit = screen.getByRole('region', { name: /Edição da posição 1/ });
    expect(within(edit).getByText(/Sem chave da DeepSeek: esta posição é pulada/)).toBeTruthy();
    expect(within(edit).getByRole('link', { name: 'Chaves' }).getAttribute('href')).toBe('#chaves');
  });

  it('o modelo do catálogo mostra áudio e busca nativa em texto', async () => {
    await open({});
    const edit = screen.getByRole('region', { name: /Edição da posição 1/ });
    expect(within(edit).getAllByText('áudio, busca nativa').length).toBeGreaterThan(0);
  });

  it('a chave some sem config.write, mesmo com secrets.write', async () => {
    const me = { ...OWNER, permissions: ['config.read', 'secrets.write'] };
    await open({}, me);
    expect(screen.queryByLabelText('Chave de DeepSeek')).toBeNull();
  });

  it('o tempo de espera conta a cada segundo', async () => {
    renderApp({
      path: '/ia',
      routes: routes({
        extra: {
          'GET /api/plugins/ai/status': () => ({
            body: {
              models: [
                {
                  model: CLAUDE,
                  state: 'cooldown',
                  until: new Date(Date.now() + 3500).toISOString(),
                },
              ],
            },
          }),
        },
      }),
    });
    expect(await screen.findByText('em espera, 4 s')).toBeTruthy();
    expect(await screen.findByText(/^em espera, [123] s$/, {}, { timeout: 3000 })).toBeTruthy();
  });
});
