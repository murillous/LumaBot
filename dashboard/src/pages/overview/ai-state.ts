import type { paths } from '#lib/api-types.d.ts';

export type ModelStatus =
  paths['/api/plugins/ai/status']['get']['responses'][200]['content']['application/json']['models'][number];

/** Quantos segundos faltam até `until`; o `ai/status` manda o fim do cooldown em ISO. */
export const secondsUntil = (until: string): number =>
  Math.max(0, Math.ceil((Date.parse(until) - Date.now()) / 1000));
