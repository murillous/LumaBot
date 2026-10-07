import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { recordingLogger } from '#bot/harness.test-support.ts';
import { createLogger, type LogDestination } from '#logger/logger.ts';
import { createSecretSet } from '#logger/secrets.ts';
import type { PluginDefinition } from '#plugin/types.ts';
import { createMemoryStorage } from '#storage/memory.ts';
import { kernelStorage } from '#storage/namespace.ts';
import type { JsonObject, StoragePort } from '#storage/types.ts';
import type { ConfigEnv } from './env.ts';
import { PluginConfigError } from './errors.ts';
import { createPluginConfigs, type PluginConfigFile } from './plugin-configs.ts';
import { SECRET_MASK, secret } from './schema.ts';

function plugin(
  name: string,
  extra: Partial<Pick<PluginDefinition, 'config' | 'messages'>> = {},
): PluginDefinition {
  return { name, version: '1.0.0', engine: '^1.0.0', setup: () => undefined, ...extra };
}

const sticker = plugin('sticker', {
  config: z.object({
    a: z.string().default('default'),
    b: z.string().default('default'),
    c: z.string().default('default'),
    d: z.string().default('default'),
    quality: z.number().min(1).max(100).default(80),
  }),
  messages: { needMedia: 'Mande uma imagem', done: 'Pronto' },
});

const ai = plugin('ai', {
  config: z.object({
    model: z.string().default('flash'),
    apiKey: secret(z.string().min(8)),
    openai: z.object({ token: secret(z.string()).optional() }).default({}),
  }),
});

interface Setup {
  readonly plugins?: PluginDefinition[];
  readonly file?: PluginConfigFile;
  readonly env?: ConfigEnv;
  readonly overrides?: Record<string, JsonObject>;
}

async function setup(options: Setup = {}) {
  const storage: StoragePort = createMemoryStorage();
  const kv = kernelStorage(storage, 'config').kv;
  for (const [name, value] of Object.entries(options.overrides ?? {})) await kv.set(name, value);
  const secrets = createSecretSet();
  const configs = createPluginConfigs({
    plugins: options.plugins ?? [sticker, ai],
    storage,
    secrets,
    env: options.env ?? {},
    ...(options.file ? { file: options.file } : {}),
  });
  return { configs, secrets, kv };
}

async function configError(promise: Promise<unknown>): Promise<PluginConfigError> {
  const error = await promise.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(PluginConfigError);
  return error as PluginConfigError;
}

describe('createPluginConfigs: precedência', () => {
  it('env > arquivo > overrides > default, campo a campo', async () => {
    const { configs } = await setup({
      overrides: { sticker: { a: 'override', b: 'override', c: 'override' } },
      file: { sticker: { a: 'file', b: 'file' } },
      env: { ZAPFORGE_STICKER__A: 'env' },
    });
    const { config } = await configs.resolve('sticker');
    expect(config).toEqual({ a: 'env', b: 'file', c: 'override', d: 'default', quality: 80 });
  });

  it('converte o texto do env para o tipo do campo', async () => {
    const { configs } = await setup({ env: { ZAPFORGE_STICKER__QUALITY: '55' } });
    expect((await configs.resolve('sticker')).config).toMatchObject({ quality: 55 });
  });

  it('mescla objetos aninhados entre camadas', async () => {
    const nested = plugin('nested', {
      config: z.object({ db: z.object({ host: z.string(), port: z.number() }) }),
    });
    const { configs } = await setup({
      plugins: [nested],
      file: { nested: { db: { host: 'arquivo', port: 1 } } },
      env: { ZAPFORGE_NESTED__DB__PORT: '5432' },
    });
    expect((await configs.resolve('nested')).config).toEqual({
      db: { host: 'arquivo', port: 5432 },
    });
  });

  it('plugin sem config: config undefined; campo dado é erro', async () => {
    const bare = plugin('bare');
    const ok = await setup({ plugins: [bare] });
    expect(await ok.configs.resolve('bare')).toEqual({ config: undefined, messages: {} });

    const bad = await setup({ plugins: [bare], file: { bare: { x: 1 } } });
    const error = await configError(bad.configs.resolve('bare'));
    expect(error.issues).toEqual([expect.objectContaining({ path: 'x', source: 'file' })]);
  });
});

