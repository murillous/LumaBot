# ADR 0002 — Plugins fechados para modificação, abertos para extensão

**Status:** Aceito (2026-10-16)

## Contexto

O ADR 0001 separou os plugins por assunto e criou o primeiro ponto de extensão (a etapa da
figurinha), mas a regra dele era abrir só onde já havia extensão. Os plugins do M4 e do M5 se
cruzam: o `plugin-ai` vai criar lembretes e figurinhas por tool calling, o `rank` e os lembretes
mostram nomes do `user-names`, e o `!meunumero` e o `!help` juntam informações de vários
plugins. Se cada um importar o código do outro, ou se o dono tiver que mudar a cada novo
consumidor, cada feature nova mexe em plugin pronto.

O Bridger 0.6 traz pontos de extensão no registry de serviços (`ctx.services.extensionPoint` e
`contribute`, ADR 0096 do Bridger): o kernel guarda as contribuições, atribui cada uma a quem a
fez e a tira no teardown, no reload e no disable de quem contribuiu.

## Decisão

1. **A regra mora num serviço, e o comando é um adaptador.** Plugin com regra de negócio (nomes,
   lembretes, ranking, menu) provê um serviço tipado em `Services` e usa o próprio serviço nos
   comandos, como o `sticker` faz. O comando só traduz mensagem em chamada ao serviço e o
   resultado em resposta. Outro plugin (a IA, o dashboard) usa a mesma regra pelo serviço, sem
   passar pelo comando.
2. **Variação prevista vira ponto de extensão do kernel.** Onde outro plugin vai acrescentar
   comportamento (uma fonte de nome, um formato de data, uma seção do menu, uma linha do
   `!meunumero`), o dono declara o tipo em `ExtensionPoints` com o nome `<plugin>.<ponto>`,
   guarda a visão de `extensionPoint` no `setup` e chama `list()` a cada uso. Quem estende
   declara `dependsOn` no dono e chama `contribute` no `setup`. O comportamento padrão do dono
   entra pelo mesmo ponto, contribuído por ele mesmo, para não ter caminho especial.
3. **Estender nunca exige editar o dono.** Comportamento novo é um plugin novo, ou uma
   contribuição num plugin existente que já é dono do assunto. Se a extensão não couber nos
   pontos existentes, o ponto muda no dono uma vez, com versão nova.
4. **Lógica pura fora do plugin.** Parser, formatação e cálculo ficam em módulos sem
   `@usebridger/*` (`parse.ts`, `format.ts`), testáveis sozinhos e reaproveitáveis fora do bot.
5. **Texto e ajuste pela config.** Todo texto ao usuário vai em `messages`; opção de
   comportamento vai em `config` (schema Zod) ou na fábrica do plugin. Nada disso exige editar
   o código.
6. **O contrato tem versão.** Mudar de forma incompatível um serviço ou o tipo de um ponto sobe
   a `version` do dono e a faixa no `dependsOn` de quem depende dele.
7. **Uso opcional = `services.has` na hora do uso.** Quem só se beneficia de outro plugin (o
   `rank` com nomes, se o `user-names` estiver ligado) não declara `dependsOn` e consulta o
   serviço a cada uso, como o `!downloadsticker` no ADR 0001.

Este ADR substitui os itens 2 (o `decorate`), 3 e 5 do ADR 0001: o ponto de extensão entra quando a variação está
prevista no roadmap, não só quando o primeiro consumidor já existe.

## Consequências

- O `sticker` sai do `decorate(step, signal)` próprio para o ponto `sticker.steps` do kernel, e o
  `sticker-text` passa a contribuir nele. O serviço `sticker` perde o `decorate` e sobe de
  versão.
- O `plugin-ai` (M5) chama `reminders`, `sticker` e `userNames` como serviços. Ele não vai
  precisar de acesso ao código desses plugins nem de caminho especial neles.
- Um ponto sem contribuidor externo ainda custa um tipo e uma chamada a `list()`. É o preço de
  não reabrir o dono quando o consumidor chegar.
- Na 0.6 plugin ignorado derruba o boot: o que tem dependência externa opcional (binário) degrada
  no `setup`, com aviso e comando recusando; falha de config ou de capability derruba o boot.
- Ponto de extensão é contrato público entre plugins: o nome e o tipo vão para a doc do plugin.
