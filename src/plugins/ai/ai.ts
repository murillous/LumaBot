import { BotConfigError, definePlugin, type PluginDefinition, secret } from '@usebridger/core';
import {
  APICallError,
  type FinishReason,
  generateText,
  type ImageModel,
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
} from '#plugins/ai/tools.ts';
import {
  GENERATE_DONE,
  HTTP_DISABLED,
  KEYS_UNREADABLE,
  MODEL_FAILED,
  MODELS_EMPTY,
  OBSERVER_FAILED,
  PROVIDER_UNREGISTERED,
  SEARCH_UNSUPPORTED,
} from './log-events.ts';

/** Um modelo que o provider oferece, para o catálogo do dashboard. */
export interface AiModelInfo {
  readonly id: string;
  /** Aceita áudio na entrada (a transcrição precisa). */
  readonly audio?: boolean;
  /** Tem a busca nativa do provider. */
  readonly nativeSearch?: boolean;
}

/** Onde o provider guarda a chave, para a tela da IA pedir e gravar. */
export interface AiProviderKey {
  /** Plugin dono da config: `ai-google`. */
  readonly plugin: string;
  /** Campo secreto na config dele: `key`. */
  readonly path: string;
  /** Sem chave, o provider só aparece no catálogo: a cadeia o pula como não registrado. */
  readonly configured: boolean;
}

/** Fonte de modelos. Provider novo é um plugin que contribui em `ai.providers`, sem editar o `ai`. */
export interface AiProvider {
  /** Prefixo do item da cadeia: `google` em `google:gemini-2.5-flash`. */
  readonly name: string;
  languageModel(modelId: string): LanguageModel;
  /**
   * Modelo que gera e edita imagem (`google:gemini-2.5-flash-image`), se o provider tiver. Quem
   * edita imagem (`image-edit`) percorre a própria cadeia por aqui, com a chave já guardada no `ai`.
   */
  imageModel?(modelId: string): ImageModel;
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
  /**
   * A chave do provider, se ele tiver uma que a tela da IA edita. Sem `key`, o provider conta
   * como configurado (a config dele, se houver, é editada na tela do plugin).
   */
  readonly key?: AiProviderKey;
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

const PASS_ON: ReadonlySet<AttemptOutcome> = new Set(['transient', 'unregistered', 'unsupported']);

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
  /** O `actor` do `generate`, quando quem chamou informou. */
  readonly actor?: AiActor;
  /** Última tentativa desta chamada: depois dela, o `generate` devolveu ou lançou. */
  readonly last: boolean;
}

/** Quem pediu a resposta: o `personId` e o chat. Vai para o `usage`, nunca para rótulo. */
export interface AiActor {
  readonly id: string;
  readonly chatId: string;
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
  /** Quem pediu a resposta, repassado em cada `AiAttempt` para o custo entrar no uso dela. */
  readonly actor?: AiActor;
}

/** Uma tool que o modelo chamou, com o que ela devolveu a ele. */
export interface ToolCallRecord {
  readonly name: string;
  readonly args: unknown;
  readonly result: AiToolResult;
}

/** Página que a busca nativa do provider (Google Grounding) usou para responder. */
export interface WebSource {
  readonly url: string;
  readonly title?: string;
}

export interface GenerateResult {
  readonly text: string;
  /** O item da cadeia que respondeu, como `google:gemini-2.5-flash`. */
  readonly model: string;
  readonly usage: LanguageModelUsage;
  /** As tools chamadas nesta resposta, na ordem; vazio sem `toolContext`. */
  readonly toolCalls: readonly ToolCallRecord[];
  /** Fontes da busca nativa, sem repetir URL; vazio sem `nativeSearch` ou se o provider não as dá. */
  readonly sources: readonly WebSource[];
}

export interface AiService {
  /**
   * Gera texto percorrendo a cadeia. Só erro transitório (429, 5xx, rede, timeout) passa para o
   * próximo modelo; o resto relança na hora, porque se repetiria no próximo.
   */
  generate(request: GenerateRequest): Promise<GenerateResult>;
  /**
   * @deprecated Chave salva em `ai.keys.<provider>` antes de os providers virarem plugins. O
   * plugin do provider a usa quando a própria `key` está vazia; sai quando o Bridger migrar
   * segredo entre plugins (usebridger#345).
   */
  legacyKey(provider: string): string | undefined;
}

// O `ai` não exporta o tipo da fonte; ele sai do retorno do `generateText`.
type Source = Awaited<ReturnType<typeof generateText>>['sources'][number];

/** As fontes de URL, na ordem e sem repetir; as de documento não viram link. */
function webSources(sources: readonly Source[]): WebSource[] {
  const seen = new Map<string, WebSource>();
  for (const s of sources) {
    if (s.sourceType !== 'url' || seen.has(s.url)) continue;
    seen.set(s.url, s.title ? { url: s.url, title: s.title } : { url: s.url });
  }
  return [...seen.values()];
}

/** Nenhum modelo da cadeia está disponível (o último erro transitório vai no `cause`). */
export class AiUnavailableError extends Error {
  override readonly name = 'AiUnavailableError';
}

/**
 * O filtro de conteúdo do provider recusou a entrada ou o que o modelo gerou. Convenção do ponto
 * `ai.providers` para modelos de imagem: o provider lança `APICallError` com `data.flagged`, e
 * quem chama separa a recusa da falha (tentar de novo não muda nada; o usuário precisa saber).
 */