describe('createPluginConfigs: erros de validação', () => {
  it('lista todos os problemas com plugin, campo e fonte', async () => {
    const { configs } = await setup({
      overrides: { sticker: { b: 3 } },
      file: { sticker: { quality: 500 } },
      env: { ZAPFORGE_STICKER__A: 'ok', ZAPFORGE_AI__API_KEY: 'curta' },
    });
    const error = await configError(configs.resolve('sticker'));
    expect(error.plugin).toBe('sticker');
    expect(error.issues).toEqual([
      expect.objectContaining({ path: 'b', source: 'override' }),
      expect.objectContaining({ path: 'quality', source: 'file' }),
    ]);
    expect(error.message).toContain('config inválida do plugin "sticker"');
    expect(error.message).toContain('quality: ');
    expect(error.message).toContain('fonte: arquivo pluginConfig["sticker"].quality');

    const envError = await configError(configs.resolve('ai'));
    expect(envError.issues).toEqual([
      expect.objectContaining({ path: 'apiKey', source: 'env', env: 'ZAPFORGE_AI__API_KEY' }),
    ]);
    expect(envError.message).toContain('fonte: env ZAPFORGE_AI__API_KEY');
  });

  it('campo obrigatório ausente aponta que não há default', async () => {
    const { configs } = await setup();
    const error = await configError(configs.resolve('ai'));
    expect(error.issues).toEqual([expect.objectContaining({ path: 'apiKey', source: 'default' })]);
    expect(error.message).toContain('ausente, sem default no schema');
  });

  it('a mensagem de erro não contém o valor rejeitado (pode ser secreto)', async () => {
    const { configs } = await setup({ env: { ZAPFORGE_AI__API_KEY: 'qxzw' } });
    const error = await configError(configs.resolve('ai'));
    expect(error.message).not.toContain('qxzw');
    expect(JSON.stringify(error.issues)).not.toContain('qxzw');
  });

  it('entrada que não é objeto é erro da fonte', async () => {
    const { configs } = await setup({ file: { sticker: 'x' as unknown as JsonObject } });
    const error = await configError(configs.resolve('sticker'));
    expect(error.issues).toEqual([expect.objectContaining({ path: '', source: 'file' })]);
  });

  it('schema que não é objeto ou que usa "messages" é erro do autor do plugin', async () => {
    const scalar = plugin('scalar', { config: z.string() });
    const clash = plugin('clash', { config: z.object({ messages: z.string() }) });
    const { configs } = await setup({ plugins: [scalar, clash] });
    await expect(configs.resolve('scalar')).rejects.toThrow(/deve ser um z.object/);
    await expect(configs.resolve('clash')).rejects.toThrow(/"messages" é reservado/);
  });

  it('plugin desconhecido lança RangeError', async () => {
    const { configs } = await setup();
    await expect(configs.resolve('nada')).rejects.toThrow(RangeError);
  });

  it('avisa quando o arquivo cita plugin inexistente', () => {
    const raw: string[] = [];
    const destination: LogDestination = { write: (line) => raw.push(line) };
    createPluginConfigs({
      plugins: [sticker],
      storage: createMemoryStorage(),
      env: {},
      file: { stiker: {} },
      log: createLogger({ destination }),
    });
    expect(raw.join('')).toContain('pluginConfig cita \\"stiker\\"');
  });
});

