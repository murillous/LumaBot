---
'@zapforge/transport-web': minor
---

Pacote novo (ADR 0077): transport para o chatbot dentro de um sistema web próprio. A fábrica
`web({ auth, tenantClaim?, origins?, media? })` registra as rotas do transport no HTTP do core
(`GET /chat` em WebSocket, `POST /media`, `GET /media/:id`) e exige `http` no `createBot`. O widget
se autentica com o JWT do sistema do dono no primeiro frame, validado pelo `jose` (`HS256` com
segredo ou JWKS), e a conexão fecha no `exp`. O `Contact` sai do `sub` com os claims verificados, e
o `tenantClaim` vira `chat.tenantId`. O `chat.id` é por conversa escolhida pelo cliente. O que o bot
envia com o cliente fora espera em memória por até 1 h. Mídia entra por upload com o token e sai por
URL temporária. Capabilities: texto, imagem, vídeo, áudio, documento, download, `actions`,
`quoted`, `typing`, edição e remoção. O cliente de referência fica em
`@zapforge/transport-web/client`.
