# 🧠 Núcleo de Inteligência Artificial (Luma)

A Luma não é "mágica", é pura engenharia de prompt e gerenciamento de estado. O
que faz ela soar natural é **separar com clareza as fontes de contexto** — quem
ela é, o que já rolou na conversa, o que estava sendo dito no grupo e a mensagem
de agora — para o modelo nunca embaralhá-las.

## 🏗️ Engenharia de Prompt

O antigo desenho jogava tudo num único turno de texto (persona + regras +
histórico + contexto de grupo + mensagem atual concatenados num só bloco). O
modelo recebia rótulos textuais forjáveis ("Nome:", "Luma:") com o mesmo
delimitador em todas as fontes — e confundia histórico com mensagem atual.

O desenho atual quebra isso em **duas estruturas nativas do Gemini**:

| Estrutura | O que carrega | Onde é montada |
|-----------|---------------|----------------|
| `systemInstruction` | Quem a Luma é: persona, regras, ferramentas, formato, data/hora e o **contexto ambiente do grupo** | `buildConversationRequest` a partir dos templates de `lumaConfig.js` |
| `contents` | A conversa de verdade: turnos `user`/`model` do histórico + a **mensagem/imagem atual** como último turno `user` | `buildConversationRequest` a partir de `ConversationHistory.getTurns()` |

A montagem vive em `src/core/services/PromptBuilder.js`, na função
`buildConversationRequest`. O consumidor é o `LumaHandler` (`src/handlers/LumaHandler.js`),
que chama `this.aiService.generateContent(contents, systemInstruction)`.

### Inventário das Fontes de Contexto

Estas são as **quatro** fontes de contexto, e cada uma tem um lugar estrutural
distinto — é isso que impede a Luma de tratar o clima do grupo como uma ordem, ou
uma resposta curta ("não sei") como mensagem solta:

```
┌─ (a) systemInstruction ────────────────────────────────────────────────┐
│  persona (context/style/traits)                                         │
│  + [REGRA DE OURO] + [CAPACIDADES] + [FERRAMENTAS]                       │
│  + [COMO LER A CONVERSA]                                                 │
│  + [CONVERSA DO GRUPO — CONTEXTO AMBIENTE]  (só em grupo, quando houver) │
│  + [FORMATO WHATSAPP]                                                    │
│  + Data e hora atual (America/Sao_Paulo)                                 │
│  → NÃO contém histórico nem a mensagem atual.                            │
└─────────────────────────────────────────────────────────────────────────┘
┌─ (b) contents (turnos reais do histórico) ──────────────────────────────┐
│  [ { role:'user',  parts:[{text:"Murilo: me conta uma piada"}] },       │
│    { role:'model', parts:[{text:"o que faz a mulher gritar..."}] },     │
│    { role:'user',  parts:[{text:"Murilo: não sei"}] },                  │
│    { role:'model', parts:[{text:"a faca kkk"}] },                       │
│    ─────────────── (c) MENSAGEM ATUAL = último turno user ───────────── │
│    { role:'user',  parts:[{text:"Murilo: e outra?"}, imageData? ] } ]   │
└─────────────────────────────────────────────────────────────────────────┘
┌─ (d) busca web ─────────────────────────────────────────────────────────┐
│  Interna ao adapter: entra como functionResponse (Gemini) ou como turno  │
│  user extra (OpenAI/DeepSeek). Ver "Motor de Busca na Internet".         │
└─────────────────────────────────────────────────────────────────────────┘
```

**(a) systemInstruction** — montado dos templates `SYSTEM_PROMPT_TEMPLATE` /
`SYSTEM_VISION_PROMPT_TEMPLATE` (`src/config/lumaConfig.js`). O `buildConversationRequest`
substitui os placeholders:

```js
// src/core/services/PromptBuilder.js
const systemInstruction = template
  .replace('{{PERSONALITY_CONTEXT}}', personaConfig.context)
  .replace('{{PERSONALITY_STYLE}}',   personaConfig.style)
  .replace('{{PERSONALITY_TRAITS}}',  traitsStr)   // traits[] → "- item\n- item"
  .replace('{{CURRENT_DATETIME}}',    now)         // toLocaleString pt-BR, America/Sao_Paulo
  .replace('{{GROUP_CONTEXT_PLACEHOLDER}}', groupContextStr);
```

