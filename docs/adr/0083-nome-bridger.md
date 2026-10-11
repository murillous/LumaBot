# ADR 0083 — Nome: Bridger, no escopo `@usebridger`

**Status:** Aceito (2026-10-10) · Substitui o **D31** ([ADR 0031](0031-nome-do-kernel.md)) ·
Fecha a #290

## Contexto

O kernel atende WhatsApp, Discord, Telegram e sistemas web próprios, e o público de Discord e
Telegram é global. O nome do D31 fazia referência ao WhatsApp e sugeria uma plataforma só
(#290). Trocar depois do primeiro publish no npm custaria o escopo, o repositório e as docs; o
release (D82) ainda não publicou nada.

O nome escolhido, **Bridger**, não está livre no npm: o pacote `bridger` e a org `bridger` já
têm dono.

Alternativas de escopo consideradas: `@bridger-js`, `@bridgerhq`, `@getbridger` e `@bridgerjs`
(este com o pacote `bridgerjs` sem escopo de outro dono, o que confunde).

## Decisão

- O projeto se chama **Bridger**: o kernel é a ponte entre o bot e cada plataforma.
- Os pacotes ficam no escopo **`@usebridger/*`**, no padrão `use*` comum no npm. O nome do
  projeto e o do escopo não precisam coincidir.
- O scaffold de plugin é o **`create-bridger-plugin`**, sem escopo, para que
  `npm create bridger-plugin` funcione. Os plugins seguem o prefixo `bridger-plugin-`.
- O que o kernel expõe com o nome segue o mesmo: variáveis de ambiente com prefixo `BRIDGER_`,
  anotação `x-bridger-override` no JSON Schema da config e schema Postgres `bridger` por
  padrão.

## Consequências

- Nenhum pacote foi publicado com o nome antigo, então a troca não quebra quem instala.
- A org `usebridger` e o pacote `create-bridger-plugin` precisam ser reservados no npm antes do
  primeiro publish (D82).
- O código, as docs e o plano não citam mais o nome antigo; ele fica só no histórico do Git.
