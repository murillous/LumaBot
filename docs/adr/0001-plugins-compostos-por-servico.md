# ADR 0001 — Plugins compostos por serviço

**Status:** Aceito (2026-10-12) · Revisado (2026-10-16): itens 2 a 4, ver [Revisão](#revisão-2026-10-16)

## Contexto

O plugin `media` juntava cinco comandos (`!sticker`, `!image`, `!gif`, `!pdf`, `!mergepdf`) e,
dentro do `!sticker`, a legenda de meme ficava no meio da conversão. Para mudar ou desligar a
legenda era preciso mexer no plugin da figurinha, e o boot não mostrava o que estava ativo. Uma
feature que só reaproveita a figurinha, como mandar como figurinha um vídeo baixado pelo
`!download`, teria que importar o código do `media` ou duplicá-lo.

O Bridger já tem o mecanismo: serviços por plugin (`ctx.services.provide/get/has`, tipados por
declaration merging em `Services`), `dependsOn` com ordem de carga e reload em cascata dos
dependentes. O app só não o usava.

## Decisão

1. **Um plugin por assunto.** O `media` virou `sticker`, `sticker-convert` (`!image`, `!gif`) e
   `pdf` (`!pdf`, `!mergepdf`). O que é comum a eles (reações de andamento, FFmpeg, diretório
   temporário) fica em módulos de `src/plugins/`, não num plugin.
2. **Plugin que tem uma variação real oferece um serviço.** O `sticker` provê `sticker` com
   `decorate(step, signal)` e `create(media, options)`. O `!sticker` usa o próprio serviço, então
   quem estende o serviço estende o comando.
3. **Estender = `dependsOn` + etapa presa ao `ctx.signal`.** O `sticker-text` declara
   `dependsOn: { sticker }` e registra a legenda no `setup` com o `ctx.signal`. O serviço tira a
   etapa quando o sinal aborta (teardown, reload), então o dependente não guarda estado nem
   desfaz nada à mão, e não há como registrar duas vezes.
4. **Usar de forma opcional = `services.has` na hora do uso.** O `!downloadsticker` do
   `download` não declara `dependsOn`: o `download` carrega sem o `sticker` e só esse comando
   responde que a figurinha está indisponível. Consultar a cada uso pega o serviço novo depois
   de um reload do `sticker`, que não recarrega o `download`.
5. **Ponto de extensão só onde já há extensão.** `sticker-convert` e `pdf` não oferecem serviço:
   ninguém os estende hoje. Quando alguém precisar, o serviço entra junto com o primeiro uso.

## Consequências

- Desligar o `sticker-text` (`disabledPlugins` ou dashboard) tira a legenda sem tocar no
  `sticker`; o boot mostra cada parte como `loaded` ou `skipped`.
- Nova extensão da figurinha (borda, remover fundo) é um plugin novo; o `sticker` não muda.
- As etapas rodam na ordem de registro, que segue a ordem de carga. Com mais de uma extensão, a
  ordem se ajusta com `after`/`priority` no manifesto de quem estende.
- Toda etapa recebe o texto inteiro do comando. Se duas extensões quiserem ler argumentos, será
  preciso uma regra para repartir o texto; fica para quando a segunda existir.
- As chaves de config mudaram com os nomes: `BRIDGER_MEDIA__MESSAGES__*` virou
  `BRIDGER_STICKER__*`, `BRIDGER_STICKER_CONVERT__*` e `BRIDGER_PDF__*`. A produção ainda roda o
  legacy, então não há override a migrar.
- O serviço é contrato entre plugins do app: mudar `StickerService` de forma incompatível exige
  subir a versão do `sticker` e a faixa no `dependsOn` de quem estende.

## Revisão (2026-10-16)

O Bridger 0.4 trouxe para o kernel o que este ADR fazia à mão no app, e o 0.6 passou a abortar o
boot quando um plugin não carrega (ADR 0102 do Bridger):

- **Itens 2 e 3.** A extensão sai do `StickerService` e vai para o ponto de extensão
  `sticker.steps` (`ctx.services.contribute`/`extensionPoint`, ADR 0096 do Bridger). O serviço
  fica só com `create`, e o kernel tira a etapa de quem recarrega ou é desligado, sem `ctx.signal`.
- **Item 4.** O `download` declara `optionalDependsOn: { sticker }` e o `!downloadsticker`,
  `services: ['sticker']` (ADR 0099 do Bridger). Sem o `sticker`, o comando fica fora do
  roteador em vez de responder `stickerUnavailable`; o reload em cascata o traz de volta.
- **Capabilities.** O `send.sticker` passa do plugin para o `!sticker`: exigido no plugin, um
  transport sem figurinha abortaria o boot do bot inteiro.
- As faixas `^0.0.0` viram `0.x`: pela regra do `^`, `^0.0.0` aceita só a versão exata.
