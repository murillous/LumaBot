# ADR 0037 — Transport recebe as dependências do bot por fábrica

**Status:** Aceito (2026-10-07) · Detalha a decisão **D03** ([ADR 0003](0003-transport-abstrato.md))

## Contexto

O transport do Baileys precisa de coisas que pertencem ao bot: o auth state da sessão
(`storage.authState(session)`, ADR 0014/0036) e o logger, que censura segredos (ADR 0032). Hoje
`BotConfig.transport` recebe uma instância pronta, então o app teria de ligar tudo à mão e
repetir a sessão em três lugares (no transport, no `reconnection.clearSession` e no storage).
Isso contraria o ADR 0034: quem monta o app não deveria conhecer o miolo do kernel.

Alternativas consideradas: método opcional `attach(deps)` no `Transport`, chamado no `start()`
(inicialização em duas fases, com um estado "meio pronto" e risco de o adapter esquecer de
implementar); ligação manual pelo app (o que existe hoje).

## Decisão

- `BotConfig.transport` aceita **uma fábrica ou uma instância**:
  `Transport | ((deps: TransportDeps) => Transport)`.
- `TransportDeps` traz o que o bot fornece: `session`, `auth` (o `AuthStateStore` da sessão) e
  `log` (logger filho com o nome do transport). Campos novos só entram por adição.
- O `createBot` chama a fábrica uma vez, de forma síncrona e sem I/O: a fábrica só monta o
  objeto; a conexão continua começando no `connect()`. Assim o `createBot` segue sem efeito
  colateral (ADR 0004).
- Os adapters oficiais devolvem a fábrica (`baileys({ pairing: 'qr' })`). A instância pronta
  continua aceita para testes e adapters simples que não precisam do bot.
- Com a fábrica, o kernel conhece o auth state: a decisão `clean-session` da reconexão limpa
  `auth` sozinha. `reconnection.clearSession` vira override opcional.

## Consequências

- O app escreve `transport: baileys({...})` e `storage: sqlite({...})` sem ligar um ao outro.
- O adapter loga pelo logger do bot, com os segredos censurados.
- Os testes que passam uma instância (`new RecordingTransport()`) seguem válidos sem mudança.
- `TransportDeps` vira contrato de adapter: fica na entrada `@zapforge/core/adapter` (ADR 0034).
