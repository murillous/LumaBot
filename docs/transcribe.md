# transcribe

Transcrição de `voice` e `audio`: o comando `!transcribe`, o serviço `transcription` e a tool
`transcribe_audio`. Código em `src/plugins/transcribe/transcribe.ts`. Quando a Luma transcreve
para responder, o texto **não** vai ao chat.

## Comando

| Comando | O que faz |
| --- | --- |
| `!transcribe` (`!t`) | Transcreve o áudio da mensagem ou o da citada e responde `🎙️ "texto"`. Sem áudio, explica como usar |

Reage 🎙️ enquanto trabalha e ❌ se falha. Áudio sem fala responde que não entendeu ou que estava
vazio, sem o marcador `[áudio ...]` do modelo. Falha da IA responde uma frase curta e vai para o
log; a causa não vai ao chat. Prazo: 90 s.

## Tool da IA

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `transcribe_audio` | — | Transcreve o áudio da mensagem ou da citada e devolve `text` **só ao modelo** | `no-audio`, `too-large`, `unavailable` |

## Serviço `transcription`

```ts
transcribe(media: Media, options?: { signal }): Promise<string>
```

É a única implementação, usada pelo comando e pela tool. Outros plugins transcrevem por ele, sem
editar este. Devolve o texto, ou `[áudio ininteligível]` / `[áudio sem conteúdo]`; lança
`AudioTooLargeError` (acima de `maxBytes`) e `AiUnavailableError`.

## Modelo da transcrição

Nem todo modelo tem entrada de áudio (o DeepSeek não tem). `models` troca a cadeia **só** para
transcrever (`generate({ models })`, ver [ai.md](ai.md#modelo-por-finalidade-models)):

```sh
BRIDGER_TRANSCRIBE__MODELS='[{"model":"google:gemini-2.5-flash"}]'
```

Com a chave do Gemini, a transcrição usa o Gemini e a Luma segue na cadeia principal. Item sem
provider é pulado; se nenhum atende, o comando responde o erro e a tool devolve `unavailable`.

## Config

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `models` | `[]` | Cadeia só da transcrição. Vazio usa a principal |
| `maxBytes` | `15728640` | Áudio maior que isso nem vai ao modelo |

`messages`: `usage`, `failed`, `tooLarge`, `unintelligible`, `silent` (`{prefix}` é o prefixo do chat).
