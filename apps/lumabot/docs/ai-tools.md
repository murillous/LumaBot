# Tools da IA (`ai.tools`)

Todo plugin do app pode ser chamado pela IA por function calling. Cada plugin contribui as
próprias tools ao ponto de extensão `ai.tools`; a IA lê a lista e não conhece nenhum plugin
([ADR 0003](../../../docs/adr/0003-tools-da-ia-por-ponto-de-extensao.md)). O contrato fica em
`src/plugins/ai-tools.ts`.

## Contribuir uma tool

No `setup` do plugin, sem `dependsOn` no `ai`:

```ts
import { z } from 'zod';
import { aiTool, fail, mediaMessage, ok } from '#plugins/ai-tools.ts';

ctx.services.contribute(
  'ai.tools',
  aiTool({
    name: 'image_to_pdf', // único no bot, snake_case
    description: 'Converte em PDF a imagem da mensagem ou da respondida, e envia no chat.',
    args: z.object({ fileName: z.string().optional() }), // sem transform: vira JSON Schema
    requires: ['send.document'], // opcional: a IA só oferece se o transport tiver
    run: async ({ fileName }, t) => {
      const source = mediaMessage(t.message, ['image']); // a da mensagem ou a citada
      if (!source) return fail('no-image');
      await t.reply.document(/* ... */);
      return ok();
    },
  }),
);
```

- `run` recebe os argumentos já validados e o `AiToolContext`: `message` (chat, remetente,
  menções, mídia e citada), `reply`, `signal` e `log`.
- O retorno vai para o modelo, não para o chat: `ok(dados)` ou `fail('código')`. O que o usuário
  recebe sai pelo `reply`.
- Exceção que a tool não traduz vira `{ ok: false, error: 'failed' }` e vai para o log.

## Consumir (o plugin `ai`)

```ts
const tools = ctx.services.extensionPoint('ai.tools'); // guarde a visão no setup
const offered = offeredTools(tools.list(), ctx.capabilities); // a cada conversa
// para o modelo: name, description e z.toJSONSchema(tool.args, { io: 'input' })
const result = await invokeTool(tool, argsDoModelo, { message, reply, signal, log });
```

`invokeTool` devolve `invalid-args` (com `detail`) se o modelo errar os argumentos, sem rodar a
tool.

## Testar

O plugin de teste `ai-tools-probe.ts` faz o papel da IA: `!tool <nome> <json>` roda a tool entre
as oferecidas e responde o resultado em JSON (`not-offered` se o transport não tem o `requires`).
`toolResult(bot)` lê a última resposta:

```ts
bot = await createTestBot({ plugins: [pdf(), aiToolsProbe] });
await bot.receive({ text: '!tool image_to_pdf', quoted: { image: fixtures.image() } });
expect(toolResult(bot)).toEqual({ ok: true });
```

## Catálogo

| Plugin | Tools |
| --- | --- |
| [`help`](help.md#tools-da-ia) | `list_commands` |
| [`sticker`](sticker.md#tools-da-ia) | `create_sticker` |
| [`sticker-convert`](sticker-convert.md#tools-da-ia) | `sticker_to_image`, `sticker_to_video` |
| [`pdf`](pdf.md#tools-da-ia) | `image_to_pdf`, `merge_pdfs` |
| [`download`](download.md#tools-da-ia) | `download_media`, `download_audio`, `download_sticker` |
| [`utils`](utils.md#tools-da-ia) | `chat_info` |
| [`user-names`](user-names.md#tools-da-ia) | `set_nickname`, `get_name` |
| [`reminders`](reminders.md#tools-da-ia) | `create_reminder`, `list_reminders`, `cancel_reminder` |
| [`rank`](rank.md#tools-da-ia) | `ranking` |

`ping`, `pairing` e `sticker-text` ficam de fora: os dois primeiros são operacionais, e a
legenda do `sticker-text` entra pelo `caption` do `create_sticker`.
