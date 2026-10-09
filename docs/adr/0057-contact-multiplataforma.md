# ADR 0057 — `Contact` multiplataforma: `username`, `isBot` e claims verificados

**Status:** Aceito (2026-10-09) · Detalha **D09**
([ADR 0009](0009-modelo-de-mensagem-normalizado.md)) e **D38**
([ADR 0038](0038-filtro-de-eventos-no-kernel.md)) · Parte do kernel multiplataforma
([ADR 0055](0055-plataformas-alvo-e-transport-web.md))

## Contexto

O `Contact` tinha só `id`, `name` e `phone` (#268), o formato de um contato do WhatsApp. Fora
dele faltavam três coisas:

- **`@usuario`.** Telegram e Discord identificam a pessoa por ele, e o roteador vai precisar do
  `username` do `self` para tirar o `@NomeDoBot` de `/cmd@NomeDoBot` (#276).
- **Outros bots no chat.** No Discord e no Telegram há outros bots, e o `ignoreSelf` só descarta
  `fromMe`. Dois bots que respondem um ao outro entram em loop.
- **Quem é o usuário no sistema de origem.** No web, o usuário chega autenticado por um JWT do
  sistema do dono (#287). Papel, escola e empresa precisam chegar ao plugin sem que ele leia o
  objeto nativo pelo `unsafe`.

Alternativas consideradas:

- **Claims no contexto (`ctx.auth`)**, separados do `Contact`. Isso separa a sessão da pessoa,
  mas cada evento que não é mensagem (`reaction`, `message.deleted` e o clique de botão de #275)
  precisaria do seu próprio campo. No `Contact`, o claim vai junto com quem fez a ação, em
  qualquer evento.
- **Claims genéricos por transport** (`Contact<TClaims>`). O genérico contaminaria `Message`, os
  eventos e o contexto inteiros, e um plugin portátil não saberia que tipo esperar.
- **`kind: 'user' | 'bot' | 'chat' | 'anonymous'`** no lugar de `isBot`, cobrindo também o
  `sender_chat` do Telegram (posts de canal e admins anônimos). Hoje só o Telegram usaria os
  dois últimos valores. Um `kind` pode entrar depois sem quebrar a API.
- **`phone` opcional.** Quebraria a API e não ganharia nada: fora do WhatsApp o transport informa
  `null`, e a resposta explícita continua valendo (M1-16.4).

## Decisão

- O `Contact` ganha três campos **opcionais**, preenchidos pelo transport quando a plataforma
  tem a informação:
  - `username?: string`: o `@usuario` sem o `@`.
  - `isBot?: boolean`: conta automatizada. Ausente conta como pessoa.
  - `claims?: Readonly<Record<string, JsonValue>>`: atributos que o transport **verificou**,
    como os claims do JWT do web. São somente leitura para o plugin. Só aparecem no contato que
    fez a ação (o remetente, quem reagiu ou apagou). Nos contatos de `mentions` e de
    participantes, o transport não os tem e deixa o campo ausente.
- `phone` continua obrigatório (`string | null`).
- Middleware oficial **`ignoreBots`**, **ligado por padrão** (`middlewares.ignoreBots: false`
  desliga), com prioridade 990, logo depois do `ignoreSelf`. Ele barra as mensagens e as edições
  com `sender.isBot`. Como o `ignoreSelf` (ADR 0038), também barra os eventos diretos `reaction`
  (`sender.isBot`) e `message.deleted` (`deletedBy.isBot`).
- O `sender_chat` do Telegram fica com o transport: ele monta o `Contact` com o ID e o nome do
  chat.
- O plugin consulta o sistema do dono com credencial de serviço própria, nunca com o token do
  usuário. O transport entrega os claims, não o token.

## Consequências

- Mudança aditiva: um `Contact` só com `id`, `name` e `phone` continua válido, e nenhum
  transport precisa mudar.
- No WhatsApp, o `isBot` não vem preenchido, então o `ignoreBots` ligado não muda nada. Um app
  que precise conversar com outro bot no Discord ou no Telegram desliga a opção.
- Custo por mensagem: uma leitura de campo no `ignoreBots`.
- O kit de testes já aceita `receive({ sender: { phone: null, username, isBot, claims } })`. Os
  perfis por plataforma ficam em #285.
- `claims` é a base do tenant verificado (#278) e da autenticação do `transport-web` (#287).
