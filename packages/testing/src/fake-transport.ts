// Transport em memória para testes: nada de rede. Guarda o que o bot envia e deixa o teste
// simular o que chega do canal (`emit`). Segue o contrato do `Transport` à risca — inclusive
// `UnsupportedError` para capability não declarada —, para o teste pegar o mesmo erro que o
// plugin pegaria num transport real.

import type {
  Capability,
  Contact,
  FormattedText,
  GroupMetadata,
  GroupParticipantAction,
  Message,
  MessageKey,
  OutgoingAction,
  OutgoingContent,
  Presence,
  SendOptions,
  TextLimits,
  Transport,
  Unsubscribe,
} from '@zapforge/core';
import {
  assertCanSend,
  assertCapability,
  CAPABILITIES,
  groupActionCapability,
  type TransportEventHandler,
  type TransportEventName,
  type TransportEvents,
  TypedEmitter,
} from '@zapforge/core/adapter';

/** Um envio feito pelo bot, na ordem em que chegou ao transport. */
export interface SentMessage {
  readonly chatId: string;
  readonly content: OutgoingContent;
  /** Mensagem citada; o `ctx.reply` cita a mensagem original. */
  readonly quoted: Message | null;
  /** IDs mencionados. */
  readonly mentions: readonly string[];
  /**
   * Botões enviados (capability `actions`, ADR 0062); ausente sem botões. O `click()` do
   * `TestBot` clica num deles pelo rótulo.
   */
  readonly actions?: readonly OutgoingAction[];
  /** A chave devolvida ao bot, para casar com `reactions`, `edits` e `deletions`. */
  readonly key: MessageKey;
}

export interface FakeTransportOptions {
  /** Padrão: todas as capabilities do core. */
  readonly capabilities?: Iterable<Capability>;
  /** Contato da sessão depois do `connect()`. */
  readonly self?: Contact;
  /** Grupos que `getGroupMetadata` conhece; dá para incluir depois com `setGroup`. */
  readonly groups?: readonly GroupMetadata[];
  /**
   * Limites de tamanho, para testar a divisão de texto longo (ADR 0061). Padrão: nenhum, e o
   * texto vai inteiro.
   */
  readonly limits?: TextLimits;
}

export const DEFAULT_SELF: Contact = { id: 'bot@fake', name: 'Bot', phone: '5500000000000' };

export class FakeTransport implements Transport {
  readonly name = 'fake';
  readonly capabilities: ReadonlySet<Capability>;
  readonly native: unknown = { kind: 'fake-transport' };
  readonly limits?: TextLimits;
  readonly sent: SentMessage[] = [];
  readonly reactions: { readonly key: MessageKey; readonly emoji: string | null }[] = [];
  /** `formatted` só aparece na edição com texto formatado. */
  readonly edits: {
    readonly key: MessageKey;
    readonly text: string;
    readonly formatted?: FormattedText;
  }[] = [];
  readonly deletions: MessageKey[] = [];
  readonly presences: { readonly chatId: string; readonly presence: Presence }[] = [];
  readonly participantUpdates: {
    readonly groupId: string;
    readonly participantIds: readonly string[];
    readonly action: GroupParticipantAction;
  }[] = [];
  /**
   * Erros lançados pelos handlers dos eventos emitidos. O `Bot` trata os próprios; o que cair
   * aqui é bug do teste ou do kernel, e o teste pode conferir que a lista ficou vazia.
   */
  readonly errors: unknown[] = [];
  #self: Contact | null = null;
  readonly #selfOnConnect: Contact;
  readonly #groups = new Map<string, GroupMetadata>();
  readonly #emitter = new TypedEmitter<TransportEvents>((error) => this.errors.push(error));
  #connected = false;
  #nextId = 0;

  constructor(options: FakeTransportOptions = {}) {
    this.capabilities = new Set(options.capabilities ?? CAPABILITIES);
    this.#selfOnConnect = options.self ?? DEFAULT_SELF;
    if (options.limits !== undefined) this.limits = options.limits;
    for (const group of options.groups ?? []) this.setGroup(group);
  }

  get self(): Contact | null {
    return this.#self;
  }

  get connected(): boolean {
    return this.#connected;
  }

  async connect(): Promise<void> {
    this.#connected = true;
    this.#self = this.#selfOnConnect;
    this.#emitter.emit('connection.status', { status: 'open' });
  }

  async disconnect(): Promise<void> {
    // Idempotente (contrato): sem conexão aberta, não há o que fechar nem evento a publicar.
    if (!this.#connected) return;
    this.#connected = false;
    this.#emitter.emit('connection.status', { status: 'closed', reason: 'unknown', error: null });
  }

  on<E extends TransportEventName>(event: E, handler: TransportEventHandler<E>): Unsubscribe {
    return this.#emitter.on(event, handler);
  }

  /** Simula um evento vindo do canal. */
  emit<E extends TransportEventName>(event: E, payload: TransportEvents[E]): void {
    this.#emitter.emit(event, payload);
  }

  async send(chatId: string, content: OutgoingContent, options?: SendOptions): Promise<MessageKey> {
    assertCanSend(this, content, options);
    this.#nextId++;
    const key: MessageKey = { chatId, id: `fake-${this.#nextId}`, fromMe: true, senderId: null };
    this.sent.push({
      chatId,
      content,
      quoted: options?.quoted ?? null,
      mentions: options?.mentions ?? [],
      ...(options?.actions && { actions: options.actions }),
      key,
    });
    return key;
  }

  async react(key: MessageKey, emoji: string | null): Promise<void> {
    assertCapability(this, 'reactions');
    this.reactions.push({ key, emoji });
  }

  async edit(key: MessageKey, text: string, formatted?: FormattedText): Promise<void> {
    assertCapability(this, 'message.edit');
    this.edits.push({ key, text, ...(formatted && { formatted }) });
  }

  async delete(key: MessageKey): Promise<void> {
    assertCapability(this, 'message.delete');
    this.deletions.push(key);
  }

  async sendPresence(chatId: string, presence: Presence): Promise<void> {
    assertCapability(this, 'presence');
    this.presences.push({ chatId, presence });
  }

  async getGroupMetadata(groupId: string): Promise<GroupMetadata> {
    assertCapability(this, 'groups');
    const group = this.#groups.get(groupId);
    // Um transport real também falha com grupo inexistente; o erro diz ao teste o que faltou.
    if (group === undefined) {
      throw new Error(`FakeTransport: grupo '${groupId}' desconhecido; registre com setGroup()`);
    }
    return group;
  }

  async updateGroupParticipants(
    groupId: string,
    participantIds: readonly string[],
    action: GroupParticipantAction,
  ): Promise<void> {
    assertCapability(this, groupActionCapability(action));
    this.participantUpdates.push({ groupId, participantIds, action });
  }

  /** Registra (ou substitui) a metadata que `getGroupMetadata` devolve. */
  setGroup(metadata: GroupMetadata): void {
    this.#groups.set(metadata.id, metadata);
  }

  /** Esvazia os registros de saída, para conferir só o que vem depois. */
  clear(): void {
    this.sent.length = 0;
    this.reactions.length = 0;
    this.edits.length = 0;
    this.deletions.length = 0;
    this.presences.length = 0;
    this.participantUpdates.length = 0;
  }
}
