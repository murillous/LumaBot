import { describe, expect, it } from 'vitest';
import {
  buildAiBody,
  buildResourceBody,
  chainErrorTarget,
  changeProvider,
  clampTemperature,
  envName,
  keyEnvName,
  lockedLabel,
  lockedSource,
  moveItem,
  msToSeconds,
  normalizeOwn,
  overridesOf,
  parseChain,
  removeAt,
  schemaHasKey,
  secondsToMs,
  splitModel,
  stateWord,
  viewOverrides,
} from './chain.ts';

describe('cadeia', () => {
  it('move para cima e para baixo sem passar dos limites', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
  });

  it('remove pela posição', () => {
    expect(removeAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('lê models da config e descarta item torto', () => {
    expect(
      parseChain([
        { model: 'google:x', temperature: 0.5, maxOutputTokens: 512 },
        { model: 3 },
        'texto',
        { model: 'openai:y' },
      ]),
    ).toEqual([
      { model: 'google:x', temperature: 0.5, maxOutputTokens: 512 },
      { model: 'openai:y' },
    ]);
    expect(parseChain(undefined)).toEqual([]);
  });

  it('separa provedor e id no primeiro dois-pontos', () => {
    expect(splitModel('google:gemini-2.5-flash')).toEqual({
      provider: 'google',
      id: 'gemini-2.5-flash',
    });
    expect(splitModel('ollama:llama3:8b')).toEqual({ provider: 'ollama', id: 'llama3:8b' });
    expect(splitModel('sem-provedor')).toEqual({ provider: '', id: 'sem-provedor' });
  });
});

describe('temperatura', () => {
  it('limita à faixa e mantém o padrão do provedor', () => {
    expect(clampTemperature(1.8, { min: 0, max: 1 })).toBe(1);
    expect(clampTemperature(-1, { min: 0, max: 1 })).toBe(0);
    expect(clampTemperature(undefined, { min: 0, max: 1 })).toBeUndefined();
  });

  it('trocar de provedor limita ao novo máximo e leva o primeiro modelo', () => {
    const next = changeProvider(
      { model: 'google:gemini-2.5-flash', temperature: 1.8, maxOutputTokens: 512 },
      'anthropic',
      'claude-haiku-5-5',
      { min: 0, max: 1 },
    );
    expect(next).toEqual({
      model: 'anthropic:claude-haiku-5-5',
      temperature: 1,
      maxOutputTokens: 512,
    });
  });

  it('sem temperatura no item, o campo continua fora', () => {
    const next = changeProvider({ model: 'google:a' }, 'openai', 'gpt-5', { min: 0, max: 2 });
    expect('temperature' in next).toBe(false);
  });
});

describe('estado em palavra', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  it('pronto, em espera e pulado', () => {
    expect(stateWord({ model: 'a:b', state: 'ready' }, true, now)).toEqual({
      tone: 'ok',
      text: 'pronto',
    });
    expect(
      stateWord({ model: 'a:b', state: 'cooldown', until: '2026-10-29T12:00:38Z' }, true, now),
    ).toEqual({ tone: 'warn', text: 'em espera, 38 s' });
    expect(stateWord({ model: 'a:b', state: 'unregistered' }, true, now)).toEqual({
      tone: 'danger',
      text: 'pulado, sem chave',
    });
    expect(stateWord({ model: 'a:b', state: 'unregistered' }, false, now)?.text).toBe(
      'pulado, sem provedor',
    );
  });

  it('sem estado da API, sem palavra', () => {
    expect(stateWord(undefined, true, now)).toBeNull();
  });
});

describe('corpo do PUT', () => {
  const config = {
    persona: 'Luma',
    models: [{ model: 'google:a' }],
    nested: { a: 1, b: 2 },
    keys: { google: '********' },
    timeoutMs: 60_000,
  };
  const sources = {
    persona: 'override',
    models: 'override',
    'nested.a': 'override',
    'nested.b': 'default',
    'keys.google': 'secret',
    timeoutMs: 'default',
  };

  it('mantém só o que veio de override, até dentro de objeto', () => {
    expect(overridesOf(config, sources)).toEqual({
      persona: 'Luma',
      models: [{ model: 'google:a' }],
      nested: { a: 1 },
    });
  });

  it('cadeia própria entra em models e preserva os outros overrides', () => {
    const body = buildResourceBody({ persona: 'Luma', models: [{ model: 'x:y' }] }, [
      { model: 'google:b' },
    ]);
    expect(body).toEqual({ persona: 'Luma', models: [{ model: 'google:b' }] });
  });

  it('ordem principal tira models e preserva os outros overrides', () => {
    expect(buildResourceBody({ persona: 'Luma', models: [{ model: 'x:y' }] }, null)).toEqual({
      persona: 'Luma',
    });
  });

  it('a IA manda o que mudou e a chave digitada, sem fixar padrões', () => {
    const base = {
      chain: [{ model: 'google:a' }],
      timeoutMs: 60_000,
      cooldownMs: 60_000,
      maxToolSteps: 5,
      keys: {},
    };
    const body = buildAiBody({}, base, {
      ...base,
      cooldownMs: 30_000,
      keys: { google: 'sk-1', openai: '' },
    });
    expect(body).toEqual({ cooldownMs: 30_000, keys: { google: 'sk-1' } });
  });
});

describe('apoio', () => {
  it('aponta o item da cadeia de um erro 400', () => {
    expect(chainErrorTarget('models.2.temperature')).toEqual({ index: 2, field: 'temperature' });
    expect(chainErrorTarget('models.0')).toEqual({ index: 0, field: '' });
    expect(chainErrorTarget('timeoutMs')).toBeNull();
  });

  it('converte segundos e ms', () => {
    expect(secondsToMs('1,5')).toBe(1500);
    expect(secondsToMs('60')).toBe(60_000);
    expect(secondsToMs('')).toBeNull();
    expect(secondsToMs('abc')).toBeNull();
    expect(secondsToMs('-1')).toBeNull();
    expect(msToSeconds(1500)).toBe('1,5');
  });

  it('nome da variável da chave', () => {
    expect(keyEnvName('google')).toBe('BRIDGER_AI__KEYS__GOOGLE');
  });
});

describe('revisão', () => {
  it('as mensagens em override entram nos overrides', () => {
    expect(
      viewOverrides({
        config: { a: 1 },
        messages: { oi: 'Olá', tchau: 'Até' },
        sources: { a: 'default', 'messages.oi': 'override', 'messages.tchau': 'default' },
      }),
    ).toEqual({ messages: { oi: 'Olá' } });
  });

  it('override sombreado por env ou arquivo não volta no corpo', () => {
    expect(overridesOf({ a: 1, b: 2 }, { a: 'env', b: 'file' })).toEqual({});
  });

  it('nome da variável segue a regra do core', () => {
    expect(envName('web-search', ['quotaCooldownMs'])).toBe(
      'BRIDGER_WEB_SEARCH__QUOTA_COOLDOWN_MS',
    );
  });

  it('diz de onde vem o campo travado', () => {
    expect(lockedLabel('ai', { timeoutMs: 'env' }, 'timeoutMs')).toBe(
      'definido por BRIDGER_AI__TIMEOUT_MS',
    );
    expect(lockedLabel('ai', { 'models.0.model': 'file' }, 'models')).toBe(
      'definido pelo arquivo de config',
    );
    expect(lockedLabel('ai', { models: 'override' }, 'models')).toBeNull();
  });

  it('o schema declara a chave do provedor?', () => {
    const schema = { properties: { keys: { properties: { google: {} } } } };
    expect(schemaHasKey(schema, 'google')).toBe(true);
    expect(schemaHasKey(schema, 'openai')).toBe(false);
    expect(schemaHasKey(null, 'google')).toBe(false);
  });

  it('cadeia própria vazia vale como a principal', () => {
    expect(normalizeOwn([])).toBeNull();
    expect(buildResourceBody({ x: 1 }, [])).toEqual({ x: 1 });
  });

  it('expõe a fonte que trava o campo', () => {
    expect(lockedSource({ 'keys.google': 'env' }, 'keys.google')).toBe('env');
    expect(lockedSource({ 'keys.google': 'file' }, 'keys')).toBe('file');
    expect(lockedSource({ models: 'override' }, 'models')).toBeNull();
  });
});