A seção nova **[COMO LER A CONVERSA]** ensina o modelo a usar as estruturas:
os turnos `model` são as falas dele; os turnos `user` chegam rotulados
`"Nome: mensagem"` (o rótulo serve só pra ele saber quem falou — nunca deve ser
escrito de volta na resposta); a **última** mensagem é a que ele responde agora; e
mensagens curtas/vagas são continuação da fala anterior, não mensagem solta.

**(b) contents** — os turnos reais do histórico, com papéis, seguidos da
mensagem atual:

```js
// Turnos do histórico viram papéis reais.
const turns = [...historyTurns];
// A API do Gemini exige começar com 'user'; descarta 'model' órfãos no início
// (ex.: quando a poda do histórico cortou um par pela metade).
while (turns.length && turns[0].role === 'model') turns.shift();

const contents = turns.map(t => ({ role: t.role, parts: [{ text: t.text }] }));

// (c) Mensagem atual: ÚLTIMO turno 'user', com rótulo do autor e imagem se houver.
const currentParts = [{ text: `${senderName}: ${userMessage}` }];
if (imageData) currentParts.push(imageData);
contents.push({ role: 'user', parts: currentParts });
```

**(c) mensagem/imagem atual** — sempre o último turno `user`. Texto no formato
`"senderName: userMessage"`; quando há visão, o `imageData` (`inlineData` base64)
entra como **segunda `part`** do mesmo turno. Não existe mais seção
`[USUÁRIO ATUAL]` separada nem blob concatenado.

