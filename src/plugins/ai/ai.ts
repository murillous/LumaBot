import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { BotConfigError, definePlugin, type PluginDefinition, secret } from '@usebridger/core';
import {
  APICallError,
  type FinishReason,
  generateText,
  isStepCount,
  jsonSchema,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
  tool,
} from 'ai';
import { z } from 'zod';
import {
  type AiTool,
  type AiToolContext,
  type AiToolResult,
  invokeTool,
  offeredTools,
} from '#plugins/ai-tools.ts';

/** Um modelo que o provider oferece, para o catálogo do dashboard. */
export interface AiModelInfo {
  readonly id: string;
  /** Aceita áudio na entrada (a transcrição precisa). */
  readonly audio?: boolean;
  /** Tem a busca nativa do provider. */
  readonly nativeSearch?: boolean;
}

/** Fonte de modelos. Provider novo é um plugin que contribui em `ai.providers`, sem editar o `ai`. */
export interface AiProvider {
  /** Prefixo do item da cadeia: `google` em `google:gemini-2.5-flash`. */
  readonly name: string;
  languageModel(modelId: string): LanguageModel;
  /** Nome para exibição no catálogo; sem ele, vale o `name`. */
  readonly label?: string;
  /** Modelos conhecidos, só para o catálogo: um `provider:modelo` fora da lista continua valendo. */
  readonly models?: readonly AiModelInfo[];
  /** Faixa de `temperature` do provider (varia: o Gemini vai a 2, o Claude a 1). */
  readonly temperature?: { readonly min: number; readonly max: number };
  /**
   * A busca na internet que o próprio provider executa (o Google Grounding do Gemini), se ele
   * tiver. O `ai` a oferece quando a chamada pede `nativeSearch`.
   */
  nativeSearch?(): ToolSet;
}

/** Resultados possíveis de uma tentativa; fonte única do tipo e do schema do `/status`. */
export const ATTEMPT_OUTCOMES = [
  'ok',
  'transient',
  'error',
  'aborted',
  'unregistered',
  'unsupported',
] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

/** Uma tentativa num item da cadeia, para quem mede (`ai.observers`). */
export interface AiAttempt {
  /** Item da cadeia, como `google:gemini-2.5-flash`. */
  readonly model: string;
  readonly provider: string;
  readonly purpose: string;
  /** Ordem da tentativa nesta chamada: 0 respondeu de primeira; acima disso, foi fallback. */
  readonly position: number;
  /**
   * `transient` passou para o próximo; `error` relançou; `aborted` foi o `signal` de quem chamou;
   * `unregistered` é item sem provider no ponto e `unsupported` é item cujo provider não tem a
   * busca nativa pedida; os dois são pulados sem chamada.
   */
  readonly outcome: AttemptOutcome;
  readonly startedAt: number;
  readonly latencyMs: number;
  /** Só com `ok`. Vazão sai daqui: `outputTokens / latencyMs`. */
  readonly usage?: LanguageModelUsage;
  readonly finishReason?: FinishReason;
  /** HTTP do provider, quando a falha veio dele. */
  readonly statusCode?: number;
}

/**
 * Recebe cada tentativa. Roda sem ser esperado: agregar não atrasa a resposta, e a falha de um
 * observer só vai para o log.
 */
export type AiObserver = (attempt: AiAttempt) => void | Promise<void>;

/** Item da cadeia: o modelo (`provider:modelo`) e os parâmetros dele. */
export interface ModelChainItem {
  readonly model: string;
  readonly temperature?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
}

export interface GenerateRequest {
  /** Quem chamou (`luma`, `resumo`...): separa o consumo por funcionalidade nas métricas. */
  readonly purpose: string;
  readonly instructions?: string;
  readonly messages: readonly ModelMessage[];
  readonly signal?: AbortSignal;
  /**
   * Cadeia só para esta chamada, no formato da config. Serve à finalidade que precisa de um
   * modelo diferente do principal (a transcrição pede entrada de áudio, que o DeepSeek não tem).
   * Tem o mesmo fallback, cooldown, prazo e observers; vazia ou ausente, vale a cadeia principal.
   */
  readonly models?: readonly ModelChainItem[];
  /**
   * Responde com a busca nativa do provider (Google Grounding): só os itens da cadeia cujo
   * provider a tem são tentados, os outros são pulados com um aviso, porque responder sem buscar
   * seria inventar.
   */
  readonly nativeSearch?: boolean;
  /**
   * Oferece ao modelo as tools do ponto `ai.tools` que o transport atende e roda as que ele
   * chamar com este contexto (a mensagem que originou a conversa). Sem ele, a chamada é só texto:
   * transcrição, resumo e persona não oferecem tool.
   */
  readonly toolContext?: AiToolContext;
}