describe('createPluginConfigs: messages (ADR 0025)', () => {
  it('sobrescreve chaves de messages com a mesma precedência dos campos', async () => {
    const { configs } = await setup({
      overrides: { sticker: { messages: { needMedia: 'override', done: 'override' } } },
      file: { sticker: { messages: { needMedia: 'arquivo' } } },
      env: { ZAPFORGE_STICKER__MESSAGES__DONE: 'env' },
    });
    const { messages, config } = await configs.resolve('sticker');
    expect(messages).toEqual({ needMedia: 'arquivo', done: 'env' });
    expect(Object.isFrozen(messages)).toBe(true);
    // `messages` não vaza para a config validada.
    expect(config).not.toHaveProperty('messages');
  });

  it('sem sobrescrita, devolve as do manifesto', async () => {
    const { configs } = await setup();
    expect((await configs.resolve('sticker')).messages).toEqual(sticker.messages);
  });

  it('chave desconhecida ou valor que não é texto é erro claro', async () => {
    const { configs } = await setup({
      file: { sticker: { messages: { needMedai: 'typo', done: 3 } } },
    });
    const error = await configError(configs.resolve('sticker'));
    expect(error.issues).toEqual([
      expect.objectContaining({ path: 'messages.needMedai', source: 'file' }),
      expect.objectContaining({ path: 'messages.done', source: 'file' }),
    ]);
    expect(error.message).toContain('mensagem desconhecida; o plugin declara "needMedia", "done"');
  });
});

describe('createPluginConfigs: secrets', () => {
  const env = { ZAPFORGE_AI__API_KEY: 'sk-secreta-123' };

  it('describe mascara campos secretos, inclusive aninhados', async () => {
    const { configs } = await setup({ env, file: { ai: { openai: { token: 'tok-abc' } } } });
    const view = await configs.describe('ai');
    expect(view.config).toEqual({
      model: 'flash',
      apiKey: SECRET_MASK,
      openai: { token: SECRET_MASK },
    });
    expect(JSON.stringify(view)).not.toMatch(/sk-secreta-123|tok-abc/);
  });

  it('resolve registra os segredos no SecretSet, e o logger nunca os escreve', async () => {
    const { configs, secrets } = await setup({
      env,
      file: { ai: { openai: { token: 'tok-abc' } } },
    });
    const raw: string[] = [];
    const log = createLogger({ destination: { write: (line) => raw.push(line) }, secrets });

    const { config } = await configs.resolve('ai');
    expect(config).toMatchObject({ apiKey: 'sk-secreta-123' });
    expect(secrets.values()).toEqual(expect.arrayContaining(['sk-secreta-123', 'tok-abc']));

    log.info('config', { config });
    log.error('falhou sk-secreta-123', { err: new Error('token tok-abc recusado') });
    expect(raw.join('')).not.toMatch(/sk-secreta-123|tok-abc/);
  });

  it('JSON Schema marca secretos e não expõe default secreto', async () => {
    const withDefault = plugin('def', {
      config: z.object({ key: secret(z.string()).default('padrão-secreto'), n: z.number() }),
    });
    const { configs } = await setup({ plugins: [withDefault, ai] });
    const schema = configs.jsonSchema('ai') as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(schema.properties['apiKey']).toMatchObject({
      type: 'string',
      secret: true,
      writeOnly: true,
    });
    expect(schema.properties['model']).toMatchObject({ default: 'flash' });
    expect(schema.properties['model']).not.toHaveProperty('secret');
    expect(schema.required).toEqual(['apiKey']);

    const other = JSON.stringify(configs.jsonSchema('def'));
    expect(other).not.toContain('padrão-secreto');
    expect(other).toContain(SECRET_MASK);
  });

  it('jsonSchema é undefined para plugin sem config', async () => {
    const { configs } = await setup({ plugins: [plugin('bare')] });
    expect(configs.jsonSchema('bare')).toBeUndefined();
  });
});

