# Plugin `download`

Baixa vídeo, foto e áudio de links com o [yt-dlp](https://github.com/yt-dlp/yt-dlp). Código em
`src/plugins/download/`: `download.ts` (comandos) e `yt-dlp.ts` (chamadas ao yt-dlp e ao FFmpeg).
Port do `DownloadPlugin` e do `AudioDownloadPlugin` do legacy.

## Comandos

O link vem depois do comando ou, na falta, da mensagem citada.

| Comando | Saída |
| --- | --- |
| `!download <link>` / `!d` | Vídeo MP4 recodificado; post de foto (Instagram, X) sai como imagem |
| `!audio <link>` / `!a` | MP3 com capa e tags, com o título como nome do arquivo |
| `!downloadsticker <link> [texto]` / `!ds` | O vídeo ou a foto do link como figurinha, feita pelo plugin [`sticker`](sticker.md) |

Enquanto baixa, o bot reage ⏳ e depois ✅ ou ❌; num transport sem `reactions`, a reação é
ignorada. A falha vai
para o log (`falha no download`, com o stderr do yt-dlp) e o chat recebe `downloadError` ou
`audioError`; arquivo acima de 100 MB recebe `tooLarge`.

Cada comando declara no `requires` a capability do que envia (`!download`: `send.video`;
`!audio`: `send.audio`; `!downloadsticker`: `send.sticker`). Sem ela, o comando não é registrado. O `!download` não exige
`send.image`: só depois de baixar se sabe se o link é vídeo ou foto, e exigir as duas tiraria o
comando do transport que envia vídeo mas não imagem. Nele, o post de foto recebe
`imageUnsupported` e ❌.

Os dois rodam fora da fila do chat (`background`): num grupo, as outras mensagens não esperam o
download terminar.

## Figurinha

O `!downloadsticker` baixa como o `!download` e entrega os bytes ao serviço `sticker`
([sticker.md](sticker.md#serviço-sticker)): vídeo vira figurinha animada (os primeiros 20 s,
até 800 KB) e foto vira figurinha estática. O texto depois do link vira legenda na foto se o
`sticker-text` estiver carregado. O pacote no EXIF é o do `sticker`.

O `sticker` é opcional para o `download` (sem `dependsOn`): sem ele, o plugin carrega igual e
só o `!downloadsticker` responde `stickerUnavailable`, sem baixar nada. O comando consulta o
serviço a cada uso, então pega o novo depois de um reload do `sticker`. Falha do yt-dlp
responde `downloadError` (ou `tooLarge`); falha na conversão, depois de baixar, `stickerError`.

## Binários

`yt-dlp` e `ffmpeg` precisam estar no `PATH`. O `setup` roda os dois com `--version`/`-version`:
se um faltar, o bot sobe sem o plugin, e o motivo sai no relatório de boot. O yt-dlp usa o
FFmpeg para juntar vídeo e áudio e para extrair o MP3. Mantenha o yt-dlp atualizado
(`pip install -U yt-dlp` ou o gerenciador de pacotes): os sites mudam e versões velhas param de
baixar. O legacy baixava o binário sozinho na primeira execução; o app não baixa executável em
tempo de execução.

## Recodificação

O vídeo baixado passa pelo FFmpeg em H.264 `preset medium`, CRF 23, `yuv420p` e `faststart`. O
iOS não toca VP9, AV1 nem H.265 pelo WhatsApp, e o `medium` comprime bem mais que o `ultrafast`
no mesmo CRF (o vídeo de teste caiu de 27 MB para 17 MB). Sem `libx264`, o FFmpeg só reposiciona o
índice e mantém o codec. Foto não passa pelo FFmpeg, que a transformaria num MP4 de um quadro.

## Limites e segurança

| O quê | Limite |
| --- | --- |
| Prazo dos comandos | 240 s (download e recodificação) |
| Execuções simultâneas | 2 de cada comando, no bot inteiro (`concurrency`); o excedente espera a vez dentro do prazo |
| Tamanho do arquivo | 100 MB (`--max-filesize`: o yt-dlp nem baixa o que passa disso) |
| Playlist | Só o item do link (`--no-playlist`) |

O extrator genérico do yt-dlp fica desligado (`--use-extractors default,-generic`): só links de
sites que o yt-dlp conhece são baixados. Assim um link para a rede interna do servidor não vira
download (SSRF). Link direto para um arquivo `.mp3` ou `.mp4` também deixa de funcionar.

Cada download roda num diretório temporário próprio (`os.tmpdir()`), apagado ao fim.

## Config

| Variável | Efeito |
| --- | --- |
| `LUMABOT_YTDLP_COOKIES` | Arquivo de cookies (formato Netscape) de um navegador logado, repassado com `--cookies`. Instagram e X pedem login para boa parte do conteúdo |

Os textos ficam em `messages` e a config do bot os sobrescreve (`tooLarge` →
`BRIDGER_DOWNLOAD__MESSAGES__TOO_LARGE`). `{prefix}` nos textos de uso vira o prefixo do chat.

## Diferenças do legacy

- O yt-dlp vem do sistema, sem o download automático do binário.
- Sem o extrator genérico (ver acima).
- As métricas (`videos_downloaded`, `images_downloaded`, `audios_downloaded`) não foram portadas.
- O `!downloadsticker` é novo, não existe no legacy.
