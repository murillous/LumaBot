# ai

Gera texto por uma cadeia de modelos com fallback entre providers, pelo
[Vercel AI SDK](https://ai-sdk.dev).
Oferece o serviço `ai` e os pontos `ai.providers` e `ai.observers`, e roda as tools do ponto
[`ai.tools`](ai-tools.md). O `ai` não tem comando nem gatilho: quem decide quando responder, o
histórico e a persona são da [`luma`](luma.md); `resumo`, `spontaneous`,
`transcribe` e `web-search` chamam o `generate` direto.

## Config

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `models` | `[]` | Cadeia em ordem: `[{ "model": "provider:modelo", "temperature"?, "maxOutputTokens"? }]` |
| `keys.google`, `keys.openai`, `keys.anthropic`, `keys.deepseek` | — | Chave (secreta) de cada provider embutido |
| `timeoutMs` | `60000` | Prazo de cada tentativa |
| `cooldownMs` | `60000` | Tempo que um modelo que respondeu 429 passa no fim da cadeia |
| `maxToolSteps` | `5` | Passos do modelo numa resposta com tools (chamar, ler o resultado e responder são dois) |

Por ambiente:

```sh
BRIDGER_AI__MODELS='[{"model":"google:gemini-2.5-flash","temperature":1.4},{"model":"deepseek:deepseek-chat"}]'
BRIDGER_AI__KEYS__GOOGLE=...
BRIDGER_AI__KEYS__DEEPSEEK=...
```

`temperature` e `maxOutputTokens` ficam no item da cadeia porque a escala muda entre providers: o
Gemini aceita `temperature` até 2, e o Claude, até 1. Sem eles, vale o padrão do provider.

Sem `models`, o bot sobe, o log avisa e o `generate` recusa com `AiUnavailableError`. Item com
formato errado (sem `provider:`) é config inválida e impede o boot.

## Fallback

Cada chamada percorre a cadeia em ordem, com `maxRetries: 0` no SDK: quem tenta de novo é a
cadeia, não o mesmo modelo.

- **Erro transitório** (429, 408, 409, 5xx, falha de rede, timeout): registra `warn` e tenta o
  próximo.
- **Outro erro** (400, chave inválida): relança na hora, porque se repetiria no próximo.
- **429**: o modelo vai para o fim da cadeia por `cooldownMs`. Ele não sai da cadeia, então com
  todos em cooldown a chamada ainda tenta cada um. O cooldown fica em memória e zera no restart.
- **Provider não registrado** (sem chave, ou plugin desligado): registra `error` e pula o item.
- **Abort de quem chamou** (`signal`): relança sem tentar o próximo.
- **Todos falharam**: `AiUnavailableError`, com o último erro em `cause`.

Cada resposta registra `model`, `purpose`, `ms`, `inputTokens` e `outputTokens` no log.

## Serviço `ai`

```ts
const { text, model, usage } = await ctx.services.get('ai').generate({
  purpose: 'resumo',                        // quem chamou: separa o consumo nas métricas
  instructions: 'Você é a Luma.',          // opcional
  messages: [{ role: 'user', content: 'oi' }], // ModelMessage do pacote `ai`
  signal,                                   // opcional
});
```

Quem depende declara `dependsOn: { ai: '^0.1.0' }`.

### Modelo por finalidade (`models`)


Cada finalidade pode usar um modelo diferente do principal sem afetar a cadeia principal. O
`generate` aceita `models` opcional, no mesmo formato da config:

```ts
await ai.generate({
  purpose: 'transcribe',
  messages,
  // Só esta chamada: o DeepSeek, da cadeia principal, não tem entrada de áudio.
  models: [{ model: 'google:gemini-2.5-flash' }],
});
```

- Com `models`, a chamada percorre **só essa cadeia**, com o mesmo fallback, prazo e observers.
  Sem `models`, ou vazio, vale a cadeia principal; quem já chama o `generate` não muda.
- O cooldown é por modelo e compartilhado entre as cadeias: um 429 numa finalidade põe o modelo
  no fim da fila em todas.
- Item sem provider registrado (sem chave, ou plugin desligado) é pulado e notificado como
  `unregistered`, como na cadeia principal. Se nenhum item atender, o `generate` lança
  `AiUnavailableError`.
- O formato é validado a cada chamada (`provider:modelo`, `temperature` de 0 a 2,
  `maxOutputTokens` inteiro positivo), porque é fronteira entre plugins: o `generate` com
  `models` inválido rejeita sem chamar nenhum modelo.
- Cada plugin que chama a IA expõe um campo `models` na própria config e o repassa ao `generate`.
  Vazio usa a cadeia principal; trocar o modelo de uma finalidade é config do plugin dela.

### Tool calling (`toolContext`)

Com `toolContext` (a mensagem que originou a conversa), o `generate` oferece ao modelo as tools do
ponto `ai.tools` que o transport atende (`offeredTools`) e roda cada chamada por `invokeTool`:
argumento inválido volta ao modelo como `invalid-args`, e exceção da tool como `failed`. O
resultado traz `toolCalls` (nome, argumentos e o que a tool devolveu). Sem `toolContext`, a chamada
é só texto.

```ts
const { text, toolCalls } = await ai.generate({
  purpose: 'luma',
  messages,
  toolContext: { message, reply, signal, log },
});
```

- O texto é o do último passo; se veio vazio, o dos passos anteriores.
- **Se o modelo falha depois de uma tool com efeito começar, a cadeia não tenta o próximo
  modelo**: repetir o efeito (um lembrete, uma figurinha) seria pior que devolver o erro. Vale
  desde o início da tool, não só depois dela terminar. Hoje o `generateText` espera a tool
  acabar (o `timeoutMs` pode ser ultrapassado pela duração dela) e a tool não é interrompida pelo
  timeout; a marcação antes do `await` é defensiva, caso o SDK passe a lançar com a tool ainda
  rodando. Tool só de leitura declara `sideEffects: false` (`search_web`,
  `transcribe_audio`, `summarize_chat`, `list_commands`, `get_name`, `ranking`, `chat_info`) e
  não bloqueia; ausente, assume-se que tem efeito.
  Antes de qualquer tool, o fallback é o de sempre.

### Busca nativa (`nativeSearch`)

`generate({ nativeSearch: true })` responde com a busca que o próprio provider executa (o Google
Grounding do Gemini). Só os itens da cadeia cujo provider declara `nativeSearch()` são tentados;
os outros são **pulados** com um aviso e notificados como `unsupported`, porque responder sem buscar seria inventar. Se nenhum
atende, `AiUnavailableError`. O plugin [`web-search`](web-search.md) usa isso como fallback do
Tavily.

## Ponto `ai.providers`

Provider novo (Ollama, OpenRouter...) é um plugin que contribui no ponto, sem editar o `ai`:

```ts
import { createOllama } from 'ollama-ai-provider';

setup(ctx) {
  // dependsOn: { ai: '^0.1.0' }; a config (URL, chave) é do próprio plugin.
  const ollama = createOllama({ baseURL: ctx.config.baseURL });
  ctx.services.contribute('ai.providers', {
    name: 'ollama',
    languageModel: (id) => ollama.languageModel(id),
  });
}
```

Depois disso, `ollama:llama3` passa a valer na cadeia. O provider pode declarar também
`nativeSearch(): ToolSet` (a busca nativa dele); o embutido do Gemini já o faz. Os quatro embutidos entram pelo mesmo
ponto, contribuídos pelo `ai`, só os que têm `keys.<nome>`. Com dois providers de mesmo nome,
vale o primeiro na ordem de carga.

## Ponto `ai.observers`

O `ai` não mede nada: ele chama cada observer a cada tentativa da cadeia, e quem agrega é outro
plugin (o `ai-metrics`, a seguir, para o dashboard e o Grafana). O observer não é esperado, para
agregar não atrasar a resposta. Se ele lançar ou rejeitar, o erro vai só para o log.

```ts
ctx.services.contribute('ai.observers', (attempt) => {
  // attempt: AiAttempt
});
```

| Campo | O que é |
| --- | --- |
| `model`, `provider` | Item da cadeia (`google:gemini-2.5-flash`) e o prefixo dele |
| `purpose` | O `purpose` de quem chamou o `generate` |
| `position` | Ordem da tentativa na chamada: `0` respondeu de primeira; acima disso, foi fallback |
| `outcome` | `ok`, `transient` (foi para o próximo), `error` (relançou), `aborted` (o `signal` de quem chamou), `unregistered` (sem provider, pulado sem chamada) ou `unsupported` (provider sem a busca nativa pedida, pulado sem chamada) |
| `startedAt`, `latencyMs` | Início (epoch ms) e duração da tentativa |
| `usage` | Só com `ok`: tokens de entrada, saída, cache e reasoning, somados entre os passos |
| `finishReason` | Só com `ok`: `length` indica resposta cortada e `content-filter` indica recusa |
| `statusCode` | HTTP do provider, quando a falha veio dele |

Vazão é `outputTokens / latencyMs`, calculada por quem agrega. Cooldown não gera tentativa
própria: o modelo só aparece mais tarde na ordem (`position` maior).

## Testes

Os testes contribuem um provider falso com `MockLanguageModelV4` (`ai/test`) e não fazem
chamada de rede.
