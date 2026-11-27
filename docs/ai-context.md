# ai-context

O contexto de conversa da IA: a **transcrição** de cada chat com IDs, o **orçamento** com resumo
rolante, a **memória longa** em blocos e as tools que leem tudo isso pelo ID. Não decide quando
responder nem quem o bot é: isso é de quem usa o serviço `aiContext`. Hoje é a
[`luma`](luma.md); qualquer outro bot sobre o Bridger usa do mesmo jeito.

Depende do [`ai`](ai.md) (`dependsOn: { ai }`): o resumo, o `view_media` e o `listen_audio` chamam o `generate`.
Código em `src/plugins/ai-context/`: `ai-context.ts` (plugin e serviço), `transcript.ts`,
`context.ts` (orçamento e resumo), `memory.ts`, `media.ts` (`view_media`), `listen-audio.ts` (`listen_audio`), `read-pdf.ts`
(`read_pdf`) e `prompt.ts` (as seções do sistema e as mensagens).

## Config mínima

Um provider ([ai-providers.md](ai-providers.md)), a cadeia do `ai` e o `ai-context` com os
padrões:

```jsonc
{
  "ai-google": { "key": "..." },
  "ai": { "models": [{ "model": "google:gemini-2.5-flash" }] },
  "ai-context": {}
}
```

## Exemplo mínimo

Um bot que não é a Luma: um assistente que responde em privado com a transcrição, o resumo, a
memória e a mídia por ID. Além dos plugins de IA, só um plugin de poucas linhas, que decide
quando responder e quem o bot é (`src/plugins/ai-context/example.ts`):

```ts
import { createBot, definePlugin } from '@usebridger/core';

const assistente = definePlugin({
  name: 'assistente',
  version: '0.1.0',
  engine: '<1.0.0',
  dependsOn: { 'ai-context': '^0.1.0' },
  setup: (ctx) => {
    ctx.events.on('message', async (e) => {
      if (e.message.chat.isGroup) return;
      await ctx.services.get('aiContext').respond({
        message: e.message,
        reply: e.reply,
        signal: e.signal,
        log: e.log,
        instructions: '# Quem você é
Você é um assistente prestativo e direto.',
      });
    });
  },
});

const bot = createBot({
  transport, // o transport da plataforma (baileys, telegram...)
  plugins: [ai, aiDeepseek, aiContext, assistente],
  pluginConfig: {
    'ai-deepseek': { key: '...' },
    ai: { models: [{ model: 'deepseek:deepseek-flash' }] },
    'ai-context': { name: 'Assistente' },
  },
});
await bot.start();
```

O `example.test.ts` sobe essa composição com a mesma config e um modelo falso no lugar do
DeepSeek: responde em privado, lendo a fala na transcrição, e fica quieto em grupo.

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `models` | `[]` | Cadeia do resumo e das tools (o resumo grande da `read_pdf`). Vazio usa a principal do `ai` |
| `visionModels` | `[]` | Cadeia que enxerga: `view_media` e PDF escaneado. Vazio: `view_media` usa `models`, e o PDF escaneado volta `no-text` |
| `audioModels` | `[]` | Cadeia que ouve, para o `listen_audio`. Vazio usa `models` |
| `maxAudioBytes` | `15728640` | Áudio maior que isso o `listen_audio` não manda ao modelo |
| `history.maxMessages` / `history.maxAgeMs` | `80` / `7200000` | Falas guardadas por chat e por quanto tempo cada uma fica |
| `history.maxTokens` | `3000` | Tokens estimados da transcrição que vão ao modelo; passando disso, as falas velhas viram resumo |
| `memory.enabled` | `true` | Desligada, o sistema fica sem a seção de memória e o bot sem `remember` e `forget` |
| `memory.blockChars` / `memory.maxAgeDays` | `500` / `180` | Tamanho de cada bloco da memória longa e dias de um fato sem ser lembrado |
| `name` | — | Nome do bot no resumo e na transcrição. Sem ele, vale o que quem chama passa (a Luma passa `Luma`), senão o nome da sessão |
| `timeZone` | `America/Sao_Paulo` | Fuso em que o bot lê a data e a hora |
| `locale` | `pt-BR` | Locale das datas e horas que o modelo lê (`terça-feira, 17/11/2026`, `16:30`) |
| `disabledTools` | `[]` | Tools do contexto que o bot não deve ter: `read_messages`, `view_media`, `listen_audio`, `read_pdf`, `remember`, `forget`, `clear_history` |

