# ADR 0009 — Modelo de mensagem normalizado

**Status:** Aceito (2026-10-06) · Decisão **D09** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

Os plugins do LumaBot leem `bot.raw`, `bot.innerMessage` e a estrutura de mensagem
do Baileys. Cada um resolve de novo a mídia própria × citada e o desempacotamento de
ephemeral/viewOnce/documentWithCaption.

Alternativas consideradas: expor o objeto do Baileys.

## Decisão

O core define um modelo de mensagem normalizado
([plano §6.3](../../ZAPFORGE_PLAN.md#63-modelo-de-mensagem)):

- union discriminada por `msg.type` (`text`, `image`, `video`, `audio`, `voice`,
  `sticker`, `document`, `location`, `contact`, `poll`, `unknown`), com `voice` (PTT)
  separado de `audio`;
- `msg.is()` para estreitar o tipo;
- `msg.quoted` recursivo (mesmo tipo `Message`);
- `media.download()` / `media.stream()` lazy, com cache por mensagem.

## Consequências

- DX tipada; o problema "mídia própria ou citada" é resolvido uma vez só, no core.
- Cada transport precisa mapear o formato nativo para esse modelo.
- O que o modelo não cobre fica no escape hatch ([ADR 0011](0011-escape-hatch-unsafe-native.md)).
