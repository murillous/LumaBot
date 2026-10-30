import { describe, expect, it } from 'vitest';
import { groupOf, groupPlugins, stateOf } from './groups.ts';
import {
  buildBody,
  controlOf,
  envName,
  errorsByPath,
  isColorPattern,
  leavesOf,
  MASK,
  nodesOf,
  sourceOf,
  unitOf,
} from './schema.ts';

describe('controlOf: o mapa do guia', () => {
  it('number com limites e até 200 passos vira slider', () => {
    expect(controlOf({ type: 'number', minimum: 0, maximum: 2 }, 'temperature')).toEqual({
      kind: 'slider',
      min: 0,
      max: 2,
      step: 0.02,
    });
    expect(controlOf({ type: 'integer', minimum: 0, maximum: 200 }, 'x').kind).toBe('slider');
  });

  it('slider sem multipleOf aceita valor fino (0 a 1 com 0,05)', () => {
    const control = controlOf({ type: 'number', minimum: 0, maximum: 1 }, 'x');
    expect(control).toMatchObject({ kind: 'slider', step: 0.01 });
    expect(
      controlOf({ type: 'number', minimum: 0, maximum: 1, multipleOf: 0.05 }, 'x'),
    ).toMatchObject({
      step: 0.05,
    });
  });

  it('unidade vem do schema; o sufixo é plano B, e min/max herdam o pai', () => {
    expect(controlOf({ type: 'integer', unit: 'segundos' }, 'espera')).toMatchObject({
      unit: 'segundos',
    });
    const nodes = nodesOf({
      type: 'object',
      properties: {
        thinkingDelayMs: {
          type: 'object',
          properties: { min: { type: 'integer' }, max: { type: 'integer' } },
        },
      },
    });
    expect(leavesOf(nodes).map((l) => l.control)).toEqual([
      { kind: 'number', integer: true, unit: 'ms' },
      { kind: 'number', integer: true, unit: 'ms' },
    ]);
  });

  it('cor usa o default do schema como valor de partida', () => {
    expect(
      controlOf({ type: 'string', pattern: '^#[0-9a-f]{6}$', default: 'padrao-da-cor' }, 'c'),
    ).toEqual({
      kind: 'color',
      fallback: 'padrao-da-cor',
    });
  });

  it('array de { model } é cadeia de modelos; enum numérico guarda o número', () => {
    const item = { type: 'object', properties: { model: { type: 'string' } } };
    expect(controlOf({ type: 'array', items: item }, 'visionModels').kind).toBe('models');
    expect(controlOf({ type: 'integer', enum: [1, 2] }, 'x')).toEqual({
      kind: 'segmented',
      options: [1, 2],
    });
  });

  it('faixa com mais de 200 passos vira campo numérico', () => {
    expect(controlOf({ type: 'integer', minimum: 0, maximum: 201 }, 'x').kind).toBe('number');
  });

  it('number sem limite vira campo com a unidade do sufixo', () => {
    expect(controlOf({ type: 'integer' }, 'timeoutMs')).toEqual({
      kind: 'number',
      integer: true,
      unit: 'ms',
    });
    expect(unitOf('quality')).toBeUndefined();
  });

  it('enum de até 4 é segmentado; maior é select', () => {
    expect(controlOf({ type: 'string', enum: ['a', 'b', 'c', 'd'] }, 'x').kind).toBe('segmented');
    expect(controlOf({ type: 'string', enum: ['a', 'b', 'c', 'd', 'e'] }, 'x').kind).toBe('select');
  });

  it('array de string vira etiquetas; array de objeto não é editado', () => {
    expect(controlOf({ type: 'array', items: { type: 'string' } }, 'x').kind).toBe('tags');
    expect(controlOf({ type: 'array', items: { type: 'object' } }, 'x').kind).toBe('json');
  });

  it('string #rrggbb vira seletor de cor; outra string, texto', () => {
    expect(controlOf({ type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, 'cor').kind).toBe('color');
    expect(isColorPattern('^[a-z]+$')).toBe(false);
    expect(isColorPattern('(')).toBe(false);
    expect(controlOf({ type: 'string' }, 'x').kind).toBe('text');
  });

  it('segredo vira senha, e o campo models não é campo', () => {
    expect(controlOf({ type: 'string', secret: true, writeOnly: true }, 'token').kind).toBe(
      'secret',
    );
    expect(controlOf({ type: 'array', items: { type: 'object' } }, 'models', 'models').kind).toBe(
      'models',
    );
  });

  it('opcional (anyOf com null) vale como o tipo real', () => {
    expect(
      controlOf({ anyOf: [{ type: 'integer', minimum: 1, maximum: 5 }, { type: 'null' }] }, 'x')
        .kind,
    ).toBe('slider');
  });
});

describe('nodesOf', () => {
  const schema = {
    type: 'object',
    properties: {
      quality: { type: 'integer', title: 'Qualidade', description: 'De 1 a 100', default: 80 },
      keys: { type: 'object', properties: { openai: { type: 'string', secret: true } } },
      messages: { type: 'object', properties: { done: { type: 'string' } } },
    },
  };

  it('usa title e description, agrupa objetos e ignora messages', () => {
    const nodes = nodesOf(schema);
    expect(nodes.map((n) => n.path)).toEqual(['quality', 'keys']);
    expect(nodes[0]).toMatchObject({
      label: 'Qualidade',
      help: 'De 1 a 100',
      placeholder: 'padrão: 80',
    });
    expect(leavesOf(nodes).map((l) => l.path)).toEqual(['quality', 'keys.openai']);
  });
});

describe('buildBody', () => {
  const leaves = leavesOf(
    nodesOf({
      type: 'object',
      properties: {
        a: { type: 'integer' },
        b: { type: 'string' },
        c: { type: 'string' },
        keys: { type: 'object', properties: { openai: { type: 'string', secret: true } } },
      },
    }),
  );
  const config = { a: 1, b: 'x', c: 'y', keys: { openai: MASK } };
  const sources = { a: 'override', b: 'override', c: 'env', 'keys.openai': 'secret' };

  it('mantém overrides e segredo, aplica a mudança e ignora campo de env', () => {
    const body = buildBody({ leaves, config, sources, messages: {}, edits: { a: 7, c: 'z' } });
    expect(body).toEqual({ a: 7, b: 'x', keys: { openai: MASK } });
  });

  it('campo esvaziado sai do corpo', () => {
    expect(buildBody({ leaves, config, sources, messages: {}, edits: { b: '' } })).toEqual({
      a: 1,
      keys: { openai: MASK },
    });
  });

  it('segredo novo substitui a máscara e messages com override voltam', () => {
    const body = buildBody({
      leaves,
      config,
      sources: { ...sources, 'messages.done': 'override' },
      messages: { done: 'ok', other: 'padrão' },
      edits: { 'keys.openai': 'sk-novo' },
    });
    expect(body).toMatchObject({ keys: { openai: 'sk-novo' }, messages: { done: 'ok' } });
    expect((body['messages'] as object)['other' as never]).toBeUndefined();
  });
});

describe('apoio', () => {
  it('envName segue BRIDGER_<PLUGIN>__<CAMPO>', () => {
    expect(envName('user-names', 'openai.apiKey')).toBe('BRIDGER_USER_NAMES__OPENAI__API_KEY');
    expect(envName('ai', 'openAIKey')).toBe('BRIDGER_AI__OPEN_AI_KEY');
  });

  it('errorsByPath indexa a primeira mensagem por caminho', () => {
    expect(
      errorsByPath([
        { path: 'a', message: 'um' },
        { path: 'a', message: 'dois' },
      ]),
    ).toEqual({ a: 'um' });
  });
});

describe('sourceOf e json', () => {
  const leaves = leavesOf(
    nodesOf({
      type: 'object',
      properties: { prices: { type: 'object', additionalProperties: {} } },
    }),
  );
  const config = { prices: { a: 1, b: 2 } };

  it('qualquer override nas chaves internas preserva o valor inteiro', () => {
    const sources = { 'prices.a': 'override', 'prices.b': 'default' };
    expect(sourceOf(sources, 'prices')).toBe('override');
    expect(buildBody({ leaves, config, sources, messages: {}, edits: {} })).toEqual(config);
  });

  it('qualquer env/arquivo trava e sai do corpo', () => {
    const sources = { 'prices.a': 'override', 'prices.b': 'env' };
    expect(sourceOf(sources, 'prices')).toBe('env');
    expect(buildBody({ leaves, config, sources, messages: {}, edits: {} })).toEqual({});
  });
});

describe('grupos e estado', () => {
  const plugin = (name: string, extra: object = {}) =>
    ({ name, version: '1', origin: 'app', status: 'loaded', ...extra }) as never;

  it('plugin fora do mapa vai para Sistema e grupo vazio some', () => {
    expect(groupOf('desconhecido')).toBe('Sistema');
    expect(groupOf('give-up')).toBe('Sistema');
    expect(groupOf('utils')).toBe('Utilidades');
    const groups = groupPlugins([plugin('sticker'), plugin('zzz'), plugin('luma')]);
    expect(groups.map((g) => g.name)).toEqual(['Conversa', 'Mídia', 'Sistema']);
  });

  it('só o estado fora do normal vira texto', () => {
    expect(stateOf(plugin('a')).word).toBeUndefined();
    expect(
      stateOf(plugin('a', { unregistered: [{ command: 'x', missing: ['y'] }] })).word?.text,
    ).toBe('com avisos');
    expect(
      stateOf(plugin('a', { status: 'skipped', reason: { kind: 'disabled', message: '' } })),
    ).toEqual({ on: false });
    expect(
      stateOf(
        plugin('a', {
          status: 'skipped',
          dependsOn: { b: '*', c: '*' },
          reason: { kind: 'dependency-skipped', message: 'dependência ignorada: b' },
        }),
        [plugin('b', { status: 'skipped' }), plugin('c')],
      ),
    ).toEqual({ on: false, note: 'desligado: depende de b' });
    expect(
      stateOf(plugin('a', { status: 'skipped', reason: { kind: 'setup-failed', message: 'boom' } }))
        .word?.text,
    ).toBe('falhou no boot');
  });
});