## `messages`

Todo texto que o contexto manda ao modelo é `messages` do plugin (`src/plugins/ai-context/texts.ts`),
e a config troca qualquer um: outro idioma, outro tom, outra plataforma. O padrão é PT-BR e não cita
plataforma nem o nome de bot nenhum. `{nome}` é preenchido na hora.

| Grupo | Chaves |
| --- | --- |
| Transcrição | `mediaSticker`, `mediaImage`, `mediaVideo`, `mediaAudio`, `mediaDocument`, `cutMark`, `summaryLabel`, `todayLine` (`{date}`), `replyTo` (`{ref}`), `replyToSelf` (`{excerpt}`), `replyToSelfEmpty`, `unknownSender` |
| Sistema | `readingGuide` (`{name}`, `{cutMark}`), `memoryGuide`, `memoryHeader`, `memoryChat`, `memoryPerson` (`{name}`) |
| Resumo | `compactInstructions` (`{name}`, `{maxChars}`), `compactPrevious` (`{summary}`), `compactNone`, `compactNew` (`{lines}`) |
| `view_media` | `viewInstructions`, `viewLabel` (`{id}`, `{kind}`), `question` (`{question}`) |
| `listen_audio` | `listenInstructions`; o rótulo e a pergunta são os do `view_media` (`viewLabel`, `question`) |
| `read_pdf` | `pdfSummarize`, `pdfReadScanned`, `pdfAskPages`, `pdfHeader`, `pdfPage`, `pdfEmptyPage`, `pdfScanned`, `pdfPageCount`, `pdfNoteTruncated`, `pdfNoteSummarized` |
| Tools | `toolReadMessages`, `toolReadMessagesIds`, `toolViewMedia`, `toolViewMediaIds`, `toolViewMediaQuestion`, `toolReadPdf`, `toolReadPdfIds`, `toolReadPdfPages`, `toolReadPdfQuestion`, `toolRemember`, `toolRememberFact`, `toolForget`, `toolForgetFact`, `toolPerson`, `toolClearHistory` |

Um bot em inglês, só com config:

```jsonc
"ai-context": {
  "name": "Echo",
  "locale": "en-US",
  "messages": {
    "mediaSticker": "sticker",
    "todayLine": "[today is {date}]",
    "readingGuide": "# How to read the chat\n1. ... never write \"{name}:\" in your reply. ...",
    "...": "..."
  }
}
```

O formato da transcrição (`[#m12 16:30] Nome: fala`, a marca `➜`) é estrutura, não texto: fica
igual em todo idioma, e o guia de leitura o explica.

Por ambiente, `BRIDGER_AI_CONTEXT__HISTORY__MAX_TOKENS=4000` e assim por diante.

## Serviço `aiContext`

O caminho curto: o `respond` monta o contexto, gera, responde no chat e grava a resposta.

```ts
ctx.events.on('message', async (e) => {
  if (!quero(e)) return;
  await ctx.services.get('aiContext').respond({
    message: e.message, reply: e.reply, signal: e.signal, log: e.log,
    instructions: '# Quem você é\nVocê é o Eco, assistente do grupo.',
    name: 'Eco',        // opcional: como o bot aparece na transcrição (padrão: o nome da sessão)
    purpose: 'eco',     // opcional: separa o consumo nas métricas (padrão: ai-context)
    models,             // opcional: cadeia desta resposta
    text,               // opcional: o texto da fala, se não for o da mensagem
  });
});
```

O sistema fica `instructions` + o guia de leitura da transcrição + a memória do chat. As tools do
ponto `ai.tools` vão junto.

Quem precisa de mais controle (balões, persona, "digitando") monta com as peças, como a Luma:

