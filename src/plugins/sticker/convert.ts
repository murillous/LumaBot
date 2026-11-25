// Conversões da figurinha: Sharp para imagem, FFmpeg para vídeo e animação. Só bytes entram e
// saem; quem decide o que enviar é o plugin.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import webpmux from 'node-webpmux';
import sharp from 'sharp';
import { ffmpeg, withTempDir } from '#plugins/ffmpeg.ts';

export const STICKER_SIZE = 512;
/** Figurinha animada mais pesada que isso chega ao destinatário, mas não baixa. */
export const STICKER_MAX_BYTES = 800 * 1024;
/**
 * Tentativas da figurinha animada, da mais fiel à mais leve, até uma caber em
 * `STICKER_MAX_BYTES`. O `-fs` do FFmpeg não serve de teto: o libwebp entrega a animação de uma
 * vez no fim, e a saída passava de 1 MB com vídeo nítido (os baixados pelo `!download`).
 */
const STICKER_ATTEMPTS = [
  { quality: 75, seconds: 20, fps: 15 },
  { quality: 50, seconds: 10, fps: 15 },
  { quality: 40, seconds: 8, fps: 12 },
  { quality: 30, seconds: 6, fps: 10 },
  { quality: 20, seconds: 4, fps: 10 },
] as const;

/** Nome e autor do pacote que o WhatsApp mostra nos detalhes da figurinha. */
export interface StickerPack {
  readonly name: string;
  readonly author: string;
  /** SHA-256 em base64 do áudio anexado no campo 26 do `StickerMessage` (sound sticker). */
  readonly soundSha256?: string;
}

/** Imagem → PNG 512×512, a tela em que as etapas do serviço desenham. */
export function toStickerImage(image: Buffer): Promise<Buffer> {
  return sharp(image).resize(STICKER_SIZE, STICKER_SIZE, { fit: 'fill' }).png().toBuffer();
}

/** PNG 512×512 → figurinha WebP com o pacote no EXIF. */
export async function encodeSticker(image: Buffer, pack: StickerPack): Promise<Buffer> {
  return withStickerExif(await sharp(image).webp({ quality: 90 }).toBuffer(), pack);
}

/**
 * Vídeo ou GIF → figurinha animada, recortada no centro para 512×512. Falha se nem a tentativa
 * mais leve couber no limite: figurinha que não baixa é pior que o erro.
 */
export async function videoToSticker(
  video: Buffer,
  pack: StickerPack,
  signal: AbortSignal,
): Promise<Buffer> {
  return withStickerExif((await animateVideo(video, signal)).webp, pack);
}

/**
 * Animação WebP ainda sem o EXIF e sua duração real (soma dos atrasos dos quadros). `ms` é 0
 * quando o vídeo não muda: o encoder junta os quadros iguais e entrega um WebP estático.
 */
export interface Animation {
  readonly webp: Buffer;
  readonly ms: number;
}

/** Parâmetros de uma conversão de vídeo em animação WebP. */
export interface Encoding {
  readonly quality: number;
  readonly seconds: number;
  readonly fps: number;
}

/** As tentativas de `STICKER_ATTEMPTS`, da mais fiel à mais leve, até uma caber no limite. */
async function animateVideo(video: Buffer, signal: AbortSignal): Promise<Animation> {
  return withTempDir(async (dir) => {
    const input = join(dir, 'in');
    await writeFile(input, video);
    for (const attempt of STICKER_ATTEMPTS) {
      const webp = await encodeAnimation(input, join(dir, 'out.webp'), attempt, signal);
      if (webp.length <= STICKER_MAX_BYTES) return { webp, ms: (await frames(webp)).ms };
    }
    throw new Error(
      `figurinha animada passa de ${STICKER_MAX_BYTES} bytes mesmo na tentativa mais leve`,
    );
  });
}

/** Qualidades da figurinha com áudio, da melhor à mais leve; cada uma vira uma amostra. */
const FIT_QUALITIES = [50, 30, 15] as const;
/** Quadros por segundo da amostra: barata, e o peso por quadro não depende do fps. */
const PROBE_FPS = 2;
const FIT_MAX_FPS = 15;
/** Abaixo disso a animação engasga: antes de descer daqui, troca-se qualidade por fluidez. */
const FIT_FLUID_FPS = 8;
/** Abaixo disso nem parece vídeo: em vez de descer, encurta. */
const FIT_MIN_FPS = 4;
/** Folga sob o teto: a amostra dá o peso médio por quadro, e o vídeo inteiro varia em torno dele. */
const FIT_BUDGET = Math.floor(STICKER_MAX_BYTES * 0.92);

/** Peso médio por quadro de uma qualidade, medido na amostra. */
export interface Probe {
  readonly quality: number;
  readonly bytesPerFrame: number;
}

/**
 * Escolhe a conversão que mantém `seconds` inteiros dentro do limite. Na ordem: a melhor qualidade
 * que ainda dá `FIT_FLUID_FPS`; senão, o maior fps na qualidade mais leve; e só se nem
 * `FIT_MIN_FPS` couber, encurta. O peso cresce linear com o fps (medido em vídeo de celular), por
 * isso a conta é `orçamento / (bytes por quadro × segundos)`.
 */
