import { definePlugin, type PluginDefinition, secret } from '@usebridger/core';
import { APICallError, type ImageModel } from 'ai';
import sharp from 'sharp';
import { z } from 'zod';
import { CLOUDFLARE_DISABLED } from './log-events.ts';

type ImageModelV4 = Extract<ImageModel, { specificationVersion: 'v4' }>;
type CallOptions = Parameters<ImageModelV4['doGenerate']>[0];

export interface CloudflareCredentials {
  readonly accountId: string;
  readonly apiToken: string;
}

/** Os FLUX.2 do Workers AI só aceitam imagem de referência menor que 512×512. */
const MAX_INPUT_SIDE = 511;
/** Até quatro referências (`input_image_0` a `input_image_3`). */
const MAX_INPUTS = 4;
/** Saída quando quem chama não pede tamanho: o da figurinha, e o mais barato no Cloudflare. */
const DEFAULT_SIZE = '512x512';

/** `flux-2-klein-4b` → `@cf/black-forest-labs/flux-2-klein-4b`; o id completo passa como veio. */
export function modelPath(modelId: string): string {
  return modelId.startsWith('@') ? modelId : `@cf/black-forest-labs/${modelId}`;
}

/** Código do Workers AI para entrada ou saída barrada pelo filtro de conteúdo. */
const FLAGGED_CODE = 3030;

/** O `errors` da resposta de erro; corpo que não é JSON (página de erro do proxy) não tem. */
function errorsOf(body: string): { code?: number; message?: string }[] {
  try {
    return (JSON.parse(body) as { errors?: { code?: number; message?: string }[] }).errors ?? [];
  } catch {
    return [];
  }
}

/** O erro é o filtro de conteúdo do Cloudflare (`3030 ... has been flagged`). */
function isFlagged(status: number, body: string): boolean {
  return status === 400 && errorsOf(body).some((e) => e.code === FLAGGED_CODE);
}

/** As mensagens do `errors` da resposta de erro; sem elas, o começo do corpo. */
export function reasonOf(body: string): string {
  const reasons = errorsOf(body).map((e) => `${e.code ?? '?'} ${e.message ?? ''}`.trim());
  return reasons.length > 0 ? reasons.join('; ') : body.slice(0, 300);
}

/**
 * Modelo de imagem do Workers AI pela API REST (multipart, resposta com a imagem em base64). O AI
 * SDK não tem provider do Cloudflare que funcione fora de um Worker, por isso o adaptador.
 */
export function cloudflareImageModel(
  modelId: string,
  credentials: CloudflareCredentials,
): ImageModelV4 {
  const url = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/ai/run/${modelPath(modelId)}`;
  return {
    specificationVersion: 'v4',
    provider: 'cloudflare',
    modelId,
    maxImagesPerCall: 1,
    supportsFileInputs: true,
    async doGenerate({ prompt, files, size, seed, abortSignal }: CallOptions) {
      const [width = '512', height = '512'] = (size ?? DEFAULT_SIZE).split('x');
      const inputs = await Promise.all(
        (files ?? []).slice(0, MAX_INPUTS).map(async (file) => {
          if (file.type !== 'file') throw new Error('o Cloudflare só recebe a imagem em bytes');
          const data = typeof file.data === 'string' ? Buffer.from(file.data, 'base64') : file.data;
          return sharp(data)
            .resize({ width: MAX_INPUT_SIDE, height: MAX_INPUT_SIDE, fit: 'inside' })
            .png()
            .toBuffer();
        }),
      );
      // O FormData é consumido no envio: cada tentativa monta o seu.
      const post = (attemptSeed: number | undefined) => {
        const form = new FormData();
        form.append('prompt', prompt ?? '');
        form.append('width', width);
        form.append('height', height);
        if (attemptSeed !== undefined) form.append('seed', String(attemptSeed));
        for (const [i, png] of inputs.entries()) {
          form.append(`input_image_${i}`, new Blob([new Uint8Array(png)], { type: 'image/png' }));
        }
        return fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${credentials.apiToken}` },
          body: form,
          ...(abortSignal && { signal: abortSignal }),
        });
      };

      let response = await post(seed);
      let body = await response.text();
      // O filtro olha a imagem gerada, que muda com a seed: sem seed pedida, vale uma segunda
      // geração antes de desistir.
      if (isFlagged(response.status, body) && seed === undefined) {
        response = await post(Math.floor(Math.random() * 2 ** 31));
        body = await response.text();
      }
      if (!response.ok) {
        const flagged = isFlagged(response.status, body);
        // APICallError para quem percorre a cadeia ler o status (429 = cota do dia acabou) e o
        // `data.flagged` (o filtro de conteúdo recusou), que `isContentFlagged` reconhece.
        throw new APICallError({
          // O motivo vem no `errors` do corpo; no texto, ele aparece no log com o erro.
          message: `Cloudflare respondeu ${response.status}: ${reasonOf(body)}`,
          url,
          requestBodyValues: { prompt, width, height },
          statusCode: response.status,
          responseBody: body,
          isRetryable: response.status === 429 || response.status >= 500,
          data: { flagged },
        });
      }
      const json = JSON.parse(body) as { result?: { image?: unknown }; image?: unknown };
      // A doc mostra `image` no schema do modelo, e a API REST costuma envelopar em `result`.
      const image = json.result?.image ?? json.image;
      if (typeof image !== 'string') throw new Error('o Cloudflare respondeu sem imagem');
      return {
        images: [image],
        warnings: [],
        response: {
          timestamp: new Date(),
          modelId,
          headers: Object.fromEntries(response.headers),
        },
      };
    },
  };
}

const config = z.object({
  /** ID da conta Cloudflare (painel → Workers AI → "Use REST API"). */
  accountId: z.string().min(1).optional(),
  /** Token com a permissão "Workers AI". */
  apiToken: secret(z.string().min(1)).optional(),
});

/**
 * Provider `cloudflare` no ponto `ai.providers`: só modelos de imagem (FLUX.2 do Workers AI), que
 * o `sticker-edit` usa. No plano grátis são 10.000 neurons por dia; acabou, a API recusa em vez de
 * cobrar. Sem conta e token, não contribui nada.
 */
export const cloudflareAi: PluginDefinition = definePlugin({
  name: 'cloudflare-ai',
  version: '0.1.0',
  engine: '<1.0.0',
  dependsOn: { ai: '^0.1.0' },
  config,
  setup: (ctx) => {
    const { accountId, apiToken } = ctx.config;
    if (!accountId || !apiToken) {
      ctx.log.event(CLOUDFLARE_DISABLED);
      return;
    }
    ctx.services.contribute('ai.providers', {
      name: 'cloudflare',
      label: 'Cloudflare',
      // Na cadeia de texto, o item `cloudflare:` falha com a causa em vez de sumir.
      languageModel: () => {
        throw new Error('o provider cloudflare só tem modelos de imagem');
      },
      imageModel: (id) => cloudflareImageModel(id, { accountId, apiToken }),
    });
  },
});
