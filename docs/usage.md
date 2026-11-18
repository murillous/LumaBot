# usage

Quanto cada pessoa usa a Luma, em todas as ações feitas a pedido dela: figurinha, download, PDF,
transcrição, busca, lembrete, resumo, resposta da IA. Dados no storage do próprio plugin
(coleção `daily`). Nunca vai para o `metrics`: id de pessoa não vira rótulo do Prometheus.

## O que fica guardado

Um agregado por dia (UTC), pessoa, chat, ação, variante e resultado: `count` e `cost` (soma dos
custos informados, em US$; 0 se nenhum foi). Nunca texto do usuário.

A pessoa é o `personId` (`src/plugins/ai/person-id.ts`): `<telefone>@s.whatsapp.net` quando o transport
sabe o telefone, senão o id nativo. Assim a mesma pessoa é uma só no grupo e no privado.

## Quem registra

| Plugin | `action` | `kind` | Por onde |
| --- | --- | --- | --- |
| `download` | `download` | `media`, `audio`, `sticker` | `track` |
| `sticker` (com a legenda do `sticker-text`) | `sticker` | `media`, `url` | `track` |
| `sticker-convert` | `sticker_convert` | `image`, `gif` | `track` |
| `sticker-edit` | `sticker_edit` | `sticker` | `track` |
| `pdf` | `pdf` | `image`, `add`, `merge` | `track` |
| `ai-context` (tool `read_pdf`) | `pdf` | `read` | `recordUsage`, pelo ponto `ai-context.observers` |
| `transcribe` | `transcribe` | `audio` | `track`, com o `by` do serviço |
| `web-search` | `web_search` | `tavily`, `native` | `track`, com o `by` do serviço |
| `reminders` | `reminders` | `create`, `cancel` | `recordUsage` |
| `resumo` | `resumo` | `chat` | `recordUsage` |
| `utils` | `utils` | `prefix` (só a troca de prefixo) | `recordUsage` |
| `luma` | `luma` | `reply`, com o custo da IA | observer do `ai-metrics`, com o `actor` do `generate` |

O `outcome` é `ok`, `refused` (recusa esperada: arquivo grande, lembrete inválido, cancelar o que
não existe) ou `error`. As tools da IA registram com quem mandou a mensagem que disparou a resposta.

Não contam: consultas (`!help`, `!rank`, `!ping`, `!meunumero`, `!lembretes`) e as reações
espontâneas, que não são ação pedida por alguém.

Para registrar uma ação nova: com o `track` de `src/plugins/action-metrics.ts`, passe
`{ log, message }`; sem ele, chame `recordUsage(services, log, message, { action, kind, outcome })`
de `src/plugins/usage/usage.ts`. Os dois não fazem nada sem o `usage` carregado e nunca derrubam a
ação: falha vai para o log (`usage.record.failed`).

## Config

| Chave | Padrão | O que faz |
| --- | --- | --- |
| `retentionDays` | `90` | Dias de histórico guardados. O mais antigo sai no primeiro registro de cada dia |

## Serviço `usage`

```ts
record(entry: { actor; chatId; action; kind; outcome; cost? }): Promise<void>
history(actor, options?: { days?: number }): Promise<UsageRow[]>  // padrão 30 dias, UTC, hoje incluído
```

## Ponto `usage.observers`

`UsageObserver = (entry: UsageEntry & { at: number }) => void | Promise<void>`. Recebe cada ação
registrada. É por aqui que um plugin de fora (uma cota, por exemplo) lê o uso sem este repositório
saber de cobrança. Observer que lança vai para o log (`usage.observer.failed`) e não atrapalha os
outros.