/** Uma tool que o modelo chamou, com o que ela devolveu a ele. */
export interface ToolCallRecord {
  readonly name: string;
  readonly args: unknown;
  readonly result: AiToolResult;
}

export interface GenerateResult {
  readonly text: string;
  /** O item da cadeia que respondeu, como `google:gemini-2.5-flash`. */
  readonly model: string;
  readonly usage: LanguageModelUsage;
  /** As tools chamadas nesta resposta, na ordem; vazio sem `toolContext`. */
  readonly toolCalls: readonly ToolCallRecord[];
}

export interface AiService {
  /**
   * Gera texto percorrendo a cadeia. Só erro transitório (429, 5xx, rede, timeout) passa para o
   * próximo modelo; o resto relança na hora, porque se repetiria no próximo.
   */
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

/** Nenhum modelo da cadeia está disponível (o último erro transitório vai no `cause`). */
export class AiUnavailableError extends Error {
  override readonly name = 'AiUnavailableError';
}

declare module '@usebridger/core' {
  interface Services {
    ai: AiService;
  }
  interface ExtensionPoints {
    /** Providers de modelo, por nome; o primeiro com o nome vence. */
    'ai.providers': AiProvider;
    /** Quem mede o consumo (métricas, exportador); o `ai` só emite. */
    'ai.observers': AiObserver;
  }
}

/** Embutidos: o `ai` os contribui pelo próprio ponto, só os que têm chave. */
const BUILT_IN = {
  google: (apiKey: string) => createGoogle({ apiKey }),
  openai: (apiKey: string) => createOpenAI({ apiKey }),
  anthropic: (apiKey: string) => createAnthropic({ apiKey }),
  deepseek: (apiKey: string) => createDeepSeek({ apiKey }),
};
type BuiltIn = keyof typeof BUILT_IN;
const BUILT_IN_NAMES = Object.keys(BUILT_IN) as BuiltIn[];

type ProviderInfo = Pick<AiProvider, 'label' | 'models' | 'temperature'>;
/** Descrição dos embutidos: o catálogo os lista mesmo sem chave, para a tela pedir a chave. */
const BUILT_IN_INFO: Record<BuiltIn, Required<ProviderInfo>> = {
  google: {
    label: 'Google',
    temperature: { min: 0, max: 2 },
    models: [
      { id: 'gemini-2.5-flash', audio: true, nativeSearch: true },
      { id: 'gemini-2.5-flash-lite', audio: true, nativeSearch: true },
      { id: 'gemini-2.5-pro', audio: true, nativeSearch: true },
    ],
  },
  openai: {
    label: 'OpenAI',
    temperature: { min: 0, max: 2 },
    models: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }],
  },
  anthropic: {
    label: 'Anthropic',
    temperature: { min: 0, max: 1 },
    models: [{ id: 'claude-haiku-5-5' }, { id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }],
  },
  deepseek: {
    label: 'DeepSeek',
    temperature: { min: 0, max: 2 },
    models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
  },
};

const keyState = z.enum(['configured', 'env', 'missing']);
const catalogResponse = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      key: keyState,
      temperature: z.object({ min: z.number(), max: z.number() }).optional(),
      models: z.array(z.object({ id: z.string(), audio: z.boolean(), nativeSearch: z.boolean() })),
    }),
  ),
});
const statusResponse = z.object({
  models: z.array(
    z.object({
      model: z.string(),
      state: z.enum(['ready', 'cooldown', 'unregistered']),
      until: z.string().optional(),
      lastOutcome: z.enum(ATTEMPT_OUTCOMES).optional(),
      lastAt: z.string().optional(),
    }),
  ),
});

/**
 * Item da cadeia, na config e por chamada: o mesmo schema nos dois lugares, porque o `models` do
 * `generate` é fronteira entre plugins e não pode aceitar o que a config recusaria.
 */