```ts
observe(message, text?)     // grava a fala (uma vez só) e devolve { prior, current }
image(message, log)         // a imagem ou figurinha (da mensagem ou da citada), até 8 MB
build({ message, observed, signal, log, models?, name? })
                            // { turns, summary?, memory, header?, today }: a transcrição no
                            // orçamento (compactando, se preciso) e a memória longa
record(chatId, { text, name }, platformIds)   // grava a fala do bot, com o ID de cada balão
forget(chatId)              // esquece a conversa; a memória longa fica
clear(chatId)               // esquece a conversa e a memória longa
media(chatId, id)           // { found: true, type, media } | { found: false, reason: 'unknown' | 'no-media' | 'view-once' }
conversations()             // chats com conversa viva
importMemory(docs)          // fatos de memória vindos de outro plugin; pula o que o bloco já tem
guide(name, memory)         // { reading, memory }: as seções do sistema com os textos da config;
                            // memory é '' com a memória desligada
speech                      // { texts, locale }: para as mensagens falarem como o contexto
timeZone
```

`prompt.ts` exporta as peças puras do prompt, todas com os textos padrão se não receberem o
`speech`: `readingGuide(name)` (como ler a transcrição), `memoryGuide(memory?)` (a seção da
memória, com os blocos no fim) e `contextMessages(...)` (o resumo, a transcrição e a fala de agora
com a imagem).

## Ponto `ai-context.observers`

Avisado quando uma tool do contexto termina, sem o conteúdo (nem o texto do PDF, nem os fatos):

```ts
ctx.services.contribute('ai-context.observers', ({ tool, outcome, message, log }) => { ... });
// tool: 'read_pdf'; outcome: 'ok' | 'refused' | 'error'
```

O [`usage`](usage.md) conta a leitura de PDF por aqui. Observer que lança vai para o log
(`ai-context.observer.failed`) e a tool segue.

## Ponto `ai-context.names`

O nome de quem fala na transcrição. O `ai-context` não conhece quem guarda apelidos: quem sabe
contribui uma função, e vale a primeira do ponto.

```ts
ctx.services.contribute('ai-context.names', (contactId) => apelidos.nome(contactId));
```

Sem ninguém no ponto, vale o nome do perfil (`contact.name`), e sem ele o `unknownSender` das
`messages`. Se a função lança, o erro vai para o log (`ai-context.name.failed`) e vale o do
perfil. Na Luma, quem contribui é o [`user-names`](user-names.md), com o `displayName`.

O `ai-context` grava sozinho toda mensagem que chega (menos a de outro bot), responda alguém a ela
ou não. Quem responde chama `observe` também, para esperar a gravação: a mesma mensagem nunca entra
duas vezes. A fala do próprio bot entra pelo `record` (ou pelo `respond`), porque o kernel não
avisa o texto do que foi enviado.

## Transcrição

Uma **transcrição por chat**: tudo o que se disse nele, inclusive as falas do bot. Em grupo, a
conversa é uma só, para o bot saber quem disse o quê e o que ele mesmo respondeu a cada pessoa. O
privado continua isolado: um chat, uma conversa.

- Cada fala ganha um **ID curto** (`#m12`) e vai ao modelo como `[#m12 16:30] Ana: fala`. As falas
  seguidas das pessoas viram um turno `user`; as do bot, um turno `assistant` só com o texto.
- A fala de agora é a última, marcada com `➜`.
- A **mídia** aparece como marca (`[figurinha]`, `[imagem]`, `[áudio]`, `[vídeo]`,
  `[documento: contrato.pdf]`). Só a imagem da fala de agora (ou da citada) vai ao modelo de fato.
- A **citação** de uma fala que ainda está na transcrição vira o ID (`(respondendo #m9)`). Citar
  uma fala do bot mostra um trecho do que ele disse (`(respondendo à sua fala "...")`).
- Guarda as últimas `history.maxMessages` falas do chat, e cada fala sai depois de
  `history.maxAgeMs`.
- Tudo em **memória**, sem timer: a expiração é feita na leitura. Um restart esquece as conversas.

## Prompt cacheável e orçamento

O provider guarda em cache o começo do prompt que se repete entre chamadas (o DeepSeek, o Gemini e
a OpenAI fazem isso sozinhos). Para valer, nada que muda a cada turno vai no sistema:

- o dia de hoje vai numa linha `[hoje é terça-feira, 17/11/2026]` antes da fala de agora (a hora já
  está no cabeçalho dela);
- a imagem vai anexada à fala de agora;
- o resumo da conversa vai como primeira fala.