export function isContentFlagged(err: unknown): boolean {
  return (
    APICallError.isInstance(err) &&
    typeof err.data === 'object' &&
    err.data !== null &&
    (err.data as { flagged?: unknown }).flagged === true
  );
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

/**
 * Obsoleto: os providers que o `ai` embutia e cujas chaves ficavam em `keys`. O campo continua no
 * schema só para as chaves já salvas pelo dashboard (cifradas em nome do `ai`) seguirem valendo:
 * o kernel não move segredo entre plugins, então só o `ai` consegue lê-las.
 */
const LEGACY_KEYS = ['google', 'openai', 'anthropic', 'deepseek'] as const;
type LegacyKey = (typeof LEGACY_KEYS)[number];

const keyState = z.enum(['configured', 'env', 'missing']);
const catalogResponse = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      key: keyState,
      /** Onde gravar a chave; sem ele, a chave (se houver) é da config do plugin do provider. */
      keyField: z.object({ plugin: z.string(), path: z.string() }).optional(),
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
  /** Obsoleto: a chave fica na config do plugin do provider (`ai-google.key`). */
  keys: z
    .object(
      Object.fromEntries(LEGACY_KEYS.map((p) => [p, secret(z.string().min(1)).optional()])) as {
        [P in LegacyKey]: z.ZodOptional<z.ZodString>;
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
    // Provider sem chave fica no ponto só para o catálogo pedir a chave; a cadeia não o vê.
    const usable = (p: AiProvider) => p.key?.configured !== false;
    // Modelo → fim do cooldown. Em memória: um restart zera, o que só custa uma tentativa.
    const coolingUntil = new Map<string, number>();

    // Sem cadeia o boot segue (config inválida derrubaria o bot inteiro) e o `generate` recusa.
    if (chain.length === 0) {
      ctx.log.event(MODELS_EMPTY);
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
          ctx.log.event(OBSERVER_FAILED, { model: attempt.model, err });
        try {
          observer(attempt)?.catch(failed);
        } catch (err) {
          failed(err);
        }
      }
    };

    // `env` pede a fonte de cada campo da config, que só o `ctx.admin` (adminPlugins) expõe; sem
    // ele, a chave presente conta como `configured`.
    const keySources = async (plugin: string): Promise<Record<string, string>> => {
      try {
        return (await ctx.admin?.config.describe(plugin))?.sources ?? {};
      } catch (err) {
        ctx.log.event(KEYS_UNREADABLE, { plugin, err });
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
          const byName = new Map<string, AiProvider>();
          for (const p of providers.list()) if (!byName.has(p.name)) byName.set(p.name, p);
          return {
            providers: await Promise.all(
              [...byName.values()].map(async (p) => {
                const field = p.key;
                const key = !field
                  ? 'configured'
                  : !field.configured
                    ? 'missing'
                    : (await keySources(field.plugin))[field.path] === 'env'
                      ? 'env'
                      : 'configured';
                return {
                  id: p.name,
                  name: p.label ?? p.name,
                  key,
                  ...(field && { keyField: { plugin: field.plugin, path: field.path } }),
                  ...(p.temperature && { temperature: p.temperature }),
                  models: (p.models ?? []).map((m) => ({
                    id: m.id,
                    audio: m.audio ?? false,
                    nativeSearch: m.nativeSearch ?? false,
                  })),
                };
              }),
            ),
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
          const names = new Set(
            providers
              .list()
              .filter(usable)
              .map((p) => p.name),
          );
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
      ctx.log.event(HTTP_DISABLED);
    }

    ctx.services.provide('ai', {
      // `hasOwn`: um nome como `constructor` não pode devolver o que vem do protótipo.
      legacyKey: (provider) =>
        Object.hasOwn(keys, provider) ? keys[provider as LegacyKey] : undefined,
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
          // O primeiro com o nome vence; se ele está sem chave, o item conta como não registrado.
          const found = registered.find((p) => p.name === name);
          const provider = found && usable(found) ? found : undefined;
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
              ...(request.actor && { actor: request.actor }),
              // Só `transient`, `unregistered` e `unsupported` seguem para o próximo item.
              last: !PASS_ON.has(outcome) || position === order.length - 1,
            });
          if (!provider) {
            // Erro de config, não do modelo: os outros itens ainda podem responder.
            ctx.log.event(PROVIDER_UNREGISTERED, {
              model: entry.model,
            });
            attempt('unregistered');
            continue;
          }
          const search = request.nativeSearch ? provider.nativeSearch?.() : undefined;
          if (request.nativeSearch && !search) {
            ctx.log.event(SEARCH_UNSUPPORTED, { model: entry.model });
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
            ctx.log.event(GENERATE_DONE, {
              model: entry.model,
              purpose: request.purpose,
              durationMs: Date.now() - started,
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
            return {
              text,
              model: entry.model,
              usage,
              toolCalls: calls,
              sources: webSources(result.steps.flatMap((step) => step.sources)),
            };
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
            ctx.log.event(MODEL_FAILED, { model: entry.model, err });
            lastError = err;
          }
        }
        throw new AiUnavailableError('nenhum modelo da cadeia respondeu', { cause: lastError });
      },
    });
  },
});
