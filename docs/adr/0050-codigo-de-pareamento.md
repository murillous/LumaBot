# ADR 0050 — Código de pareamento chega por evento, como o QR

**Status:** Aceito (2026-10-07) · Detalha **D03** ([ADR 0003](0003-transport-abstrato.md)) e
**D13** ([ADR 0013](0013-escopo-do-core.md))

## Contexto

O escopo do core inclui parear por QR **e** por código (D13). O WhatsApp aceita as duas formas:
escanear o QR ou digitar no aparelho um código de 8 caracteres ("conectar com número de
telefone"). O contrato do `Transport` só tinha `connection.qr`, então o adapter Baileys (#103) não
tinha como entregar o código ao app nem a um plugin. Quem desenha a tela de pareamento (o
`plugin-dashboard`, D21) recebe o QR pelo barramento e precisa receber o código do mesmo jeito.

Alternativas consideradas:

- **Callback na opção do adapter** (`baileys({ pairing: { phone, onCode } })`): só o app vê o
  código. O dashboard, que é plugin, ficaria sem ele, e o limite de QRs da reconexão não o
  contaria.
- **Reaproveitar `connection.qr`** com um campo que diga o tipo: muda o payload de um evento
  público, e todo listener de QR passaria a receber algo que não é QR.

## Decisão

- Evento novo do transport, `connection.pairing-code`, com payload `{ code }`.
- O `Bot` o trata como o `connection.qr`: conta para o `maxQrCount` da política de reconexão
  (pedir um código é uma tentativa de pareamento, como mostrar um QR), loga em `info` só o aviso
  e em `debug` o valor, e repassa ao barramento.
- O transport pareando por código emite o código e não emite `connection.qr`.

## Consequências

- O app ou um plugin exibe o código pelo barramento, como faz com o QR.
- Um código que expira sem uso termina em `qr-timeout`, com a mesma política do QR: novo código
  até o limite e, depois, `clean-session` (`qr-limit`).
- `TransportEvents` ganha um evento: só por adição, sem quebrar adapter nem listener existente.
