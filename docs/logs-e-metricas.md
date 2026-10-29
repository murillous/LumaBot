# Logs e métricas dos plugins

Cada plugin registra o que faz por eventos de log (`log.event`) e, nas ações que custam ou falham,
por métricas no serviço `metrics`. Assim dá para filtrar no Loki por `event` e montar painéis no
Grafana sem ler texto livre. As métricas da IA ficam no [`ai-metrics`](ai-metrics.md).

## Convenção

**Eventos de log.** Cada plugin define os seus com `defineLogEvent` (`@usebridger/core`) num
`log-events.ts` ao lado do plugin.

- O nome segue `<plugin>.<coisa>.<resultado>` em kebab-case, por exemplo `download.media.done`.
- O resultado é `done` (`info`), `refused` (`warn`, uma recusa esperada como arquivo grande
  demais) ou `failed` (`error`, com o erro em `err`).
- A mensagem é fixa e não leva valores. Os valores vão nos campos, com os nomes do dicionário do
  logger (`err`, `reason`, `durationMs`...).
- Chat e contato saem pseudonimizados pelo kernel. Não vão para o log nem a URL inteira nem
  texto do usuário: no máximo o `host` do link.

**Métricas.** São declaradas no `setup`, com nomes Prometheus nativos (`luma_<plugin>_total`,
`luma_<plugin>_seconds`) e tempo em segundos.

- Os rótulos têm baixa cardinalidade e vêm sempre de um conjunto fixo, por exemplo `outcome`:
  `ok`/`refused`/`error`. Nunca chat, contato ou URL.
- O `metrics` é opcional (`optionalDependsOn`): sem ele, o plugin funciona e só registra o log.

## Por plugin

### `download`

Os comandos e as tools da IA registram igual. `kind` é `media` (`!download`, `download_media`),
`audio` ou `sticker`.

| Evento | Nível | Campos |
| --- | --- | --- |
| `download.media.done` | `info` | `kind`, `host`, `durationMs`, `bytes` enviados |
| `download.media.refused` | `warn` | `kind`, `host`, `reason` (`too-large`, `image-unsupported`) |
| `download.media.failed` | `error` | `kind`, `host`, `durationMs`, `err` (com o stderr do yt-dlp) |
| `download.binaries.missing` | `warn` | `err`; sai no `setup` |

| Métrica | Tipo | Rótulos |
| --- | --- | --- |
| `luma_download_total` | contador | `kind`, `outcome` (`ok`, `refused`, `error`) |
| `luma_download_seconds` | histograma (1 s a 240 s), só dos enviados | `kind` |