A transcrição que vai ao modelo cabe em `history.maxTokens`, estimados em 3 caracteres por token.
A transcrição em si não muda: o que sai do prompt continua achável pelo ID.

1. **Nível 1, sem modelo.** Fora das 10 falas mais recentes, o texto de uma pessoa com mais de 400
   caracteres vira um trecho terminado em `…[cortado]`. O bot lê o texto inteiro pela tool
   `read_messages`.
2. **Nível 2, com modelo.** Passando do orçamento, as falas mais velhas viram um **resumo
   rolante** (quem, assuntos em aberto, combinados, piadas internas), que cita os IDs. Ele dobra
   falas até o resto ocupar metade do orçamento, então não roda a cada turno. Usa a cadeia do
   `build` (`models`) ou a do `ai-context` (`purpose: ai-context.compact`), no uso de quem fez o
   bot responder. Vive enquanto a fala mais nova que ele cobre viveria. `forget` e `clear` o
   apagam junto.
3. Se o resumo falha (`ai-context.compact.failed`), a resposta segue só com as falas mais recentes
   que cabem no orçamento.

## Memória longa

A transcrição some em horas; fatos duráveis ("o João é corintiano", "a Bia não gosta de ser
chamada de Bianca") ficam em **blocos** no storage (coleção `memory`), no estilo da core memory do
Letta.

- Cada chat tem um bloco **do chat** (combinados, piadas internas) e um bloco **por pessoa** que
  fala nele. Tudo é por chat: o que alguém conta no privado nunca aparece no grupo, nem o
  contrário.
- Cada bloco tem até `memory.blockChars` caracteres. Cheio, o `remember` recusa com os fatos que
  ele tem, e o bot esquece algum antes.
- Os blocos entram no **fim da instrução de sistema** (`# O que você lembra deste chat`): o do chat
  e os de quem está na transcrição ou fala agora, em ordem fixa. Mudam só quando o bot lembra ou
  esquece, ou quando alguém com bloco entra na conversa, então o começo do prompt segue em cache.
- O próprio bot edita os blocos pelas tools `remember` e `forget`. A pessoa é achada pelo nome:
  quem falou nas últimas horas ou quem já tem bloco no chat.
- **Retenção:** um fato sai depois de `memory.maxAgeDays` dias sem ser lembrado de novo; lembrar o
  mesmo fato renova o prazo. A expiração é feita na leitura, sem timer.
- Se o storage falha na leitura (`ai-context.memory.failed`), a resposta segue sem a memória.

## Mídia anterior, pelo ID

- Cada mídia da transcrição guarda de onde baixar depois, sem a mensagem: com a capability
  `media.ref`, a referência do kernel (`ctx.media.ref`), que o transport baixa de novo pelo
  `ctx.media.fromRef`; sem ela, a própria `Media`, em memória, pelo mesmo prazo da fala. Mídia de
  visualização única não é guardada. A referência pode conter a chave do arquivo: nunca vai para
  log nem para o modelo.
- `view_media` manda as imagens à cadeia de visão (`visionModels`, ou `models`) numa chamada à
  parte (`purpose: ai-context.view`, no uso de quem pediu) e devolve só o texto. O modelo da
  conversa pode não ter visão, e a imagem não pesa nos passos seguintes. Mídia que saiu da
  plataforma (`MediaExpiredError`) volta como `expired`.
- `listen_audio` faz o mesmo com áudios e mensagens de voz: manda-os à cadeia de áudio
  (`audioModels`, ou `models`) numa chamada à parte (`purpose: ai-context.listen`) e devolve o
  que foi dito. Nem todo modelo ouve áudio (o DeepSeek não ouve): com a cadeia principal sem
  áudio, configure `audioModels` com um que ouça (o Gemini). Áudio acima de `maxAudioBytes`
  (15 MB) volta `too-large` sem ir ao modelo. O áudio da mensagem atual continua com o
  [`transcribe_audio`](transcribe.md#tool-da-ia).
- Outras tools usam a mídia pelo serviço (`media(chatId, id)`): o
  [`edit_sticker`](sticker-edit.md#tool-da-ia) junta figurinhas anteriores por ID.

## PDF

A `read_pdf` tira o texto do PDF localmente, pelo PDF.js ([`unpdf`](https://github.com/unjs/unpdf)),
sem custo de IA.

- Até **30 mil caracteres**, o texto vai cru ao modelo, com um cabeçalho por PDF
  (`--- #m4 contrato.pdf, p. 1-12 de 12 ---`) e `[p. N]` antes de cada página.
- Acima disso, uma chamada à parte (`purpose: ai-context.pdf`, cadeia `models`) resume e responde
  à `question`, lendo no máximo 200 mil caracteres. O resultado traz o total de páginas, e o bot
  pede um trecho por `pages`.
- **PDF escaneado** (nenhuma página com texto) vai como arquivo `application/pdf` à cadeia
  `visionModels`, que precisa aceitar PDF (o Gemini aceita). Sem `visionModels`, volta `no-text`.
- PDF de até **20 MB**; PDF com senha volta `encrypted`, e arquivo corrompido, `invalid`.
- O texto **não é guardado**: a cada pergunta o bot lê de novo pelo ID. As chamadas à parte entram
  no uso de quem pediu (`actor`), e a tool registra `pdf`/`read` no [`usage`](usage.md), se ele
  estiver carregado.

## Tools da IA

Contribuídas ao ponto `ai.tools` ([ai-tools.md](ai-tools.md)).

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `clear_history` | — | Apaga a transcrição e a memória longa do chat (em grupo, a de todos) | — |
| `remember` | `fact` (até 200), `person?` | Guarda o fato no bloco da pessoa (pelo nome) ou, sem `person`, no do chat. Fato repetido renova o prazo | `unknown-person` (com o nome), `full` (com os fatos do bloco em `detail`) |
| `forget` | `fact?`, `person?` | Apaga do bloco os fatos que contêm `fact` (sem acento nem caixa); sem `fact`, o bloco inteiro | `unknown-person`, `not-found` (com os fatos do bloco em `detail`) |
| `read_messages` | `ids` (1 a 10, `#m12`) | Devolve o texto inteiro de falas anteriores do chat pelo ID (a cortada no nível 1, a citada no resumo). Só leitura | `unknown` (com o ID em `detail`) |
| `view_media` | `ids` (1 a 4, `#m12`), `question?` | Olha imagens ou figurinhas anteriores do chat pelo ID e devolve a descrição. Só leitura | `unknown`, `no-media`, `view-once`, `not-image`, `too-large`, `expired` (com o ID em `detail`) |
| `listen_audio` | `ids` (1 a 4, `#m12`), `question?` | Ouve áudios ou mensagens de voz anteriores do chat pelo ID e devolve o que foi dito (`transcript`). Só leitura | `unknown`, `no-media`, `view-once`, `not-audio`, `too-large`, `expired` (com o ID em `detail`) |
| `read_pdf` | `ids?` (até 4, `#m12`), `pages?` (`"3-7"`, `"5"`, `"10-"`), `question?` | Lê PDFs do chat e devolve o texto por página; sem `ids`, o da mensagem e o da citada. Só leitura ([PDF](#pdf)) | `no-pdf`, `unknown`, `no-media`, `view-once`, `not-pdf`, `too-large`, `expired`, `encrypted`, `invalid`, `invalid-pages` (com o total de páginas), `no-text` (com o ID em `detail`) |

## Auditoria

Registra no log de auditoria do kernel (`ctx.audit`) só o ato, nunca a conversa:

| Ação | Quando | `details` |
| --- | --- | --- |
| `ai-context.history.clear` | A tool `clear_history`; alvo = chat | — (quem pediu é o ator `contact` do evento) |
| `ai-context.memory.remember` / `.forget` | A tool `remember` guardou ou a `forget` apagou um fato; alvo = chat | `block` (`chat` ou `person`), nunca o fato nem de quem é |

Em conversa privada, o alvo vai pseudonimizado.

## Uso opcional de outros plugins

O `ai-context` não importa nem chama nenhum plugin do app: os outros entram pelos pontos dele. O
[`user-names`](user-names.md) dá o nome de quem fala pelo [`ai-context.names`](#ponto-ai-contextnames),
e o [`usage`](usage.md) registra a leitura de PDF pelo
[`ai-context.observers`](#ponto-ai-contextobservers). Sem eles, o contexto funciona igual, com o
nome do perfil e sem contar uso.