describe('createPluginConfigs: setOverrides', () => {
  it('valida antes de salvar: inválido rejeita e não grava', async () => {
    const { configs, kv } = await setup({ overrides: { sticker: { quality: 10 } } });
    const error = await configError(configs.setOverrides('sticker', { quality: 0 }));
    expect(error.issues).toEqual([
      expect.objectContaining({ path: 'quality', source: 'override' }),
    ]);
    expect(await kv.get('sticker')).toEqual({ quality: 10 });
  });

  it('válido grava, e {} remove os overrides', async () => {
    const { configs, kv } = await setup();
    expect(await configs.setOverrides('sticker', { quality: 20 })).toBeUndefined();
    expect(await kv.get('sticker')).toEqual({ quality: 20 });
    expect((await configs.resolve('sticker')).config).toMatchObject({ quality: 20 });

    await configs.setOverrides('sticker', {});
    expect(await kv.get('sticker')).toBeUndefined();
    expect((await configs.resolve('sticker')).config).toMatchObject({ quality: 80 });
  });

  it('override perde para arquivo e env mesmo depois de salvo', async () => {
    const { configs } = await setup({ file: { sticker: { quality: 30 } } });
    await configs.setOverrides('sticker', { quality: 20, d: 'override' });
    expect((await configs.resolve('sticker')).config).toMatchObject({
      quality: 30,
      d: 'override',
    });
  });

  it('override com segredo rejeita, não grava e não mexe no SecretSet', async () => {
    const { configs, secrets, kv } = await setup();
    const before = secrets.values();
    const error = await configError(configs.setOverrides('ai', { apiKey: 'nova-chave-1' }));
    expect(error.issues).toEqual([expect.objectContaining({ path: 'apiKey', source: 'override' })]);
    expect(await kv.get('ai')).toBeUndefined();
    expect(secrets.values()).toEqual(before);
    expect(secrets.values()).not.toContain('nova-chave-1');
  });
});

describe('createPluginConfigs: segredos fora do override', () => {
  const env = { ZAPFORGE_AI__API_KEY: 'sk-secreta-123' };

  it('rejeita segredo raso e aninhado, aponta env e arquivo, e nada é gravado', async () => {
    const { configs, kv } = await setup({ env, overrides: { ai: { model: 'pro' } } });
    const error = await configError(
      configs.setOverrides('ai', {
        model: 'ultra',
        apiKey: 'sk-override-1',
        openai: { token: 'tok-override' },
      }),
    );
    expect(error.issues).toEqual([
      expect.objectContaining({ path: 'apiKey', source: 'override' }),
      expect.objectContaining({ path: 'openai.token', source: 'override' }),
    ]);
    expect(error.message).toContain('campo secreto não pode ser definido por override');
    expect(error.message).toContain('ZAPFORGE_AI__API_KEY');
    expect(error.message).toContain('ZAPFORGE_AI__OPENAI__TOKEN');
    expect(error.message).toContain('pluginConfig["ai"].openai.token');
    expect(error.message).not.toMatch(/sk-override-1|tok-override/);
    expect(await kv.get('ai')).toEqual({ model: 'pro' });
    expect((await configs.resolve('ai')).config).toMatchObject({ model: 'pro' });
  });

  it('override só de campo comum continua gravando e recarregando', async () => {
    const reloaded: string[] = [];
    const storage = createMemoryStorage();
    const configs = createPluginConfigs({
      plugins: [ai],
      storage,
      env,
      reload: async (name) => {
        reloaded.push(name);
        return {
          entry: { name, version: '1.0.0', origin: 'config', status: 'loaded' },
          errors: [],
        };
      },
    });
    await configs.setOverrides('ai', { model: 'pro', openai: {} });
    expect(reloaded).toEqual(['ai']);
    expect(await kernelStorage(storage, 'config').kv.get('ai')).toEqual({
      model: 'pro',
      openai: {},
    });
    expect((await configs.resolve('ai')).config).toMatchObject({
      model: 'pro',
      apiKey: 'sk-secreta-123',
    });
  });

  it('override legado com segredo é ignorado com aviso, sem logar o valor', async () => {
    const storage = createMemoryStorage();
    await kernelStorage(storage, 'config').kv.set('ai', {
      model: 'pro',
      apiKey: 'sk-legado-777',
      openai: { token: 'tok-legado-888' },
    });
    const raw: string[] = [];
    const configs = createPluginConfigs({
      plugins: [ai],
      storage,
      env,
      log: createLogger({ destination: { write: (line) => raw.push(line) } }),
    });

    const { config } = await configs.resolve('ai');
    // O campo comum do override vale; os secretos saem de env (apiKey) ou ficam ausentes.
    expect(config).toEqual({ model: 'pro', apiKey: 'sk-secreta-123', openai: {} });
    await configs.resolve('ai');

    const output = raw.join('');
    expect(output).not.toMatch(/sk-legado-777|tok-legado-888/);
    expect(output).toContain('campo secreto \\"apiKey\\", ignorado');
    expect(output).toContain('campo secreto \\"openai.token\\", ignorado');
    // Um aviso por campo, não um por resolve.
    expect(raw).toHaveLength(2);
  });

  it('JSON Schema marca segredos como não editáveis por override', async () => {
    const { configs } = await setup();
    const schema = configs.jsonSchema('ai') as {
      properties: Record<
        string,
        Record<string, unknown> & { properties?: Record<string, Record<string, unknown>> }
      >;
    };
    expect(schema.properties['apiKey']).toMatchObject({ 'x-zapforge-override': false });
    expect(schema.properties['openai']?.properties?.['token']).toMatchObject({
      secret: true,
      'x-zapforge-override': false,
    });
    expect(schema.properties['model']).not.toHaveProperty('x-zapforge-override');
  });
});

