# Ações e botões

A resposta pode levar botões. O clique roda um comando ou um passo de conversa do plugin, e o
transport sem botões recebe o menu em texto numerado
([ADR 0062](../../../docs/adr/0062-acoes-e-botoes.md)).

## Uso

```ts
setup(ctx) {
  ctx.commands.add(
    command({
      name: 'menu',
      run: (c) =>
        c.reply('O que você quer ver?', {
          actions: [
            { label: 'Notas', command: 'notas', args: [c.message.sender.id] },
            { label: 'Escolher bimestre', step: 'bimestre', data: { ano: 2026 } },
          ],
        }),
    }),
  );

  ctx.conversations.define('bimestre', (c) => {
    const { ano } = c.data as { ano: number };
    return c.reply(`Bimestres de ${ano}`);
  });
}
```

`actions` existe em `ctx.reply(text, options)` e em `ctx.reply.text`. Cada ação é uma de duas:

| Ação | O clique |
| --- | --- |
| `{ label, command, args? }` | Roda o comando (nome ou alias, de qualquer plugin) com `ctx.args` igual a `args`, e `ctx.rawArgs` igual a `args` unido por espaços |
| `{ label, step, data? }` | Roda o passo do plugin (ver [Conversas](conversations.md)) com `ctx.data` igual a `data` |

## O clique é o comando

O clique entra na fila do chat e passa pelos middlewares, como uma mensagem de texto com o
`label` como texto. Daí em diante, o caminho é o do comando digitado:

- o papel e o `accepts` são checados para **quem clicou**, e a recusa responde pelo `onReject`;
- o comando emite o evento `command`, e a falha sai em `plugin.error`;
- o `rateLimit`, o `chatFilter` e o `ignoreBots` valem para o clique;
- o clique cancela a resposta esperada de quem clicou, como um comando digitado.

O passo roda como numa resposta esperada: com o prazo do comando, e a falha sai em
`plugin.error` com `phase: 'step'`. O `ctx.reply` cita a mensagem do clique, e o transport decide
como responder à interação.

## Erros

`label` vazio, comando não registrado ou passo que o plugin não definiu fazem o `reply` rejeitar
com `TypeError`, sem enviar nada. Uma ação de passo fora de um plugin (num middleware do app)
também rejeita, porque o passo é sempre do plugin.

## Validade

O botão leva só um ID opaco. O kernel guarda o alvo em memória, preso ao chat, e o cliente não
forja um clique com outro comando ou outros argumentos.

- O botão vale **24 horas** e pode ser clicado mais de uma vez.
- Ele aponta para o nome do comando ou do passo, então continua valendo depois do reload do
  plugin. Um restart do processo o perde.
- O kernel guarda no máximo 10.000 botões e descarta os mais antigos.
- Clique vencido, desconhecido, de outro chat, ou num comando ou passo que não existe mais é
  descartado, com uma linha em `debug`. O transport já confirmou o clique, e o usuário não recebe
  resposta.

## Sem botões: menu numerado

Sem a capability `actions` (no Baileys, por exemplo), ou com mais ações do que o
`limits.actions` do transport, o kernel acrescenta o menu ao texto:

```
O que você quer ver?

1. Notas
2. Escolher bimestre
```

e registra uma [resposta esperada](conversations.md) para o remetente da mensagem respondida, com
a validade padrão de 5 minutos:

- "1" ou "2" (com espaços em volta) roda a ação, como o clique;
- outro texto segue o fluxo normal (comando, listeners de `message`), e o menu deixa de valer;
- um comando digitado cancela o menu e roda;
- outra espera do mesmo remetente no chat substitui o menu.

Só quem recebeu a resposta escolhe pelo número. Num grupo com botões, qualquer pessoa clica, e o
papel do comando decide.

## Para o transport

O lado do adapter (capability, `SendOptions.actions`, `limits.actions` e o evento
`interaction`) está em [Transport](transport.md#botões).
