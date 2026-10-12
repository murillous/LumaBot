# Plugin `sticker-convert`

Figurinha de volta a imagem ou vídeo. Código em `src/plugins/sticker-convert/`:
`sticker-convert.ts` (comandos) e `convert.ts` (conversões). Port do `!image` e do `!gif` do
`MediaPlugin` do legacy.

## Comandos

A figurinha vem da própria mensagem ou da citada; outra mídia recebe o texto de uso.

| Comando | Entrada | Saída |
| --- | --- | --- |
| `!image` / `!i` | Figurinha | PNG. Figurinha animada vira o primeiro quadro |
| `!gif` / `!g` | Figurinha animada | Vídeo MP4 H.264 (figurinha estática: sugere o `!image`) |

Enquanto converte, o bot reage ⏳ e depois ✅ ou ❌. Erro de conversão vai para o log
(`falha ao processar mídia`) e o chat recebe `conversionError`.

## Capabilities

O plugin exige só `media.download`. Cada comando declara no `requires` a capability do que envia
(`send.image`, `send.video`) e, sem ela, não é registrado.

## FFmpeg

Só o `!gif` usa o `ffmpeg` do `PATH` (com `libx264`). Sem ele, o plugin sobe e o `setup` registra
o aviso `ffmpeg indisponível`; o `!image` usa só o Sharp. O FFmpeg não lê WebP animado, então o
`!gif` passa a figurinha para GIF com o Sharp antes.

O `!gif` roda fora da fila do chat (`background`), até 2 ao mesmo tempo no bot. Prazo: 60 s.

## Textos

Em `messages`, sobrescrevíveis pela config (`gifDone` → `BRIDGER_STICKER_CONVERT__MESSAGES__GIF_DONE`).
`{prefix}` vira o prefixo do chat.

## Diferenças do legacy

- `!gif` envia o MP4 como vídeo comum, não no modo GIF do WhatsApp (`gifPlayback`, que toca
  em loop): decisão do dono, o vídeo basta.
