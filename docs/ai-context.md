# ai-context

O contexto de conversa da IA: a **transcrição** de cada chat com IDs, o **orçamento** com resumo
rolante, a **memória longa** em blocos e as tools que leem tudo isso pelo ID. Não decide quando
responder nem quem o bot é: isso é de quem usa o serviço `aiContext`. Hoje é a
[`luma`](luma.md); qualquer outro bot sobre o Bridger usa do mesmo jeito.

Depende do [`ai`](ai.md) (`dependsOn: { ai }`): o resumo e o `view_media` chamam o `generate`.
Código em `src/plugins/ai-context/`: `ai-context.ts` (plugin e serviço), `transcript.ts`,
`context.ts` (orçamento e resumo), `memory.ts`, `media.ts` (`view_media`), `read-pdf.ts`
(`read_pdf`) e `prompt.ts` (as seções do sistema e as mensagens).

## Config mínima

Um provider, a cadeia do `ai` e o `ai-context` com os padrões:

```jsonc
{
  "ai": { "models": [{ "model": "google:gemini-2.5-flash" }], "keys": { "google": "..." } },
  "ai-context": {}
}
```

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `models` | `[]` | Cadeia do resumo e das tools (o resumo grande da `read_pdf`). Vazio usa a principal do `ai` |
| `visionModels` | `[]` | Cadeia que enxerga: `view_media` e PDF escaneado. Vazio: `view_media` usa `models`, e o PDF escaneado volta `no-text` |
| `history.maxMessages` / `history.maxAgeMs` | `80` / `7200000` | Falas guardadas por chat e por quanto tempo cada uma fica |
| `history.maxTokens` | `3000` | Tokens estimados da transcrição que vão ao modelo; passando disso, as falas velhas viram resumo |
| `memory.blockChars` / `memory.maxAgeDays` | `500` / `180` | Tamanho de cada bloco da memória longa e dias de um fato sem ser lembrado |
| `timeZone` | `America/Sao_Paulo` | Fuso em que o bot lê a data e a hora |

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
build({ message, observed, signal, log, models? })
                            // { turns, summary?, memory, header?, today }: a transcrição no
                            // orçamento (compactando, se preciso) e a memória longa
record(chatId, { text, name }, platformIds)   // grava a fala do bot, com o ID de cada balão
forget(chatId)              // esquece a conversa; a memória longa fica
clear(chatId)               // esquece a conversa e a memória longa
media(chatId, id)           // { found: true, type, media } | { found: false, reason: 'unknown' | 'no-media' | 'view-once' }
conversations()             // chats com conversa viva
importMemory(docs)          // fatos de memória vindos de outro plugin; pula o que o bloco já tem
timeZone
```

`prompt.ts` exporta as peças puras do prompt: `READING_GUIDE` (como ler a transcrição),
`memoryGuide(memory?)` (a seção da memória, com os blocos no fim) e `contextMessages(...)` (o
resumo, a transcrição e a fala de agora com a imagem).

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
| `read_pdf` | `ids?` (até 4, `#m12`), `pages?` (`"3-7"`, `"5"`, `"10-"`), `question?` | Lê PDFs do chat e devolve o texto por página; sem `ids`, o da mensagem e o da citada. Só leitura ([PDF](#pdf)) | `no-pdf`, `unknown`, `no-media`, `view-once`, `not-pdf`, `too-large`, `expired`, `encrypted`, `invalid`, `invalid-pages` (com o total de páginas), `no-text` (com o ID em `detail`) |

## Auditoria

Registra no log de auditoria do kernel (`ctx.audit`) só o ato, nunca a conversa:

| Ação | Quando | `details` |
| --- | --- | --- |
| `ai-context.history.clear` | A tool `clear_history`; alvo = chat | — (quem pediu é o ator `contact` do evento) |
| `ai-context.memory.remember` / `.forget` | A tool `remember` guardou ou a `forget` apagou um fato; alvo = chat | `block` (`chat` ou `person`), nunca o fato nem de quem é |

Em conversa privada, o alvo vai pseudonimizado.

## Uso opcional de outros plugins

Sem `dependsOn`, na hora do uso: o [`user-names`](user-names.md) dá o nome de quem fala, e o
[`usage`](usage.md) registra a leitura de PDF.
