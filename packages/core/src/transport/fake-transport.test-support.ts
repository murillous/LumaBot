// Transport mínimo só para os testes do core. Não é exportado. O `FakeTransport` do
// `@zapforge/testing` depende do core, então o core não pode usá-lo sem criar um ciclo (ADR 0053);
// os dois seguem o mesmo contrato do `Transport`.

import type { Message, MessageOf, MessageType, TextMessage } from '#message/types.ts';
import { assertCanSend, assertCapability, type Capability } from './capabilities.ts';
import { TypedEmitter } from './emitter.ts';
import { messageKey } from './message-key.ts';
import type {
  GroupMetadata,
  GroupParticipantAction,
  MessageKey,
  OutgoingContent,
  Presence,
  SendOptions,
  Transport,
  TransportEventHandler,
  TransportEventName,
  TransportEvents,
  Unsubscribe,
} from './types.ts';

export interface SentRecord {
  readonly chatId: string;
  readonly content: OutgoingContent;
  readonly options: SendOptions | undefined;
}

export class TestTransport implements Transport {
  readonly name = 'test';
  readonly capabilities: ReadonlySet<Capability>;
  readonly self = { id: 'bot@test', name: 'Bot', phone: null };
  readonly native: unknown = { kind: 'test-socket' };
  readonly sent: SentRecord[] = [];
  readonly errors: unknown[] = [];
  connected = false;
  /** Faz o próximo `connect()` falhar, para testar o shutdown após falha. */
  failConnect = false;
  #nextId = 0;
  readonly #emitter = new TypedEmitter<TransportEvents>((error) => this.errors.push(error));

  constructor(capabilities: Iterable<Capability>) {
    this.capabilities = new Set(capabilities);
  }

  async connect(): Promise<void> {
    if (this.failConnect) throw new Error('falha ao conectar');
    this.connected = true;
    this.#emitter.emit('connection.status', { status: 'open' });
  }

  async disconnect(): Promise<void> {
    // Idempotente (contrato): sem conexão aberta, não há o que fechar nem evento a publicar.
    if (!this.connected) return;
    this.connected = false;
    this.#emitter.emit('connection.status', {
      status: 'closed',
      reason: 'unknown',
      error: null,
    });
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
    this.sent.push({ chatId, content, options });
    this.#nextId++;
    return { chatId, id: `sent-${this.#nextId}`, fromMe: true, senderId: null };
  }

  async react(_key: MessageKey, _emoji: string | null): Promise<void> {
    assertCapability(this, 'reactions');
  }

  async edit(_key: MessageKey, _text: string): Promise<void> {
    assertCapability(this, 'message.edit');
  }

  async delete(_key: MessageKey): Promise<void> {
    assertCapability(this, 'message.delete');
  }

  async sendPresence(_chatId: string, _presence: Presence): Promise<void> {
    assertCapability(this, 'presence');
  }

  async getGroupMetadata(groupId: string): Promise<GroupMetadata> {
    assertCapability(this, 'groups');
    return {
      id: groupId,
      subject: 'Grupo',
      description: null,
      ownerId: 'owner@test',
      participants: [
        { id: 'owner@test', name: 'Dona', phone: null, isAdmin: true, isSuperAdmin: true },
        { id: 'member@test', name: null, phone: null, isAdmin: false, isSuperAdmin: false },
      ],
    };
  }

  async updateGroupParticipants(
    _groupId: string,
    _participantIds: readonly string[],
    _action: GroupParticipantAction,
  ): Promise<void> {
    assertCapability(this, 'groups.admin');
  }
}

export function textMessage(
  text: string,
  overrides: Partial<Omit<TextMessage, 'key'>> = {},
): TextMessage {
  const fields: Omit<TextMessage, 'key'> = {
    type: 'text',
    id: 'msg-1',
    chat: { id: 'chat@test', isGroup: false },
    sender: { id: 'user@test', name: 'Usuária', phone: null },
    text,
    timestamp: 0,
    fromMe: false,
    quoted: null,
    mentions: [],
    isForwarded: false,
    isViewOnce: false,
    isEdited: false,
    is<K extends MessageType>(type: K): this is MessageOf<K> {
      return (this as Message).type === type;
    },
    ...overrides,
  };
  // Derivada depois dos overrides, como `createMessage`: segue o chat e o remetente finais.
  return { ...fields, key: messageKey(fields) };
}
