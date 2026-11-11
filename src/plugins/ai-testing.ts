// Peças de teste de quem usa o serviço `ai`: um provider falso e respostas prontas, para os
// testes dos plugins consumidores (`luma`, `resumo`, `spontaneous`...) não repetirem o arranjo.
// Só os testes importam este módulo.

import { definePlugin, type PluginDefinition } from '@usebridger/core';
import { jsonSchema, type ToolSet, tool } from 'ai';
import { MockImageModelV4, MockLanguageModelV4 } from 'ai/test';

interface Usage {
  inputTokens: { total: number; noCache: number; cacheRead: undefined; cacheWrite: undefined };
  outputTokens: { total: number; text: number; reasoning: undefined };
}

/** Resposta do modelo falso: a forma que o `doGenerate` do `MockLanguageModelV4` devolve. */
export interface Answer {
  content: (
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: string }
  )[];
  finishReason: { unified: 'stop' | 'tool-calls'; raw: undefined };
  usage: Usage;
  warnings: never[];
}

const USAGE: Usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

/** Resposta de texto do modelo falso. */
export const textAnswer = (text: string): Answer => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});

/** O modelo pede uma tool (e, opcionalmente, diz algo antes). */
export const toolAnswer = (name: string, input: unknown, text = ''): Answer => ({
  content: [
    ...(text ? [{ type: 'text' as const, text }] : []),
    {
      type: 'tool-call' as const,
      toolCallId: `call-${name}`,
      toolName: name,
      input: JSON.stringify(input),
    },
  ],
  finishReason: { unified: 'tool-calls' as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});

type Step = Answer | Error | string;

/**
 * Modelo falso que responde, em ordem, uma resposta por chamada; a última se repete. `string` vira
 * resposta de texto e `Error` é lançado.
 */
export function scripted(...steps: Step[]): MockLanguageModelV4 {
  let i = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const step = steps[Math.min(i++, steps.length - 1)];
      if (step instanceof Error) throw step;
      return typeof step === 'string' ? textAnswer(step) : (step ?? textAnswer(''));
    },
  });
}

/** A busca nativa do provider falso: uma tool comum, só para o modelo falso a ver na lista. */
export const fakeSearchTools = (): ToolSet => ({
  fake_search: tool({
    description: 'busca nativa',
    inputSchema: jsonSchema<unknown>({ type: 'object', properties: {} }),
    execute: async () => 'achei',
  }),
});

/**
 * Plugin que contribui o provider `fake` com os modelos dados (`fake:a` → `models.a`). Carregue-o
 * depois do `ai`, junto com `pluginConfig: { ai: { models: [{ model: 'fake:a' }] } }`.
 */
export function fakeProvider(
  models: Record<string, MockLanguageModelV4>,
  options: { nativeSearch?: boolean; images?: Record<string, MockImageModelV4> } = {},
): PluginDefinition {
  return definePlugin({
    name: 'fake-provider',
    version: '0.0.0',
    engine: '<1.0.0',
    dependsOn: { ai: '^0.1.0' },
    setup: (ctx) => {
      ctx.services.contribute('ai.providers', {
        name: 'fake',
        languageModel: (id) => {
          const model = models[id];
          if (!model) throw new Error(`modelo falso ausente: ${id}`);
          return model;
        },
        ...(options.nativeSearch && { nativeSearch: fakeSearchTools }),
        ...(options.images && {
          imageModel: (id: string) => {
            const model = options.images?.[id];
            if (!model) throw new Error(`modelo de imagem falso ausente: ${id}`);
            return model;
          },
        }),
      });
    },
  });
}

/** O texto de cada mensagem do prompt de uma chamada, para o teste conferir o que o modelo leu. */
export function promptText(model: MockLanguageModelV4, call = 0): string {
  return JSON.stringify(model.doGenerateCalls[call]?.prompt ?? []);
}

/** Modelo de imagem falso que guarda as chamadas, para o teste conferir o que ele recebeu. */
export interface PaintedModel extends MockImageModelV4 {
  readonly calls: Parameters<MockImageModelV4['doGenerate']>[0][];
}

/**
 * Modelo de imagem falso que devolve, em ordem, uma imagem por chamada; o último passo se repete.
 * `Uint8Array` é a imagem gerada e `Error` é lançado.
 */
export function painted(...steps: (Uint8Array | Error)[]): PaintedModel {
  let i = 0;
  const calls: PaintedModel['calls'] = [];
  const model = new MockImageModelV4({
    doGenerate: async (options) => {
      calls.push(options);
      const step = steps[Math.min(i++, steps.length - 1)];
      if (step instanceof Error) throw step;
      return {
        images: step ? [step] : [],
        warnings: [],
        response: { timestamp: new Date(0), modelId: 'fake', headers: undefined },
      };
    },
  });
  return Object.assign(model, { calls });
}
