// Ações (ADR 0062): o botão leva só um ID opaco, e o kernel guarda o que o clique roda. O
// cliente (Telegram, web) não forja um clique com outro comando ou outros argumentos, e o ID cabe
// nos 64 bytes do `callback_data` do Telegram.

import { randomBytes } from 'node:crypto';
import type { JsonValue } from '#storage/types.ts';
import { fmt, type MessageText } from '#text/format.ts';

/** Botão que roda um comando registrado (de qualquer plugin), como se a pessoa o digitasse. */
export interface CommandAction {
  /** Texto do botão. */
  readonly label: string;
  /** Nome ou alias do comando, sem o prefixo. */
  readonly command: string;
  /** Argumentos, entregues como vieram em `ctx.args`; o `rawArgs` é a junção por espaços. */
  readonly args?: readonly string[];
}

/** Botão que roda um passo de conversa do próprio plugin (ADR 0060), com o `data` da ação. */
export interface StepAction {
  /** Texto do botão. */
  readonly label: string;
  /** Passo definido com `ctx.conversations.define`. */
  readonly step: string;
  /** Entregue ao passo em `ctx.data`. Padrão: `null`. */
  readonly data?: JsonValue;
}

/** Ação anexada a uma resposta (`ctx.reply(text, { actions })`). */
export type MessageAction = CommandAction | StepAction;

/**
 * O que o clique roda, guardado pelo kernel sob o ID do botão. O `label` vira o texto da mensagem
 * do clique.
 */
export type ActionTarget =
  | {
      readonly kind: 'command';
      readonly label: string;
      readonly command: string;
      readonly args: readonly string[];
    }
  | {
      readonly kind: 'step';
      readonly label: string;
      readonly plugin: string;
      readonly step: string;
      readonly data: JsonValue;
    };

/** Validade de um botão: 24 horas. */
export const ACTION_TTL_MS: number = 24 * 60 * 60_000;

/** Máximo de botões guardados; acima disso, saem os mais antigos. */
export const MAX_STORED_ACTIONS = 10_000;

interface StoredAction {
  readonly chatId: string;
  readonly target: ActionTarget;
  readonly expiresAt: number;
}

/**
 * Alvos dos botões de um bot (estado no closure do bot, ADR 0004). Sem timer: o vencido sai ao
 * ser consultado e quando entram IDs novos, e nada sobrevive ao `stop()`.
 */
export class ActionRegistry {
  // O `Map` guarda a ordem de inserção, que é a de vencimento: a poda olha só o começo.
  readonly #actions = new Map<string, StoredAction>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Guarda o alvo, preso ao chat, e devolve o ID do botão. */
  register(chatId: string, target: ActionTarget): string {
    const now = this.#now();
    this.#prune(now);
    // 12 bytes viram 16 caracteres base64url: imprevisível e dentro dos 64 bytes do Telegram.
    const id = randomBytes(12).toString('base64url');
    this.#actions.set(id, { chatId, target, expiresAt: now + ACTION_TTL_MS });
    return id;
  }

  /** O alvo do botão clicado no chat, ou `undefined` se vencido, desconhecido ou de outro chat. */
  resolve(id: string, chatId: string): ActionTarget | undefined {
    const stored = this.#actions.get(id);
    if (stored === undefined) return undefined;
    if (stored.expiresAt <= this.#now()) {
      this.#actions.delete(id);
      return undefined;
    }
    return stored.chatId === chatId ? stored.target : undefined;
  }

  /** Descarta tudo (shutdown). */
  clear(): void {
    this.#actions.clear();
  }

  get size(): number {
    return this.#actions.size;
  }

  #prune(now: number): void {
    for (const [id, stored] of this.#actions) {
      if (stored.expiresAt > now && this.#actions.size < MAX_STORED_ACTIONS) return;
      this.#actions.delete(id);
    }
  }
}

/** O texto com o menu numerado (`1. rótulo`) no fim, para o transport sem botões. */
export function numberedMenu(text: MessageText, labels: readonly string[]): MessageText {
  const menu = labels.map((label, index) => `${index + 1}. ${label}`).join('\n');
  // Na árvore, o rótulo entra como texto literal: não vira marcação.
  return typeof text === 'string' ? `${text}\n\n${menu}` : fmt`${text}\n\n${menu}`;
}

const CHOICE = /^\d{1,3}$/;

/** Índice (a partir de 0) da opção que o texto escolhe, ou `null` se ele não é um número dela. */
export function pickChoice(text: string | null, count: number): number | null {
  const trimmed = text?.trim();
  if (trimmed === undefined || !CHOICE.test(trimmed)) return null;
  const choice = Number(trimmed);
  return choice >= 1 && choice <= count ? choice - 1 : null;
}
