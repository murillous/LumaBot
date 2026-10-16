# Paridade com o legacy

O que o `legacy/` faz e o plugin do `apps/lumabot` que assume cada item. A paridade fecha quando
tudo estiver marcado: aí o app substitui o legacy em produção.

Marque o item no PR que entrega o plugin. Levantada do LumaBot v1.5.0
(`src/config/constants.js`, plugins e docs); veio da seção 10 do
[`BRIDGER_PLAN.md`](https://github.com/murillous/usebridger/blob/develop/BRIDGER_PLAN.md#10-checklist-de-paridade-com-o-legacy)
e agora vive aqui.

## Plugins do app

| | Funcionalidade legacy | Plugin |
|---|---|---|
| [x] | `!sticker` / `!s` (imagem/vídeo/link → figurinha) | [sticker](apps/lumabot/docs/sticker.md) |
| [x] | `!image` / `!i` (figurinha → imagem) | [sticker-convert](apps/lumabot/docs/sticker-convert.md) |
| [x] | `!gif` / `!g` (figurinha animada → vídeo) | [sticker-convert](apps/lumabot/docs/sticker-convert.md) |
| [x] | `!pdf` (imagem → PDF, com nome opcional) | [pdf](apps/lumabot/docs/pdf.md) |
| [x] | `!mergepdf` / `!joinpdf` (acumula PDFs; `done <nome>`; `clear`) | [pdf](apps/lumabot/docs/pdf.md) |
| [x] | `!download` / `!d` (vídeo Twitter/X, Instagram) | [download](apps/lumabot/docs/download.md) |
| [x] | Envio de fotos baixadas e recodificação compacta do vídeo (PR #28) | [download](apps/lumabot/docs/download.md) |
| [x] | `!audio` / `!a` (MP3 de link de site conhecido pelo yt-dlp) | [download](apps/lumabot/docs/download.md) |
| [ ] | `@everyone` / `@todos` | everyone |
| [x] | `!help` / `!menu` | [help](apps/lumabot/docs/help.md) |
| [x] | `!meunumero` / `!meuid` | [utils](apps/lumabot/docs/utils.md) |
| [x] | `!nick Nome`, `!nick @pessoa Nome`, `!apelido` | [user-names](apps/lumabot/docs/user-names.md) |
| [x] | Enriquecimento de usuários (pushName, contatos, LID) | [user-names](apps/lumabot/docs/user-names.md) |
| [x] | `!lembrete` / `!lembrar`, `!lembretes`, `!cancelarlembrete <n>` + disparo agendado com menção | reminders ([doc](apps/lumabot/docs/reminders.md)) |
| [ ] | `!rank`, `!rank global` (sem dado até o `ai` chamar `record`) | [rank](apps/lumabot/docs/rank.md) |
| [ ] | `!resumo [n]` | resumo |
| [ ] | IA em PV, quando citada ou por trigger ("Luma, ...") | ai |
| [ ] | Personas: `!persona` (menu pN), `!persona criar <descrição>`, `!persona deletar pN`, limite 10 por chat | ai |
| [ ] | Contexto multi-turno | ai |
| [ ] | Tool calling (sticker, @todos, lembrete etc. pela IA) | ai |
| [ ] | Busca web (Tavily / Google Grounding) | ai |
| [ ] | Transcrição de áudio | ai |
| [ ] | `!luma clear` / `!lc` / `!clear`, `!luma stats` / `!ls` | ai |
| [ ] | Interações espontâneas em grupo | spontaneous |
| [ ] | Dashboard: QR, status, logs, config, deploy | dashboard |

## Do Bridger

Vêm prontos dos pacotes `@usebridger/*`; marque quando o app os usar.

| | Funcionalidade legacy | Onde |
|---|---|---|
| [ ] | Textos de UI customizáveis via overrides (`ConfigStore`) | core (`messages` dos plugins) |
| [ ] | Rate limit de entrada, ignorar a si mesmo, sanitização | core (middlewares) |
| [x] | Reconexão automática | core + transport-baileys |
