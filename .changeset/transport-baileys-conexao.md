---
'@zapforge/transport-baileys': minor
---

Novo pacote: transport do WhatsApp sobre o Baileys (#103). `baileys({ pairing, version })`
devolve a fábrica para `createBot({ transport })`. Conecta, pareia por QR (`connection.qr`) ou por
código (`pairing: { phone }`, `connection.pairing-code`), guarda as credenciais no auth state do
storage do bot e informa cada queda com o motivo normalizado; a reconexão fica com o bot. Envio e
recebimento de mensagens ainda não: as ações lançam `UnsupportedError`.