export const chainItem: z.ZodType<ModelChainItem, ModelChainItem> = z.object({
  model: z.string().regex(/^[a-z0-9-]+:.+$/, 'use provider:modelo'),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

const config = z.object({
  /**
   * Cadeia de fallback em ordem, misturando providers. Cada item tem os próprios parâmetros,
   * porque a escala muda entre providers (`temperature` vai a 2 no Gemini e a 1 no Claude).
   */
  models: z.array(chainItem).default([]),
  /** Chaves dos providers embutidos; provider de outro plugin traz a própria config. */
  keys: z
    .object(
      Object.fromEntries(BUILT_IN_NAMES.map((p) => [p, secret(z.string().min(1)).optional()])) as {
        [P in BuiltIn]: z.ZodOptional<z.ZodString>;
      },
    )
    .default({}),
  /** Por tentativa: um modelo travado não segura a cadeia. */
  timeoutMs: z.number().int().positive().default(60_000),
  /** Quanto tempo um modelo que respondeu 429 vai para o fim da cadeia. */
  cooldownMs: z.number().int().nonnegative().default(60_000),
  /** Passos do modelo numa resposta com tools: chamar, ler o resultado e responder são dois. */
  maxToolSteps: z.number().int().min(1).default(5),
});

/** Erro que pode não se repetir no próximo modelo. O abort de quem chamou não entra aqui. */
function isTransient(err: unknown): boolean {
  if (APICallError.isInstance(err)) return err.isRetryable;
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

/** Gera texto por uma cadeia de modelos com fallback entre providers; provê `ai`. */
export const ai: PluginDefinition = definePlugin({
  name: 'ai',
  version: '0.1.0',
  engine: '<1.0.0',
  config,
  setup: (ctx) => {
    const { models: chain, keys, timeoutMs, cooldownMs, maxToolSteps } = ctx.config;
    // Visão viva: provider de plugin que carrega depois do `ai` aparece no próximo uso.
    const providers = ctx.services.extensionPoint('ai.providers');
    for (const name of BUILT_IN_NAMES) {
      const key = keys[name];
      if (key) {
        const provider = BUILT_IN[name](key);
        ctx.services.contribute('ai.providers', {
          name,
          ...BUILT_IN_INFO[name],
          languageModel: (id) => provider.languageModel(id),
          // Só o Gemini traz a busca pronta; os outros providers entram sem ela.
          ...(name === 'google' && {
            nativeSearch: () => ({
              google_search: (provider as ReturnType<typeof createGoogle>).tools.googleSearch({}),
            }),
          }),
        });
      }
    }
    // Modelo → fim do cooldown. Em memória: um restart zera, o que só custa uma tentativa.
    const coolingUntil = new Map<string, number>();

    // Sem cadeia o boot segue (config inválida derrubaria o bot inteiro) e o `generate` recusa.
    if (chain.length === 0) {
      ctx.log.warn('nenhum modelo em models: a IA vai recusar até ser configurada');
    }

    const toolPoint = ctx.services.extensionPoint('ai.tools');
    // As tools do SDK saem do `ai.tools` a cada chamada (visão viva) e só com as capabilities do
    // transport. O SDK não valida os argumentos: quem valida é o `invokeTool`, que devolve
    // `invalid-args` ao modelo em vez de abortar a resposta.
    const sdkTools = (
      toolCtx: AiToolContext,
      calls: ToolCallRecord[],
      onEffect: () => void,
    ): ToolSet => {
      const entries = offeredTools(toolPoint.list(), ctx.capabilities).map(
        (t: AiTool) =>
          [
            t.name,
            tool({
              description: t.description,
              inputSchema: jsonSchema<unknown>(z.toJSONSchema(t.args, { io: 'input' }) as never),
              execute: async (args: unknown) => {
                // Marca antes do await: se o timeout estourar no meio da tool, ela pode ter feito
                // o efeito e o próximo modelo a repetiria. Tool só de leitura não conta.
                if (t.sideEffects !== false) onEffect();
                const result = await invokeTool(t, args, toolCtx);
                calls.push({ name: t.name, args, result });
                return result;
              },
            }),
          ] as const,
      );
      return Object.fromEntries(entries);
    };

    const observers = ctx.services.extensionPoint('ai.observers');
    // Última tentativa por modelo, do mesmo ponto que alimenta os observers; zera no restart.
    const lastAttempt = new Map<string, { outcome: AiAttempt['outcome']; at: number }>();
    const notify = (attempt: AiAttempt) => {
      lastAttempt.set(attempt.model, { outcome: attempt.outcome, at: attempt.startedAt });
      for (const observer of observers.list()) {
        const failed = (err: unknown) =>
          ctx.log.error('observer da IA falhou', { model: attempt.model, err });
        try {
          observer(attempt)?.catch(failed);
        } catch (err) {
          failed(err);
        }
      }
    };

    // `env` pede a fonte de cada campo da config, que só o `ctx.admin` (adminPlugins) expõe; sem
    // ele, a chave presente conta como `configured`.
    const keySources = async (): Promise<Record<string, string>> => {
      try {
        return (await ctx.admin?.config.describe('ai'))?.sources ?? {};
      } catch (err) {
        ctx.log.warn('não foi possível ler a fonte das chaves da IA', { err });
        return {};
      }
    };

    // Sem http no bot, `api` lança BotConfigError: o `ai` segue sem as rotas.
    try {
      ctx.http.api({
        method: 'GET',
        path: '/catalog',
        summary: 'Provedores e modelos que dá para escolher na cadeia, com o estado da chave',
        tags: ['ai'],
        permission: 'config.read',
        response: catalogResponse,
        handler: async () => {
          const sources = await keySources();
          const byName = new Map<string, AiProvider>();
          for (const p of providers.list()) if (!byName.has(p.name)) byName.set(p.name, p);
          const names = [...new Set([...BUILT_IN_NAMES, ...byName.keys()])];
          return {
            providers: names.map((id) => {
              const registered = byName.get(id);
              const info: ProviderInfo | undefined = registered ?? BUILT_IN_INFO[id as BuiltIn];
              const key = !registered
                ? 'missing'
                : sources[`keys.${id}`] === 'env'
                  ? 'env'
                  : 'configured';
              return {
                id,
                name: info?.label ?? id,
                key,
                ...(info?.temperature && { temperature: info.temperature }),
                models: (info?.models ?? []).map((m) => ({
                  id: m.id,
                  audio: m.audio ?? false,
                  nativeSearch: m.nativeSearch ?? false,
                })),
              };
            }),
          };
        },
      });
      ctx.http.api({
        method: 'GET',
        path: '/status',
        summary: 'Estado de cada modelo: da cadeia principal, ou dos listados em ?models=a,b',
        tags: ['ai'],
        permission: 'config.read',
        query: z.object({ models: z.string().optional() }),
        response: statusResponse,
        handler: ({ query }) => {
          const now = Date.now();
          const names = new Set(providers.list().map((p) => p.name));
          const wanted: string[] = query.models
            ? query.models.split(',').filter(Boolean)
            : chain.map((m) => m.model);
          return {
            models: wanted.map((model) => {
              const until = coolingUntil.get(model) ?? 0;
              const last = lastAttempt.get(model);
              // Sem `:` não há provider (indexOf -1 cortaria o último caractere do nome).
              const sep = model.indexOf(':');
              const state =
                sep < 0 || !names.has(model.slice(0, sep))
                  ? 'unregistered'
                  : until > now
                    ? 'cooldown'
                    : 'ready';
              return {
                model,
                state,
                ...(state === 'cooldown' && { until: new Date(until).toISOString() }),
                ...(last && {
                  lastOutcome: last.outcome,
                  lastAt: new Date(last.at).toISOString(),
                }),
              };
            }),
          };
        },
      });
    } catch (err) {
      if (!(err instanceof BotConfigError)) throw err;
      ctx.log.info('sem http no bot: rotas do ai desligadas');
    }

    ctx.services.provide('ai', {
      async generate(request) {
        const now = Date.now();
        // Cadeia da chamada, validada como a da config; o cooldown abaixo é por modelo e vale
        // para todas as cadeias, então um 429 numa finalidade poupa o modelo nas outras.
        const active = request.models?.length ? z.array(chainItem).parse(request.models) : chain;
        // Em cooldown vai para o fim, não sai: com todos em 429, ainda vale tentar.
        const cooling = (m: { model: string }) => (coolingUntil.get(m.model) ?? 0) > now;
        const order = [...active.filter((m) => !cooling(m)), ...active.filter(cooling)];
        const registered = providers.list();

        let lastError: unknown;
        for (const [position, entry] of order.entries()) {
          const sep = entry.model.indexOf(':');
          const name = entry.model.slice(0, sep);
          const provider = registered.find((p) => p.name === name);
          const started = Date.now();
          const attempt = (
            outcome: AiAttempt['outcome'],
            extra: Pick<AiAttempt, 'usage' | 'finishReason' | 'statusCode'> = {},
          ) =>
            notify({
              model: entry.model,
              provider: name,
              purpose: request.purpose,
              position,
              outcome,
              startedAt: started,
              latencyMs: Date.now() - started,
              ...extra,
            });
          if (!provider) {
            // Erro de config, não do modelo: os outros itens ainda podem responder.
            ctx.log.error('provider não registrado (falta a chave ou o plugin)', {
              model: entry.model,
            });
            attempt('unregistered');
            continue;
          }
          const search = request.nativeSearch ? provider.nativeSearch?.() : undefined;
          if (request.nativeSearch && !search) {
            ctx.log.warn('provider sem busca nativa; item pulado', { model: entry.model });
            // Vira métrica para a causa de uma cadeia de busca mal configurada não sumir.
            attempt('unsupported');
            continue;
          }
          // Por tentativa: o que uma tentativa que falhou já executou não pode se repetir na próxima.
          const calls: ToolCallRecord[] = [];
          let effectStarted = false;
          const tools: ToolSet = {
            ...search,
            ...(request.toolContext
              ? sdkTools(request.toolContext, calls, () => {
                  effectStarted = true;
                })
              : {}),
          };
          const hasTools = Object.keys(tools).length > 0;
          try {
            const result = await generateText({
              model: provider.languageModel(entry.model.slice(sep + 1)),
              ...(hasTools ? { tools, stopWhen: isStepCount(maxToolSteps) } : {}),
              ...(request.instructions === undefined ? {} : { instructions: request.instructions }),
              messages: [...request.messages],
              ...(entry.temperature === undefined ? {} : { temperature: entry.temperature }),
              ...(entry.maxOutputTokens === undefined
                ? {}
                : { maxOutputTokens: entry.maxOutputTokens }),
              // O fallback é a cadeia; o retry do SDK repetiria o mesmo modelo em rate limit.
              maxRetries: 0,
              timeout: timeoutMs,
              ...(request.signal ? { abortSignal: request.signal } : {}),
            });
            coolingUntil.delete(entry.model);
            // `totalUsage` soma os passos: com tools (M5-1.4), uma chamada tem vários.
            const usage = result.totalUsage;
            attempt('ok', { usage, finishReason: result.finishReason });
            ctx.log.info('ia respondeu', {
              model: entry.model,
              purpose: request.purpose,
              ms: Date.now() - started,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
            });
            // Com tools, o texto final é o do último passo; se ele veio vazio, vale o dos anteriores.
            const text =
              result.text ||
              result.steps
                .map((step) => step.text.trim())
                .filter(Boolean)
                .join('\n');
            return { text, model: entry.model, usage, toolCalls: calls };
          } catch (err) {
            const statusCode = APICallError.isInstance(err) ? err.statusCode : undefined;
            const extra = statusCode === undefined ? {} : { statusCode };
            if (request.signal?.aborted) {
              attempt('aborted', extra);
              throw err;
            }
            if (!isTransient(err)) {
              attempt('error', extra);
              throw err;
            }
            // Tool com efeito (lembrete, figurinha) já iniciou: tentar o próximo modelo a repetiria.
            if (effectStarted) {
              attempt('error', extra);
              throw err;
            }
            attempt('transient', extra);
            if (statusCode === 429) {
              coolingUntil.set(entry.model, Date.now() + cooldownMs);
            }
            ctx.log.warn('modelo falhou, tentando o próximo', { model: entry.model, err });
            lastError = err;
          }
        }
        throw new AiUnavailableError('nenhum modelo da cadeia respondeu', { cause: lastError });
      },
    });
  },
});
