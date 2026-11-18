import { defineLogEvent, definePlugin, type PluginDefinition, secret } from '@usebridger/core';
import { z } from 'zod';
import type { AiProvider } from './ai.ts';

/** O que o provider faz com a chave em mãos: os modelos e, se tiver, a busca nativa. */
export type KeyedModels = Pick<AiProvider, 'languageModel' | 'imageModel' | 'nativeSearch'>;

export interface KeyProviderSpec {
  /** Nome do plugin: `ai-google`. */
  readonly plugin: string;
  readonly version: string;
  /** O que o catálogo mostra mesmo sem chave, para a tela da IA pedir a chave. */
  readonly provider: Pick<AiProvider, 'name' | 'label' | 'models' | 'temperature'>;
  readonly create: (apiKey: string) => KeyedModels;
}

/** O campo secreto da config: o mesmo em todo provider por chave, para a tela gravar sem saber qual. */
const KEY_PATH = 'key';

/**
 * Plugin de um provider que só precisa de uma chave de API (Google, OpenAI...). Contribui em
 * `ai.providers` com a chave da própria config ou, sem ela, com a que o `ai` ainda guarda em
 * `ai.keys.<nome>` (o legado de quando os providers eram embutidos). Sem nenhuma, o provider
 * entra só no catálogo, marcado sem chave, e a cadeia o pula.
 */
export function keyProvider(spec: KeyProviderSpec): PluginDefinition {
  const noKey = defineLogEvent({
    name: `${spec.plugin}.key.missing`,
    level: 'info',
    message: `${spec.provider.name} sem chave: provider fora da cadeia`,
  });
  return definePlugin({
    name: spec.plugin,
    version: spec.version,
    engine: '<1.0.0',
    dependsOn: { ai: '^0.1.0' },
    config: z.object({ key: secret(z.string().min(1)).optional() }),
    setup: (ctx) => {
      const key = ctx.config.key ?? ctx.services.get('ai').legacyKey(spec.provider.name);
      const field = { plugin: spec.plugin, path: KEY_PATH, configured: key !== undefined };
      if (key === undefined) {
        ctx.log.event(noKey);
        ctx.services.contribute('ai.providers', {
          ...spec.provider,
          key: field,
          // O `ai` não chama provider sem chave; se alguém chamar, o motivo fica claro.
          languageModel: () => {
            throw new Error(`${spec.plugin} sem chave`);
          },
        });
        return;
      }
      ctx.services.contribute('ai.providers', {
        ...spec.provider,
        ...spec.create(key),
        key: field,
      });
    },
  });
}
