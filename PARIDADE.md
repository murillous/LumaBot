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
| [x] | `!sticker` / `!s` (imagem/vídeo/link → figurinha) | [media](apps/lumabot/docs/media.md) |
| [x] | `!image` / `!i` (figurinha → imagem) | [media](apps/lumabot/docs/media.md) |
| [x] | `!gif` / `!g` (figurinha animada → vídeo) | [media](apps/lumabot/docs/media.md) |
| [x] | `!pdf` (imagem → PDF, com nome opcional) | [media](apps/lumabot/docs/media.md) |
| [x] | `!mergepdf` / `!joinpdf` (acumula PDFs; `done <nome>`; `clear`) | [media](apps/lumabot/docs/media.md) |
| [ ] | `!download` / `!d` (vídeo Twitter/X, Instagram) | download |
| [ ] | Envio de fotos baixadas e recodificação compacta do vídeo (PR #28) | download |
| [ ] | `!audio` / `!a` (MP3 de qualquer link, yt-dlp) | download |
| [ ] | `@everyone` / `@todos` | everyone |
| [ ] | `!help` / `!menu` | help |
| [ ] | `!meunumero` | utils |
| [ ] | `!nick Nome`, `!nick @pessoa Nome`, `!apelido` | user-names |
| [ ] | Enriquecimento de usuários (pushName, contatos, LID) | user-names |
| [ ] | `!lembrete` / `!lembrar`, `!lembretes`, `!cancelarlembrete <n>` + disparo agendado com menção | reminders |
| [ ] | `!rank`, `!rank global` | rank |
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
