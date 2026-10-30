import type { paths } from '#lib/api-types.d.ts';

export type ModelStatus =
  paths['/api/plugins/ai/status']['get']['responses'][200]['content']['application/json']['models'][number];

/**
 * Intervalo da releitura do `ai/status`: o cooldown acaba sozinho no servidor, então relê a cada
 * 5 s enquanto houver modelo em espera.
 */
export const cooldownRefetch = (data?: { models: readonly ModelStatus[] }): number | false =>
  data?.models.some((m) => m.state === 'cooldown') ? 5000 : false;

/** Quantos segundos faltam até `until`; o `ai/status` manda o fim do cooldown em ISO. */
export const secondsUntil = (until: string): number =>
  Math.max(0, Math.ceil((Date.parse(until) - Date.now()) / 1000));
