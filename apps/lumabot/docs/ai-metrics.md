# ai-metrics

Consumo, vazão e custo por modelo da cadeia do [`ai`](ai.md). Código em
`src/plugins/ai-metrics/`: `ai-metrics.ts` (plugin) e `summary.ts` (as contas, puras).

O `ai-metrics` **não agrega nem persiste**: contribui um observer ao ponto `ai.observers` (o `ai`
não muda) que traduz cada tentativa para o serviço `metrics` do `@usebridger/plugin-metrics`. A
agregação diária, a retenção de 90 dias e o `GET /metrics` do Prometheus (Grafana) são dele, e as
métricas da IA saem pelo mesmo caminho das do kernel. O app carrega o `metrics` no `main.ts`; para
expor o `/metrics`, o bot precisa da opção `http`. O plugin depende do `metrics`.

## Métricas

Rótulos de baixa cardinalidade: `model`, `provider`, `purpose`, `outcome`, `position` (`first` ou
`fallback`), `statusCode`, `kind`, `reason`. **Nunca** texto de conversa nem id de chat ou de
pessoa. Os nomes seguem o Prometheus (`_total` no contador, unidade no nome); o `summary` devolve a
latência em ms. O histórico gravado antes do `plugin-metrics` 0.3 (nomes `ai.*`) não é lido.

| Métrica | Tipo | Rótulos | Quando |
| --- | --- | --- | --- |
| `ai_attempts_total` | contador | `model`, `provider`, `purpose`, `outcome`, `position`, `statusCode?` | Toda tentativa da cadeia |
| `ai_latency_seconds` | histograma (0,25 s a 60 s) | `model`, `purpose` | Tentativa que respondeu |
| `ai_tokens_total` | contador | `model`, `purpose`, `kind` (`input`, `output`, `cache_read`, `reasoning`) | Tentativa que respondeu |
| `ai_finish_total` | contador | `model`, `purpose`, `reason` | Tentativa que respondeu |

## Serviço `aiMetrics`

```ts
summary({ days = 7, model?, purpose? }): Promise<AiSummary>
```

`AiSummary` traz `total`, `models[]`, `purposes[]` e `days[]` (respostas e custo por dia). Cada
`Stats`:

| Campo | O que é |
| --- | --- |
| `attempts`, `responses`, `successRate` | Tentativas, respostas e `responses / (attempts - unregistered - unsupported)` |
| `firstTry`, `savedByFallback` | Respostas de primeira e respostas que o fallback salvou |
| `outcomes`, `statusCodes` | Contagem por desfecho e por HTTP da falha (`429` em destaque) |
| `latencyMs` | `avg`, `p50` e `p95` (percentil = limite superior do balde) |
| `outputTokensPerSecond` | Tokens de saída por segundo de latência, das respostas |
| `tokens`, `avgInputTokens`, `avgOutputTokens`, `cacheHitRate` | Tokens e médias por resposta |
| `finishReasons` | `length` (resposta cortada), `content-filter` (recusa), `stop`... |
| `costUsd`, `unpricedModels` | Custo estimado e os modelos que ficaram de fora dele |

O período é em **UTC** (o `timeZone` padrão do `metrics`), com o dia de hoje incluído, e cabe na
retenção diária do `metrics` (90 dias). O que ainda não foi gravado no storage entra
pela memória do `metrics`.

## Custo

Em **US$ por 1 milhão de tokens**, calculado na consulta e nunca gravado: mudar a tabela vale
também para o histórico. A tabela é mantida à mão na config (não há fonte confiável para puxar):

```sh
BRIDGER_AI_METRICS__PRICES='{"google:gemini-2.5-flash":{"inputPerMillion":0.3,"outputPerMillion":2.5,"cachedInputPerMillion":0.075}}'
```

Entrada sem cache custa `inputPerMillion`; a lida do cache, `cachedInputPerMillion` (sem ele, vale
como entrada comum); a saída, `outputPerMillion` (o reasoning já está na saída). **Modelo sem preço
aparece sem custo** (`costUsd: null` por modelo; no total, fica de fora da soma e é listado em
`unpricedModels`), nunca como zero. Preço `0` é preço.

## Config

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `prices` | `{}` | `provider:modelo` → `{ inputPerMillion, outputPerMillion, cachedInputPerMillion? }` |

## Fora do escopo

Qualidade da resposta (👍/👎 do usuário), tabela de preços automática e TTFT (o `ai` usa
`generateText`, sem stream). O dashboard (M5-4) consome o `aiMetrics.summary` e a seção genérica do
`metrics`.