**(d) busca web** — não vem do `PromptBuilder`; é resolvida **dentro do adapter**
quando o modelo chama a tool `search_web`. Ver a seção
[Motor de Busca na Internet](#-motor-de-busca-na-internet).

### Templates de Sistema

Existem dois, escolhidos pela presença de `imageData`:

| Template | Quando | Diferença |
|----------|--------|-----------|
| `SYSTEM_PROMPT_TEMPLATE` | Texto puro | Fluxo padrão de conversa |
| `SYSTEM_VISION_PROMPT_TEMPLATE` | Há imagem/sticker | Instrui a reagir à imagem anexada ao último turno "através das lentes da personalidade" |

Ambos carregam identidade, [REGRA DE OURO] (imersão total — nunca revelar que é
IA), [CAPACIDADES E OBRIGAÇÕES], [FERRAMENTAS E AÇÕES], [ESTILO], [TRAÇOS
OBRIGATÓRIOS], [COMO LER A CONVERSA], o placeholder do contexto de grupo e
[FORMATO WHATSAPP]. Todos os templates convergem no limite de **200 caracteres
por bloco** (unificado — antes o template dizia 150 e os traits diziam 200).

## 🎭 Sistema de Personalidades

As personalidades não são só "tons diferentes": são o campo persona que alimenta
`{{PERSONALITY_CONTEXT}}`, `{{PERSONALITY_STYLE}}` e `{{PERSONALITY_TRAITS}}` do
`systemInstruction`. Cada persona é um objeto com o shape
`{ name, description, context, style, traits[] }` em `LUMA_CONFIG.PERSONALITIES`
(`src/config/lumaConfig.js`).

### Personas Predefinidas

| Key | Nome | Vibe |
|-----|------|------|
| `pensadora` **(default)** | Luma Pensadora | 🧠 Inteligente, antenada, pensa junto |
| `agressiva` | Luma Pistola | 🤬 Tóxica, boca-suja, sem filtro |
| `amigavel` | Luma Good Vibes | ✨ Fofa, carinhosa, otimista |
| `intelectual` | Luma Sênior | 🧐 Fria, técnica, precisa |
| `literal` | Luma Literal | 🪨 Interpreta verbos como ação imediata |

`DEFAULT_PERSONALITY` é `"pensadora"`. Além das predefinidas, cada chat pode criar
personas **custom** via a tool `create_persona` (ou `!persona criar ...`), gravadas
por chat com a key prefixada `custom:`.

### Persona é por-chat, histórico é por-pessoa

Duas chaves diferentes — não confunda:

- **Persona**: resolvida por `PersonalityManager.getPersonaConfig(jid)` usando o
  **jid do chat** (o grupo inteiro, ou o PV). Todo mundo no grupo fala com a mesma
  persona ativa. Decisão registrada no ADR 0001.
- **Histórico**: indexado pela `historyKey` (grupo: `jid:senderJid`; PV: `jid`) —
  cada pessoa tem seu próprio fio de conversa. Ver
  [Gerenciamento de Memória](#-gerenciamento-de-memória-contexto).

```js
// LumaHandler.generateResponse (simplificado)
const personaConfig = PersonalityManager.getPersonaConfig(userJid);  // userJid = bot.jid → chat
const historyTurns  = this.history.getTurns(hKey);                   // hKey = jid:senderJid em grupo
```

### Como Trocar a Persona

```
!persona            → abre o menu (p1, p2, ...); responder "pN" ativa a persona
!persona criar ...  → gera e ativa uma persona custom a partir de descrição livre
!persona apagar pN  → remove uma persona custom
```

O `LumaPlugin` (`src/plugins/luma/LumaPlugin.js`) trata esses subcomandos e chama
`PersonalityManager.setPersonality(bot.jid, key)`. Criar uma persona nova **limpa
o histórico** do chat para não vazar o roleplay anterior.

## 🖼️ Visão Computacional (Multimodalidade)

Quando o usuário envia ou cita uma imagem/sticker, o `LumaHandler` extrai o
conteúdo visual e o injeta como **segunda `part` do último turno `user`** em
`contents` (`inlineData` base64). O provider precisa de `supportsVision = true`
(Gemini). Providers sem visão (OpenAI/DeepSeek) recebem uma **descrição textual**
gerada por um `GeminiAdapter` secundário (`visionService`), concatenada ao
`userMessage` — nesse caso `imageData` volta a ser `null` e usa-se o template de
texto.

### Pipeline de Imagem + Texto

A imagem é extraída em `LumaHandler._extractImage()`, que cobre dois casos:

```
mensagem atual tem imageMessage ou stickerMessage?
    └─ SIM → _convertImageToBase64(message, sock) → { inlineData }

mensagem atual é extendedTextMessage (texto com quote)?
    └─ contextInfo.quotedMessage tem imageMessage ou stickerMessage?
           └─ SIM → monta fakeMsg com a quoted → _convertImageToBase64 → { inlineData }
```

O `imageData` resultante é passado para `buildConversationRequest`, que decide o
template de visão e anexa a imagem ao turno atual:

```js
// PromptBuilder.js
const currentParts = [{ text: `${senderName}: ${userMessage}` }];
if (imageData) currentParts.push(imageData);   // 2ª part = imagem
contents.push({ role: 'user', parts: currentParts });
```

### Contexto de Mensagens Citadas (reply/quote)

Sempre que o usuário responde a uma mensagem (de terceiro **ou da própria
Luma**), o trecho citado é injetado no `userMessage` antes de chamar a IA. O
helper `LumaHandler._buildQuotedContext(bot)` centraliza essa montagem e é
reusado por `handle()` e `handleAudio()`:

```
usuario responde/cita uma mensagem
    │
    ├─ bot.quotedHasVisualContent?
    │      ├─ SIM + legenda → [citando Autor: imagem com legenda "texto"]
    │      ├─ SIM sem legenda → [citando Autor: figurinha — analise visualmente]
    │      └─ NÃO (texto)    → [citando Autor: "texto citado"]
    │
    └─ quotedSenderName resolve o Autor (devolve "Luma" quando a citação é da própria Luma)
           │
           └─ userMessage = `${quotedContext} ${userMessage}`
```

Pontos-chave:

- **Reply à Luma também entra no contexto.** O trecho citado é o que o usuário
  está apontando ("esse prompt aqui") e pode nem estar no histórico dele — em
  grupo o histórico é por-participante, então uma fala dirigida a outra pessoa
  não aparece na memória do interlocutor atual. A citação é a ponte.
- **A ordem preserva a instrução de mídia.** O placeholder de figurinha/imagem
  da mensagem *atual* é montado ANTES da citação, então responder citando algo e
  mandando só uma figurinha mantém a instrução de análise visual + a citação.
- **`handleAudio`** injeta a citação quando um áudio responde a um texto/imagem
  (esse contexto não vem no corpo do áudio).
- **`BaileysAdapter.quotedText`** desembrulha envelopes (ephemeral/viewOnce) via
  `unwrapMessage`, senão citações envelopadas voltariam vazias.

Para citações visuais, `generateResponse → _extractImage` detecta a imagem
citada e envia o `imageData` ao Gemini para análise visual real.

### Providers e Suporte a Visão

| Provider | `supportsVision` | Comportamento |
|----------|-----------------|---------------|
| `GeminiAdapter` | `true` | Imagem enviada diretamente como `inlineData` no turno atual |
| OpenAI/DeepSeek (wrapper) | `false` | `visionService` (Gemini secundário) descreve em texto; descrição concatenada ao `userMessage` |

## 💾 Gerenciamento de Memória (Contexto)

O Gemini é stateless — cada requisição é independente. O histórico é mantido em
RAM pelo `ConversationHistory` (`src/core/services/ConversationHistory.js`) e
reenviado a cada chamada, agora **como turnos com papel real**.

### Chave de Histórico

A memória é indexada por uma `historyKey` calculada no `LumaPlugin`:

```js
// Em grupos: chave composta por grupo + pessoa
const historyKey = bot.isGroup
  ? `${bot.jid}:${bot.senderJid}`
  : bot.jid;
```

Cada pessoa tem seu próprio fio de conversa dentro de cada grupo. Sem essa
separação, várias pessoas falando com a Luma ao mesmo tempo produziriam um
histórico entrelaçado e incoerente.

| Contexto | Chave | Exemplo |
|---|---|---|
| Privado | `remoteJid` | `5511999@s.whatsapp.net` |
| Grupo | `groupJid:senderJid` | `120363x@g.us:5511999@s.whatsapp.net` |

> A **persona** usa apenas o `groupJid` (config do chat, compartilhada por todos);
> o **histórico** usa a chave composta. São dimensões diferentes.

### Armazenamento vs. Leitura como Turnos

Internamente o store não mudou — continua um `Map<historyKey, { messages: string[],
lastUpdate }>` com linhas planas, o que preserva compatibilidade com o antigo
`getText()`:

```js
// Cada entrada continua sendo um array de linhas planas:
[
  "Murilo: me conta uma piada",
  "Luma: o que faz a mulher gritar à noite?",
  "Murilo: não sei",
  "Luma: a faca kkk",
]
```

A novidade é o método **`getTurns(jid)`**, que deriva o papel de cada linha pelo
prefixo `"Luma: "` (usado por `add()` em toda resposta da Luma) — **não** pela
posição no array. Assim continua correto mesmo depois de a poda cortar um par
pela metade:

```js
// ConversationHistory.getTurns()
line.startsWith('Luma: ')
  ? { role: 'model', text: line.slice('Luma: '.length) }  // fala da Luma → model
  : { role: 'user',  text: line }                         // "Nome: msg"  → user (mantém rótulo)
```

Marcadores `[PARTE]` são removidos em `add()` antes de salvar — o histórico
guarda sempre texto limpo, independente de quantos balões foram enviados.

### Persistência Opcional (`persist`)

`generateResponse` aceita `{ persist = true }`. Quando `false`, a resposta **não**
é gravada no histórico. É o que as interações espontâneas usam: seus prompts são
instruções de sistema e, se gravados como fala do usuário, poluiriam a memória.

```js
async generateResponse(userMessage, userJid, message, sock, senderName,
                       groupContext, historyKey, { persist = true } = {}) {
  ...
  if (cleanedResponse && persist) {
    this.history.add(hKey, userMessage, cleanedResponse, senderName);
    this._updateMetrics(userJid);
  }
}
```

### Limites e Limpeza Automática

```js
// lumaConfig.js → TECHNICAL
maxHistory: 80,                  // máx de linhas por conversa (~40 trocas)
maxHistoryAge: 7200000,          // expira em 2h sem atividade
historyCleanupInterval: 3600000, // varredura a cada 1h
```

O `ConversationHistory` roda um `setInterval` interno que descarta conversas
inativas. Em testes, passe `cleanupIntervalMs: 1e9` e chame `destroy()` no
`afterEach`.

## 🔌 Chamada à IA (AIPort e Adapters)

O `LumaHandler` não conhece o provider — só o contrato `AIPort`
(`src/core/ports/AIPort.js`). A assinatura efetiva hoje é:

```js
aiService.generateContent(contents, systemInstruction)
  → Promise<{ text: string, functionCalls: Array }>
```

`contents` e `systemInstruction` são exatamente o que `buildConversationRequest`
devolve. O provider é escolhido em `AIProviderFactory.createAIProvider(env)`
conforme `env.AI_PROVIDER` (`gemini` | `openai` | `deepseek`).

### GeminiAdapter

`src/adapters/ai/GeminiAdapter.js`. Injeta o `systemInstruction` no campo nativo
`config.systemInstruction` do `@google/genai` e faz **fallback automático** entre
modelos, na ordem de `LUMA_CONFIG.TECHNICAL.models`:

```js
models: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]
```

Tenta cada modelo em sequência; se um falha (rate limit, indisponível, erro),
loga e passa para o próximo. Se todos falharem, lança erro. O `systemInstruction`
é propagado inclusive no turno de follow-up da busca web.

### OpenAI / DeepSeek

`OpenAIAdapter` recebe `(contents, systemInstruction, tools)` — os mesmos turnos
`user`/`model`, o system separado e as tools. O wrapper em `AIProviderFactory`
repassa o `systemInstruction` **diretamente** e faz a busca web em multi-turn.
Foi **removido** o antigo hack do marcador de texto `[USUÁRIO ATUAL]`.

### Configuração de Geração

```js
// lumaConfig.js → TECHNICAL.generationConfig
{
  temperature:     1.4,    // criatividade alta — respostas variadas e humanas
  maxOutputTokens: 8192,   // teto amplo; o tamanho real é controlado pelo [FORMATO WHATSAPP]
  topP:            0.95,
  topK:            50,
}
```

### Safety Settings

O `GeminiAdapter` desliga todos os filtros de segurança (`BLOCK_NONE` em
`HARM_CATEGORY_HATE_SPEECH`, `HARASSMENT`, `SEXUALLY_EXPLICIT` e
`DANGEROUS_CONTENT`) — necessário para as personas informais/agressivas não serem
bloqueadas no meio da resposta.

## 🔍 Motor de Busca na Internet

Quando o modelo decide chamar a tool `search_web`, a busca é resolvida
**dentro do adapter**, sem passar pelo `PromptBuilder`. O resultado volta ao
modelo como um turno extra e a resposta final é gerada a partir dele.

### No GeminiAdapter (functionResponse)

O resultado entra como um `functionResponse` — a forma nativa do Gemini de
devolver saída de ferramenta ao modelo:

```js
// GeminiAdapter._handleSearchTurn (simplificado)
const followUpContents = [
  ...originalContents,
  modelResponse.candidates[0].content,        // o turno em que o modelo pediu a busca
  { role: "user", parts: [{
      functionResponse: { name: "search_web", response: { result: searchResults } },
  }]},
];
const followUp = await this._callModel(model, followUpContents, systemInstruction);
```

A busca em si usa o `SearchPort` injetado (se disponível) ou, como fallback
interno, o `GoogleGroundingAdapter` (Google Search Grounding via o próprio cliente
Gemini).

### No wrapper OpenAI/DeepSeek (turno user extra)

Sem `functionResponse` nativo, o wrapper injeta os resultados como um novo turno
`user` e reconsulta o adapter:

```js
const enrichedContents = [
  ...contents,
  { role: 'user', parts: [{ text: `[Resultados da busca sobre "${query}"]:\n${searchResults}` }] },
];
const finalResult = await adapter.generateContent(enrichedContents, systemInstruction, []);
```

Em ambos os casos, outras tool calls que vieram junto com a busca são preservadas
no `functionCalls` final. A troca de provedor de busca (Tavily → Google
Grounding) é detalhada em `src/services/WebSearchService.js`.

## 🧩 Buffer de Contexto do Grupo

Quando a Luma é chamada no meio de uma conversa de grupo, ela precisa saber o que
estava sendo discutido — mesmo nos tópicos onde não foi mencionada. O **buffer de
contexto** resolve isso, e no desenho atual ele vira o bloco
**[CONVERSA DO GRUPO — CONTEXTO AMBIENTE]** dentro do `systemInstruction`.

### Como funciona

O buffer é um `Map<groupJid, Array<{name, text}>>` no `LumaPlugin`, guardando as
últimas `groupContextSize` mensagens por grupo (FIFO, padrão **15**):

```
LumaPlugin.onMessage(bot)
    ├── #addToGroupBuffer(jid, body, senderName)   // toda msg de grupo não-própria com body
    ├── groupContext = #getGroupContext(jid, dropLast)
    ├── historyKey   = `${bot.jid}:${bot.senderJid}`
    └── lumaHandler.handle(bot, isReply, groupContext, historyKey)
            └── generateResponse(..., groupContext, historyKey)
                    └── buildConversationRequest({ ..., groupContext })
```

### A mensagem atual é excluída do contexto

Se a mensagem que dispara a Luma acabou de entrar no buffer, ela é a última
entrada e é **descartada** do `groupContext` desta resposta — senão apareceria
duas vezes (como contexto ambiente **e** como mensagem atual no último turno):

```js
// LumaPlugin.onMessage
const pushedToBuffer = bot.isGroup && !bot.isFromMe && !!bot.body;
if (pushedToBuffer) this.#addToGroupBuffer(bot.jid, bot.body, bot.senderName);
...
const groupContext = bot.isGroup
  ? this.#getGroupContext(bot.jid, pushedToBuffer ? 1 : 0)  // dropLast = 1
  : "";
```

### Injeção no systemInstruction

O `PromptBuilder` só monta o bloco quando há contexto, e o rotula
explicitamente como **ambiente** — deixando claro ao modelo que essas mensagens
não foram endereçadas a ele e não precisam de resposta:

```js
// PromptBuilder.js
const groupContextStr = groupContext
  ? `[CONVERSA DO GRUPO — CONTEXTO AMBIENTE]\n(Isto é só o que rolava no grupo antes de te chamarem. NÃO foi endereçado a você e você NÃO precisa responder a estas mensagens — use apenas pra sentir o clima do papo.)\n${groupContext}\n\n`
  : '';
```

Em PV, `groupContext` é sempre `""` e o placeholder some do template.

### Configuração

```js
// lumaConfig.js → TECHNICAL
groupContextSize: 15,  // máximo de mensagens no buffer por grupo
```

## 🎲 Interações Espontâneas (SpontaneousHandler)

A Luma pode interagir em grupos sem ser chamada, simulando presença ativa. O
handler vive em `src/handlers/SpontaneousHandler.js`.

### Lógica de Disparo

```
SpontaneousHandler.handle(bot, lumaHandler)
    │
    ├─ 1. é grupo e provider configurado?  →  não → ignora
    ├─ 2. cooldown OK? (≥ 4 min desde a última interação neste grupo) → não → ignora
    └─ 3. sorteio de chance → não → ignora
              │
              ├─ mensagem tem visual (imagem/sticker)?  →  chance = imageChance (0% no default)
              └─ mensagem é texto?
                      ├─ grupo ativo (≥ 8 msg nos últimos 2 min)?  →  chance = 10% (boostedChance)
                      └─ grupo quieto?                             →  chance =  5% (chance base)
```

### Chave de histórico alinhada e `persist:false`

Ponto crítico do refactor: o espontâneo agora lê o histórico pela **mesma chave
do fluxo disparado** (`${bot.jid}:${bot.senderJid}`) e grava com **`persist:false`**.

Antes, ele gravava no bucket errado (chave `bot.jid`, o grupo inteiro) e persistia
o prompt-de-sistema como se fosse fala do usuário — poluindo a memória. Agora a
coerência de leitura é mantida, mas nada do prompt interno entra no histórico:

```js
// SpontaneousHandler.handle
const historyKey = `${bot.jid}:${bot.senderJid}`;
const response = await lumaHandler.generateResponse(
  prompt, bot.jid, bot.raw, bot.socket, bot.senderName,
  "",                 // sem groupContext no espontâneo
  historyKey,
  { persist: false }, // prompt é instrução de sistema — não vira memória
);
```

### Configuração em `lumaConfig.js`

```js
SPONTANEOUS: {
  enabled: true,
  chance: 0.05,              // 5% por mensagem (grupo quieto)
  imageChance: 0.0,          // 0% — não reage a imagens do nada
  cooldownMs: 4 * 60 * 1000, // 4 min entre interações por grupo

  activityBoost: {
    threshold: 8,            // msgs nos últimos 2 min para "grupo ativo"
    windowMs: 2 * 60 * 1000,
    boostedChance: 0.1,      // 10% quando o grupo está ativo
  },

  typeWeights: { REACT: 1.0, REPLY: 0.0, TOPIC: 0.0 },  // só reagir com emoji

  emojiPool: ["😂", "💀", "😭", "🤔", "👀", "😳", "🗿", "💅", ...],

  prompts: { REPLY: "...", TOPIC: "...", IMAGE: "..." },  // prefixados "[Sistema interno...]"
}
```

O `SpontaneousHandler.trackActivity(jid)` é chamado para toda mensagem de grupo
(pelo fluxo de mensagens) para alimentar o cálculo de atividade. Com os pesos
atuais (`REACT: 1.0`), o comportamento padrão é apenas reagir com emoji; os prompts
`REPLY`/`TOPIC`/`IMAGE` existem para quando os pesos forem reativados.

## ⏰ Lembretes via Function Calling

A Luma agenda lembretes por linguagem natural usando a tool `schedule_reminder`
(uma das 10 declarações em `LUMA_CONFIG.TOOLS`). O segredo é o contexto temporal:
como `{{CURRENT_DATETIME}}` (horário de Brasília) já é injetado no
`systemInstruction`, o modelo calcula a **data/hora absoluta em ISO 8601**
(`-03:00`) a partir de expressões relativas ("próxima terça às 16h").

```
"Luma, me lembre do evento de videogame terça às 16h"
        │
        ├─ schedule_reminder({ reminder_text: "evento de videogame",
        │                      datetime: "2026-06-02T16:00:00-03:00" })
        │
        └─ ToolDispatcher.handleScheduleReminder()
               ├─ resolve alvos: menções da mensagem (ou o autor)
               ├─ ReminderService.schedule() valida (futuro, ≤1 ano, texto)
               └─ confirma na persona da Luma
```

Ao chegar a hora, o `ReminderScheduler` (em `src/infra/`) dispara o lembrete
mencionando as pessoas no grupo ou avisando no PV. Detalhes de persistência em
[04-banco-dados.md](./04-banco-dados.md).

> O comando manual `!lembrete DD/MM/AAAA HH:mm | texto` não passa pela IA — o
> `ReminderPlugin` parseia a data direto e chama o mesmo `ReminderService`.

## 🧰 Inventário de Tools

`LUMA_CONFIG.TOOLS` declara **10** funções (function declarations) que o modelo
pode chamar; o `ToolDispatcher` (`src/handlers/ToolDispatcher.js`) traduz cada
chamada em ação:

| Tool | O que faz |
|------|-----------|
| `tag_everyone` | Menciona todos do grupo |
| `remove_member` | Expulsa um membro (arg `target`) |
| `create_sticker` | Cria figurinha a partir de imagem/vídeo/GIF |
| `create_image` | Converte sticker em imagem |
| `create_gif` | Converte sticker animado em GIF/vídeo |
| `clear_history` | Limpa a memória da conversa atual |
| `show_help` | Exibe a lista de comandos |
| `search_web` | Busca na internet (arg `query`) |
| `schedule_reminder` | Agenda lembrete (args `reminder_text`, `datetime`) |
| `create_persona` | Cria e ativa uma persona custom (arg `description`) |

## 🧪 Testando a IA Localmente

A suíte usa **Vitest**. Testes de `PromptBuilder` verificam a separação das fontes
(system vs. contents), o descarte de turnos `model` órfãos no início e a anexação
da imagem ao último turno. Testes de `ConversationHistory` cobrem `getTurns()` e a
derivação de papel pelo prefixo. Rode tudo com:

```bash
npx vitest run
```

Para classes com `setInterval` (como `ConversationHistory`), passe
`cleanupIntervalMs: 1e9` no construtor e chame `destroy()` no `afterEach`.

---

**Próximo passo**: Aprenda sobre processamento de mídia em [03-motor-midia.md](./03-motor-midia.md)
