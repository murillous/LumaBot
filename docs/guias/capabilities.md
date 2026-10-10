# Capabilities

Cada plataforma sabe fazer coisas diferentes: o WhatsApp tem figurinha e não tem botão, o chat web
tem botão e não tem reação. O transport declara o que sabe fazer numa lista de **capabilities**, e
o plugin diz do que precisa. O detalhe está em
[Transport → Capabilities](../../packages/core/docs/transport.md#capabilities).

## Exigir ou conferir

Há dois jeitos de lidar com uma capability, e a escolha é do plugin:

**Exigir em `requires`**, quando o plugin não faz sentido sem ela. Num transport sem a capability,
o plugin nem sobe, e a tabela de boot diz o que faltou:

```ts
export const figurinha = definePlugin({
  name: 'figurinha',
  version: '0.1.0',
  engine: '<1.0.0',
  requires: ['media.download', 'send.sticker'],
  // ...
});
```

```
Plugins: 1 carregado(s), 1 ignorado(s)
  figurinha  0.1.0  ignorado (capability ausente no transport: send.sticker)
```

**Conferir em `ctx.capabilities`**, quando é um extra. O plugin sobe em todo transport e usa o
recurso onde ele existe:

```ts
commands: {
  ok: {
    run: async (c, { capabilities }) => {
      if (capabilities.has('reactions')) {
        await c.react('👍');
        return;
      }
      return 'ok!';
    },
  },
},
```

Peça em `requires` só o essencial: cada capability a mais tira o plugin de uma plataforma.
`commands` no manifesto já exige `send.text`.

Usar uma capability que o transport não tem rejeita com `UnsupportedError` (com `capability` e
`transport`). Isso é a rede de segurança: o caminho normal é o `requires` ou o `has()`.

## A lista

| Capability | O que libera |
| --- | --- |
| `send.text`, `send.image`, `send.video`, `send.audio`, `send.document` | Enviar cada tipo |
| `send.voice` | Recado de voz (o áudio gravado na hora, diferente de arquivo de áudio) |
| `send.sticker` | Figurinha |
| `send.album` | Várias mídias numa mensagem |
| `media.download` | Baixar a mídia recebida (`media.download()`, `stream()`) |
| `quoted` | Responder citando a mensagem |
| `mentions` | Menção que notifica a pessoa |
| `reactions` | Reagir a mensagens (`c.react`, `send.react`) |
| `message.edit` / `message.delete` | Editar ou apagar mensagem |
| `polls` | Enquete (`reply.poll`) e o evento `poll.vote` |
| `actions` | Botões. Sem ela, o kernel manda menu numerado |
| `typing` | "Digitando…" ou "gravando áudio…" (`send.typing`) |
| `groups` | Ler dados de grupo (`ctx.groups.metadata`) |
| `groups.add`, `groups.remove`, `groups.promote` | Adicionar, remover, promover ou rebaixar participantes |
| `pairing` | A sessão se pareia por QR ou código. Não interessa a plugins de conteúdo |

## Matriz por transport

| Capability | WhatsApp (Baileys) | Telegram | Discord | web |
| --- | --- | --- | --- | --- |
| `send.text` | ✓ | ✓ | ✓ | ✓ |
| `send.image` | ✓ | ✓ | ✓ | ✓ |
| `send.video` | ✓ | ✓ | ✓ | ✓ |
| `send.audio` | ✓ | ✓ | ✓ | ✓ |
| `send.voice` | ✓ | ✓ | — | — |
| `send.sticker` | ✓ | ✓ | — | — |
| `send.document` | ✓ | ✓ | ✓ | ✓ |
| `send.album` | — | ✓ | ✓ | — |
| `media.download` | ✓ | ✓ | ✓ | ✓ |
| `quoted` | ✓ | ✓ | ✓ | ✓ |
| `mentions` | ✓ | ✓ | ✓ | — |
| `reactions` | ✓ | ✓ | ✓ | — |
| `message.edit` | ✓ | ✓ | ✓ | ✓ |
| `message.delete` | ✓ | ✓ | ✓ | ✓ |
| `polls` | ✓ | ✓ | ✓ | — |
| `actions` | — | ✓ | ✓ | ✓ |
| `typing` | ✓ | ✓ | ✓ | ✓ |
| `groups` | ✓ | ✓ | ✓ | — |
| `groups.add` | ✓ | — | — | — |
| `groups.remove` | ✓ | ✓ | ✓ | — |
| `groups.promote` | ✓ | ✓ | — | — |
| `pairing` | ✓ | — | — | — |

As colunas do WhatsApp (`@zapforge/transport-baileys`) e do web (`@zapforge/transport-web`) são o
que esses transports declaram hoje. As do Telegram e do Discord são a previsão do
[plano](../../ZAPFORGE_PLAN.md#610-capabilities-por-transport): esses transports ainda não
existem, e as colunas se confirmam quando cada um nascer. O kit de testes usa a mesma matriz nos
[perfis](testes.md#perfis-de-plataforma).

Um transport de terceiro declara o próprio conjunto. Na dúvida, confira `ctx.capabilities` em vez
de supor pela plataforma.

## Limites não são capability

Tamanho máximo de texto, de legenda e quantidade de botões ficam em `limits` no transport, não na
lista. O plugin não precisa contar caracteres: a fila de saída divide o texto longo, e o botão
que não cabe vira menu numerado.

## Testar

Com `profile`, o transport falso do kit declara as capabilities da plataforma. Um plugin que exige
o que o perfil não tem fica fora do boot, como ficaria no transport real:

```ts
const bot = await createTestBot({ profile: 'web', plugins: [figurinha] });
expect(bot.bot.plugins().find((p) => p.name === 'figurinha')?.status).toBe('skipped');
```

Para cobrir as quatro plataformas, rode o mesmo teste em todos os perfis
([Testes](testes.md#o-mesmo-teste-em-todas-as-plataformas)).
