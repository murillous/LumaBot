# Logs e métricas dos plugins

Cada plugin registra o que faz por eventos de log (`log.event`) e, nas ações que custam ou falham,
por métricas no serviço `metrics`. Assim dá para filtrar no Loki por `event` e montar painéis no
Grafana sem ler texto livre. As métricas da IA ficam no [`ai-metrics`](ai-metrics.md).

## Convenção

**Eventos de log.** Cada plugin define os seus com `defineLogEvent` (`@usebridger/core`) num
`log-events.ts` ao lado do plugin.

- O nome segue `<plugin>.<coisa>.<resultado>` em kebab-case, por exemplo `download.media.done`.
- Numa ação medida, o resultado é `done` (`info`), `refused` (`warn`, uma recusa esperada como
  arquivo grande demais) ou `failed` (`error`, com o erro em `err`).
- A mensagem é fixa e não leva valores. Os valores vão nos campos, com os nomes do dicionário do
  logger (`err`, `reason`, `durationMs`...).
- Chat e contato saem pseudonimizados pelo kernel. Não vão para o log nem a URL inteira nem
  texto do usuário (mensagem, termo buscado, transcrição): no máximo o `host` do link.

**Métricas.** São declaradas no `setup`, com nomes Prometheus nativos (`luma_<plugin>_total`,
`luma_<plugin>_seconds`) e tempo em segundos.

- Os rótulos são `kind`, de um conjunto fixo do plugin, e `outcome`: `ok`, `refused` ou
  `error`. Nunca chat, contato ou URL.
- A duração (`_seconds`) conta só as ações feitas: recusa e falha ficam no contador.
- O `metrics` é opcional (`optionalDependsOn`): sem ele, o plugin funciona e só registra o log.

**Como medir uma ação.** O `trackerFor(spec, services)` de `src/plugins/action-metrics.ts`
declara as métricas e devolve o `track(log, kind, work)`. Ele registra o fim da ação: o evento,
o contador e a duração. Dentro do `work`, `step.refuse(motivo)` termina como recusa e
`step.note(campos)` acrescenta campos à linha do fim. Um erro que o `spec.refusal` reconhece
conta como recusa; os outros contam como falha e são relançados. Os comandos de mídia passam o
`track` ao `attempt` (`src/plugins/media-command.ts`).

## Ações medidas

| Plugin | `kind` | Eventos (`.done` / `.refused` / `.failed`) | Métricas | Recusas (`reason`) |
| --- | --- | --- | --- | --- |
| `download` | `media`, `audio`, `sticker` | `download.media.*` | `luma_download_*` | `too-large`, `image-unsupported` |
| `sticker` | `media` (da mensagem), `url` | `sticker.create.*` | `luma_sticker_*` | `url-failed` |
| `sticker-convert` | `image`, `gif` | `sticker-convert.convert.*` | `luma_sticker_convert_*` | `not-animated` |
| `pdf` | `image`, `add` (à fila do `!mergepdf`), `merge` | `pdf.convert.*` | `luma_pdf_*` | `too-large` |
| `transcribe` | `audio` | `transcribe.audio.*` | `luma_transcribe_*` | `too-large`, `unavailable` |
| `web-search` | `tavily`, `native` (um por backend tentado) | `web-search.search.*` | `luma_web_search_*` | `quota`, `unavailable` |

Os comandos e as tools da IA registram igual. O `!downloadsticker` conta no `download`, não no
`sticker`. A transcrição é medida no serviço `transcription`, então conta também quando a Luma
transcreve para responder. No `web-search`, a falha do Tavily é registrada e a busca cai para a
nativa.

Campos da linha do fim, além de `kind`, `durationMs`, `reason` e `err`:

| Plugin | Campos |
| --- | --- |
| `download` | `host` do link, `bytes` enviados |
| `sticker` | `host` (só `url`), `animated`, `bytes` da figurinha |
| `sticker-convert` | `bytes` enviados |
| `pdf` | `bytes` do PDF, `pdfs` juntados (`merge`) |
| `transcribe` | `bytes` do áudio, `result` (`text`, `unintelligible`, `silent`, `empty`) |

Baldes da duração: `download` até 240 s, `transcribe` até 90 s, `web-search` até 34 s e os de
mídia até 60 s, cada um até o prazo do comando.

## Outros eventos

| Plugin | Evento | Nível |
| --- | --- | --- |
| `download` | `download.binaries.missing` | `warn` |
| `sticker` | `sticker.ffmpeg.missing` | `warn` |
| `sticker-convert` | `sticker-convert.ffmpeg.missing` | `warn` |
| `sticker-text` | `sticker-text.emoji-font.missing` | `warn` |
| `ai` | `ai.generate.done` (`model`, `purpose`, `durationMs`, tokens) | `info` |
| `ai` | `ai.model.failed` (tenta o próximo), `ai.search.unsupported`, `ai.models.empty`, `ai.keys.unreadable` | `warn` |
| `ai` | `ai.provider.unregistered`, `ai.observer.failed`, `ai.tool.failed` (tool que lançou, em `ai-tools.ts`) | `error` |
| `ai` | `ai.http.disabled` | `info` |
| `luma` | `luma.reply.failed`, `luma.persona-create.failed` | `error` |
| `luma` | `luma.name.failed`, `luma.stats.failed`, `luma.error-notice.failed`, `luma.ai-metrics.failed` | `warn` |
| `luma` | `luma.typing.failed` | `debug` |
| `resumo` | `resumo.summary.failed` | `error` |
| `resumo` | `resumo.name.failed` | `warn` |
| `resumo` | `resumo.typing.failed` | `debug` |
| `spontaneous` | `spontaneous.reaction.failed` | `warn` |
| `reminders` | `reminders.job.missing-id`, `reminders.fired.delete-failed`, `reminders.series.cancel-failed`, `reminders.parser.failed` | `error` |
| `reminders` | `reminders.orphan.cancel-failed`, `reminders.kind.duplicate`, `reminders.kind.missing`, `reminders.series.ended` | `warn` |
| `help` | `help.section.failed` | `warn` |
| `user-names` | `user-names.source.failed`, `user-names.remember.failed` | `warn` |
| `utils` | `utils.info-line.failed` | `error` |
