# ADR 0061 — Texto formatado neutro, menções portáteis e limites de tamanho

**Status:** Aceito (2026-10-09) · Detalha **D09** ([ADR 0009](0009-modelo-de-mensagem-normalizado.md))
e **D19** ([ADR 0019](0019-fila-de-saida-anti-ban.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O conteúdo de texto era `{ type: 'text', text }`, uma string que o transport enviava como veio
(#273). Os plugins escreviam a marcação do WhatsApp (`*negrito*`), que não vale nas outras
plataformas:

- O Discord usa Markdown (`**negrito**`) e conta a marcação no limite de 2000 caracteres.
- O Telegram exige `parse_mode` com escape obrigatório. Sem ele, a marcação sai literal, e com
  escape errado a API devolve 400. O limite é de 4096 caracteres de texto e 1024 de legenda.
- O web renderiza HTML, e um texto sem escape abre XSS.

A menção também não era portátil. `SendOptions.mentions` leva IDs, e o transport do WhatsApp
precisa do `@número` no texto. O Discord quer `<@id>`, e o Telegram, uma entity com offset. No
Discord, toda resposta com citação ainda pinga o autor por padrão.

Nada no core conhecia os limites. Uma resposta longa virava 400, e a fila tentava de novo.

Alternativas consideradas:

- **String com marcadores privados** (caracteres de uso privado do Unicode). É barata de
  concatenar, mas um texto do usuário com esses caracteres vira marcação. Quem não passa pelo
  transport (log, storage) também veria lixo.
- **Subconjunto de Markdown como formato neutro.** É mais simples para o autor, mas cada
  transport precisaria de parser e escape. Foi descartado como padrão na sessão de 2026-10-08.
- **Opção `ping` no `reply`.** Não há caso concreto hoje para pingar o autor da citação.
- **Dividir só no `reply`.** O `ctx.send.send` longo continuaria falhando com 400.
- **Dividir no transport.** Cada transport repetiria o algoritmo. Um retry da fila também
  reenviaria todas as partes.
- **`Message.formatted` com as entities da entrada.** Seria mais contrato para manter, sem
  consumidor hoje.

## Decisão

- **Formato neutro em árvore.** `bold`, `italic`, `code`, `link` e `mention` devolvem um
  `FormattedText`, uma árvore mínima e congelada. A tag `fmt` os compõe:
  `` fmt`Notas de ${bold(aluno)}` ``. Um texto interpolado é literal, e o transport o escapa.
  `plainText` dá o texto visível, sem marcação.
- **Texto cru continua cru.** O que o plugin usa aceita `MessageText = string | FormattedText`:
  `ctx.reply`, a legenda, `ctx.send.edit` e `ctx.send.send`, que também aceita o texto direto
  no lugar do conteúdo. A string vai ao transport como veio, para os plugins de uma plataforma
  só. Quem não usa a árvore paga um `typeof` por envio.
- **O transport renderiza, se souber.** O conteúdo continua com `text` (e `caption`) em string,
  e ganha os campos opcionais `formatted` (e `formattedCaption`). Com a árvore, o core preenche
  `text` com o `plainText` dela. O `Transport.edit` ganha o parâmetro opcional `formatted`. Quem
  conhece o campo traduz a árvore para a marcação da plataforma, com o escape dela. Quem não
  conhece envia o `text`, o texto visível, e o envio não falha. Por isso não há capability nova:
  o plugin não tem o que exigir.
- **Menção é um nó.** `mention(contato)` guarda o contato, e o transport põe a sintaxe dele
  (`@número` no WhatsApp, `<@id>` no Discord, `text_mention` no Telegram). O transport notifica
  **só** quem está num `mention()` ou em `mentions`. A citação não pinga o autor, e não há opção
  nova. `ReplyOptions.mentions` continua valendo para o texto cru.
- **Limites declarados pelo transport.** O campo opcional `Transport.limits` tem `text`,
  `caption` e `measure`. O `measure` existe para a plataforma que conta a marcação (Discord). Sem
  ele, a medida é o comprimento do texto visível. Sem `limits`, nada é dividido.
- **A fila divide.** No `send` (o que cobre `ctx.reply` e `ctx.send.send`), um texto acima do
  limite vira várias partes:
  - O corte procura um parágrafo, depois uma linha, depois um espaço e, por último, um caractere
    (sem partir um par surrogate). Um nó partido continua formatado nas duas partes.
  - Cada parte é um envio, com intervalo, presença e retry próprios. A parte seguinte sai na
    frente do chat, então outro envio não se intromete. Um retry repete só a parte que falhou.
  - Só a primeira parte cita a mensagem. As `mentions` vão em todas.
  - A promise resolve, depois da última parte, com a chave da **primeira**. Se uma parte falha,
    as seguintes não saem, e a promise rejeita com o erro.
  - Uma legenda longa sai com o começo na mídia e o resto em mensagens de texto.
  - O `edit` não divide: acima do limite, rejeita com `RangeError` antes de enfileirar.
- **Entrada como texto visível.** O transport entrega `Message.text` como a pessoa o vê (no
  Discord, `<@123>` vira `@nome`) e põe os mencionados em `message.mentions`. As entities não
  entram na `Message`.

## Consequências

- Mudança aditiva: campos opcionais no `OutgoingContent` (`formatted`, `formattedCaption`), no
  `Transport` (`limits`) e no `Transport.edit` (`formatted`); parâmetros do plugin alargados para
  `MessageText`; exports novos (`bold`, `code`, `fmt`, `italic`, `link`, `mention`,
  `plainText` e os tipos). Um transport existente continua funcionando, com texto sem marcação.
- Alternativa descartada na implementação: trocar o tipo de `OutgoingContent.text` por
  `MessageText`. Quebraria todo transport e todo teste que lê o texto enviado, sem ganho sobre o
  campo opcional.
- O `sanitize` continua limitando a entrada (4096 por padrão). Ele protege a CPU, não a
  plataforma, e não sabe do transport.
- Custo: no caminho quente de entrada, nenhum. No envio, um `typeof` sem `limits`. Com `limits` e
  texto cru, um `length`. A árvore é percorrida só no envio de quem a usa.
- O transport web (M3) escapa o HTML do texto da árvore e trata a string crua como texto, nunca
  como HTML.
- `Message.formatted` pode entrar depois, de forma aditiva, quando um plugin precisar da marcação
  da entrada.
