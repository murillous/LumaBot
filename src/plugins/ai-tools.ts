// Contrato do ponto `ai.tools`: só tipos e funções puras, sem depender do plugin `ai`.
// Cada plugin contribui as próprias tools; a IA lê `list()` e não conhece nenhum plugin.

import type {
  Capability,
  JsonObject,
  JsonValue,
  Logger,
  Media,
  MediaMessageType,
  Message,
  Reply,
} from '@usebridger/core';
import { z } from 'zod';

/** O que a tool recebe da mensagem que originou a chamada da IA. */
export interface AiToolContext {
  /** Mensagem do usuário: chat, remetente, menções, mídia e a citada. */
  readonly message: Message;
  /** Responde no chat da mensagem, citando-a. O que vai para o chat sai por aqui. */
  readonly reply: Reply;
  readonly signal: AbortSignal;
  readonly log: Logger;
}

/** Devolvido ao modelo, nunca enviado ao chat: texto ou estrutura em JSON. */
export type AiToolResult = JsonValue;

export interface AiTool<A = unknown> {
  /** Único no bot, em snake_case. */
  readonly name: string;
  /** Para o modelo: o que a tool faz e quando usar. */
  readonly description: string;
  /** Validado antes do `run`; vira o JSON Schema dos parâmetros (`z.toJSONSchema`). */
  readonly args: z.ZodType<A>;
  /** A IA só oferece a tool se o transport tiver todas. */
  readonly requires?: readonly Capability[];
  /** `false` para tool só de leitura: iniciada, ela não impede o fallback. Ausente = tem efeito. */
  readonly sideEffects?: boolean;
  run(args: A, ctx: AiToolContext): Promise<AiToolResult>;
}

declare module '@usebridger/core' {
  interface ExtensionPoints {
    /** Tool que a IA pode chamar, na ordem de carga de quem contribui. */
    'ai.tools': AiTool;
  }
}

/** Sucesso para o modelo, com os dados que ele precisa ler. */
export const ok = (data: JsonObject = {}): JsonObject => ({ ok: true, ...data });

/** Recusa esperada para o modelo: `error` é um código curto que ele entende (`no-media`). */
export const fail = (error: string, detail?: string): JsonObject =>
  detail === undefined ? { ok: false, error } : { ok: false, error, detail };

/** Identidade tipada: infere `A` do `args`, o que o `contribute` sozinho não faz. */
export const aiTool = <A>(tool: AiTool<A>): AiTool => tool as AiTool;

/** Tools que o transport atende: a IA nunca oferece uma que vai falhar por capability. */
export function offeredTools(
  tools: readonly AiTool[],
  capabilities: ReadonlySet<Capability>,
): AiTool[] {
  return tools.filter((t) => (t.requires ?? []).every((c) => capabilities.has(c)));
}

/**
 * Valida os argumentos do modelo e roda a tool. Argumento inválido e falha inesperada voltam como
 * resultado, não como erro: o modelo lê o motivo e conta ao usuário ou chama de novo. A falha vai
 * para o log; a tool só traduz os erros que ela espera.
 */
export async function invokeTool(
  tool: AiTool,
  raw: unknown,
  ctx: AiToolContext,
): Promise<AiToolResult> {
  const parsed = tool.args.safeParse(raw);
  if (!parsed.success) {
    return fail('invalid-args', z.prettifyError(parsed.error));
  }
  try {
    return await tool.run(parsed.data, ctx);
  } catch (err) {
    ctx.log.error('tool da IA falhou', { err, tool: tool.name });
    return fail('failed');
  }
}

/** Mensagem com mídia de um dos `types`: a do usuário ou, na falta, a citada. */
export function mediaMessage(
  message: Message,
  types: readonly MediaMessageType[],
): (Message & { readonly media: Media }) | null {
  for (const m of [message, message.quoted]) {
    if (m && 'media' in m && (types as readonly string[]).includes(m.type)) return m;
  }
  return null;
}