describe('segredo curto demais para a censura do log', () => {
  it('avisa uma vez por campo, sem o valor', async () => {
    const log = recordingLogger();
    const configs = createPluginConfigs({
      plugins: [
        plugin('pin', { config: z.object({ pin: secret(z.string()), ok: secret(z.string()) }) }),
      ],
      storage: createMemoryStorage(),
      env: {},
      file: { pin: { pin: '123', ok: 'longo-o-bastante' } },
      log,
    });
    await configs.resolve('pin');
    await configs.resolve('pin');

    const warns = log.lines.filter((line) => line.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]?.fields).toMatchObject({ plugin: 'pin', field: 'pin' });
    expect(JSON.stringify(warns)).not.toContain('123');
  });
});

describe('erros do autor no schema (ADR 0032)', () => {
  const resolveOf = (definition: PluginDefinition): Promise<unknown> =>
    createPluginConfigs({
      plugins: [definition],
      storage: createMemoryStorage(),
      env: {},
    }).resolve(definition.name);

  it('secret() dentro de array, record ou union é recusado com o caminho', async () => {
    const definition = plugin('contas', {
      config: z.object({
        accounts: z.array(z.object({ token: secret(z.string()) })).default([]),
        porChat: z.record(z.string(), secret(z.string())).optional(),
        auth: z.union([z.object({ key: secret(z.string()) }), z.string()]).optional(),
      }),
    });
    const error: unknown = await resolveOf(definition).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('"accounts[*].token"');
    expect((error as Error).message).toContain('"porChat[*]"');
    expect((error as Error).message).toContain('"auth[*].key"');
  });

  it('secret() em campo de objeto (qualquer nível) e com array como valor é aceito', async () => {
    const definition = plugin('ok', {
      config: z.object({
        db: z
          .object({ password: secret(z.string()).default('padrão-x') })
          .default({ password: 'padrão-x' }),
        tokens: secret(z.array(z.string())).default([]),
        nome: z.string().min(1).default('bot'),
      }),
    });
    await expect(resolveOf(definition)).resolves.toBeDefined();
  });

  it('dois campos que geram a mesma variável de ambiente são recusados', async () => {
    const definition = plugin('ia', {
      config: z.object({ openAIKey: z.string().optional(), openAiKey: z.string().optional() }),
      messages: { okDone: 'a', ok_done: 'b' },
    });
    const error: unknown = await resolveOf(definition).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('ZAPFORGE_IA__OPEN_AI_KEY (openAIKey, openAiKey)');
    expect((error as Error).message).toContain(
      'ZAPFORGE_IA__MESSAGES__OK_DONE (messages.okDone, messages.ok_done)',
    );
  });
});