export function planFit(probes: readonly Probe[], seconds: number): Encoding {
  const fpsFor = (p: Probe) => Math.floor(FIT_BUDGET / (p.bytesPerFrame * seconds));
  for (const probe of probes) {
    const fps = Math.min(FIT_MAX_FPS, fpsFor(probe));
    if (fps >= FIT_FLUID_FPS) return { quality: probe.quality, fps, seconds };
  }
  const lightest = probes[probes.length - 1];
  if (!lightest) throw new Error('planFit sem amostra');
  const fps = Math.min(FIT_MAX_FPS, fpsFor(lightest));
  if (fps >= FIT_MIN_FPS) return { quality: lightest.quality, fps, seconds };
  const fitting = FIT_BUDGET / (lightest.bytesPerFrame * FIT_MIN_FPS);
  return {
    quality: lightest.quality,
    fps: FIT_MIN_FPS,
    seconds: Math.max(1, Math.floor(fitting * 10) / 10),
  };
}

/**
 * Animação da figurinha com áudio: mantém a duração do vídeo (até `maxSeconds`) e ajusta fps e
 * qualidade ao peso daquele vídeo, para o som tocar inteiro. Mede o peso por quadro em amostras a
 * `PROBE_FPS`, planeja com `planFit` e, se o resultado ainda passar do limite, replaneja com o
 * peso medido nele.
 */
export async function animateToFit(
  video: Buffer,
  signal: AbortSignal,
  maxSeconds: number,
): Promise<Animation> {
  return withTempDir(async (dir) => {
    const input = join(dir, 'in');
    await writeFile(input, video);
    const probes = await Promise.all(
      FIT_QUALITIES.map(async (quality) => {
        const output = join(dir, `probe-${quality}.webp`);
        const probe = { quality, seconds: maxSeconds, fps: PROBE_FPS };
        const webp = await encodeAnimation(input, output, probe, signal);
        const { count, ms } = await frames(webp);
        return { quality, bytesPerFrame: webp.length / count, ms };
      }),
    );
    // A amostra cobre o vídeo inteiro até `maxSeconds`: a duração dela é a do vídeo. Vídeo parado
    // vira WebP estático, sem duração: aí vale o teto, e o quadro único cabe de sobra.
    const probeMs = probes[0]?.ms || maxSeconds * 1000;
    const seconds = Math.min(maxSeconds, probeMs / 1000);
    let plan = planFit(probes, seconds);
    for (let i = 0; i < 3; i++) {
      const webp = await encodeAnimation(input, join(dir, 'out.webp'), plan, signal);
      const { count, ms } = await frames(webp);
      if (webp.length <= STICKER_MAX_BYTES) return { webp, ms };
      plan = planFit([{ quality: plan.quality, bytesPerFrame: webp.length / count }], plan.seconds);
    }
    throw new Error(`figurinha com áudio passa de ${STICKER_MAX_BYTES} bytes mesmo replanejada`);
  });
}

async function encodeAnimation(
  input: string,
  output: string,
  { quality, seconds, fps }: Encoding,
  signal: AbortSignal,
): Promise<Buffer> {
  await ffmpeg(
    [
      '-i',
      input,
      '-t',
      String(seconds),
      '-vf',
      // `start_time=0`: se o vídeo começa depois do áudio (comum em gravação de celular), o
      // primeiro quadro cobre o intervalo, e a animação fica na mesma linha do tempo do som.
      // `gblur` leve tira o detalhe fino (granulado, nitidez exagerada de meme) que pesa no VP8
      // e nem aparece no tamanho em que a figurinha é vista: ~14% a menos no mesmo vídeo. O
      // `hqdn3d` ficou de fora porque apaga a transparência.
      `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=increase,crop=${STICKER_SIZE}:${STICKER_SIZE},fps=${fps}:start_time=0,gblur=sigma=0.8`,
      // `libwebp_anim` (WebPAnimEncoder) só regrava a parte do quadro que mudou, e junta quadros
      // iguais: mais ~14% a menos que o `libwebp`, que grava cada quadro inteiro.
      '-c:v',
      'libwebp_anim',
      '-quality',
      String(quality),
      '-loop',
      '0',
      '-an',
      output,
    ],
    signal,
  );
  return readFile(output);
}

/** Quadros da animação e duração real (soma dos atrasos); WebP estático dá 1 quadro e 0 ms. */
async function frames(webp: Buffer): Promise<{ count: number; ms: number }> {
  const { pages = 1, delay = [] } = await sharp(webp, { animated: true }).metadata();
  return { count: pages, ms: delay.reduce((total, d) => total + d, 0) };
}

/**
 * O WhatsApp lê nome e autor do pacote num JSON dentro do chunk EXIF do WebP, na tag 0x5741
 * de um IFD de uma entrada só.
 */
export async function withStickerExif(webp: Buffer, pack: StickerPack): Promise<Buffer> {
  const json = Buffer.from(
    JSON.stringify({
      'sticker-pack-id': 'com.luma.bot',
      'sticker-pack-name': pack.name,
      'sticker-pack-publisher': pack.author,
      ...(pack.soundSha256 ? { 'sound-sha256': pack.soundSha256 } : {}),
    }),
  );
  // Cabeçalho TIFF little-endian, 1 entrada: tag 0x5741, tipo UNDEFINED (7), tamanho do JSON
  // (offset 14) e o JSON logo depois, no offset 22.
  const header = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  header.writeUInt32LE(json.length, 14);
  const image = new webpmux.Image();
  await image.load(webp);
  image.exif = Buffer.concat([header, json]);
  return image.save(null);
}
