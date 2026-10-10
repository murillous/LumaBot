// Transport do chat web (ADR 0077). O sistema do dono entrega ao widget um JWT; o widget abre o
// WebSocket do transport, se autentica no primeiro frame e conversa por frames JSON. Mídia vai por
// HTTP nas rotas do próprio transport. Nada aqui guarda o token.

import { randomUUID } from 'node:crypto';
import type {
  Capability,
  Chat,
  Contact,
  FormattedText,
  GroupMetadata,
  GroupParticipantAction,
  HttpRoutes,
  HttpSocket,
  HttpSocketHandlers,
  Logger,
  MediaInput,
  MessageKey,
  OutgoingContent,
  SendOptions,
  TypingKind,
} from '@zapforge/core';
import { UnsupportedError } from '@zapforge/core';
import {
  assertCanSend,
  createMessage,
  groupActionCapability,
  type MediaSource,
  type Transport,
  type TransportEventHandler,
  type TransportEventName,
  type TransportEvents,
  TypedEmitter,
} from '@zapforge/core/adapter';
import { bearerToken, InvalidTokenError, type TokenVerifier, type WebAuth } from './jwt.ts';
import { MediaStore, type StoredMedia } from './media-store.ts';
import { Outbox } from './outbox.ts';
import {
  AUTH_TIMEOUT_MS,
  CLOSE_FORBIDDEN,
  CLOSE_GOING_AWAY,
  CLOSE_INVALID_AUTH,
  CLOSE_TOO_BIG,
  CLOSE_UNAUTHORIZED,
  CONVERSATION_PATTERN,
  DEFAULT_CONVERSATION,
  type ErrorFrame,
  MAX_ATTACHMENTS,
  MAX_FRAME_BYTES,
  type MediaRef,
  type ServerFrame,
  type ServerMessageFrame,
} from './protocol.ts';

export interface WebOptions {
  /** Como validar o JWT do sistema do dono: `{ secret }` (HS256) ou `{ jwksUrl }`. */
  readonly auth: WebAuth;
  /**
   * Claim do JWT com o cliente do dono (empresa, escola), que vira `chat.tenantId` (ADR 0072).
   * Configurado, o token sem ele é recusado. Ausente: o transport atende um cliente só.
   */
  readonly tenantClaim?: string;
  /**
   * Origens aceitas no WebSocket e no upload (`https://erp.exemplo.com`). Ausente: qualquer uma,
   * porque quem autoriza é o token. Pedido sem `Origin` (fora do navegador) sempre passa.
   */
  readonly origins?: readonly string[];
  readonly media?: {
    /** Teto de um upload, em bytes. Padrão: 10 MiB. */
    readonly maxBytes?: number;
  };
}

export const DEFAULT_MEDIA_MAX_BYTES: number = 10 * 1024 * 1024;

const CAPABILITIES: readonly Capability[] = [
  'send.text',
  'send.image',
  'send.video',
  'send.audio',
  'send.document',
  'media.download',
  'actions',
  'quoted',
  'typing',
  'message.edit',
  'message.delete',
];

const SELF: Contact = { id: 'bot', name: null, phone: null, isBot: true };

/** Maior atraso que o `setTimeout` aceita; acima dele, o timer dispara na hora. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** Usuário autenticado numa conexão: o que sobra do token depois da verificação. */
interface Identity {
  readonly contact: Contact;
  readonly tenantId?: string;
  readonly expiresAt: number;
}

interface Connection {
  socket: HttpSocket | null;
  /** Ausente até o `auth` ser aceito. */
  chat: Chat | null;
  sender: Contact | null;
  authenticating: boolean;
  timer: NodeJS.Timeout | undefined;
  closed: boolean;
}

/** Token recusado por falta do claim de tenant: válido, mas sem lugar neste transport. */
class ForbiddenError extends Error {
  override readonly name = 'ForbiddenError';
}

export class WebTransport implements Transport {
  readonly name = 'web';
  readonly capabilities: ReadonlySet<Capability> = new Set(CAPABILITIES);
  readonly native: unknown = null;

  readonly #options: WebOptions;
  readonly #verify: TokenVerifier;
  readonly #routes: HttpRoutes;
  readonly #log: Logger;
  readonly #events: TypedEmitter<TransportEvents>;
  readonly #maxBytes: number;
  readonly #connections = new Set<Connection>();
  /** Conexões autenticadas por conversa; várias abas na mesma conversa recebem os mesmos frames. */
  readonly #chats = new Map<string, Set<Connection>>();
  readonly #outbox = new Outbox();
  readonly #media = new MediaStore();
  #connected = false;
  #self: Contact | null = null;

  constructor(options: WebOptions, verify: TokenVerifier, routes: HttpRoutes, log: Logger) {
    this.#options = options;
    this.#verify = verify;
    this.#routes = routes;
    this.#log = log;
    this.#maxBytes = options.media?.maxBytes ?? DEFAULT_MEDIA_MAX_BYTES;
    this.#events = new TypedEmitter<TransportEvents>((error, event) =>
      this.#log.error('handler de evento do transport falhou', { err: error, event }),
    );
    // Na fábrica (ADR 0076): a porta abre antes do `connect()`, e as rotas respondem 503 até lá.
    routes.ws('/chat', (request) => this.#accept(request));
    routes.route('POST', '/media', (request) => this.#upload(request));
    routes.route('OPTIONS', '/media', (request) => this.#preflight(request));
    routes.route('GET', '/media/:id', (request, { params }) =>
      this.#download(request, params['id'] ?? ''),
    );
  }

  get self(): Contact | null {
    return this.#self;
  }

  async connect(): Promise<void> {
    this.#connected = true;
    this.#self = SELF;
    // A porta já está aberta (ADR 0076): dá para receber e enviar a partir de agora.
    this.#events.emit('connection.status', { status: 'open' });
  }

  async disconnect(): Promise<void> {
    this.#connected = false;
    for (const connection of this.#connections) {
      clearTimeout(connection.timer);
      connection.closed = true;
      connection.socket?.close(CLOSE_GOING_AWAY, 'transport desconectado');
    }
    this.#connections.clear();
    this.#chats.clear();
    this.#outbox.clear();
    this.#media.clear();
  }

  on<E extends TransportEventName>(event: E, handler: TransportEventHandler<E>): () => void {
    return this.#events.on(event, handler);
  }

  async send(chatId: string, content: OutgoingContent, options?: SendOptions): Promise<MessageKey> {
    this.#assertConnected();
    assertCanSend(this, content, options);
    const frame = this.#messageFrame(content, options);
    this.#deliver(chatId, frame);
    return { chatId, id: frame.id, fromMe: true, senderId: null };
  }

  async react(): Promise<void> {
    throw new UnsupportedError('reactions', this.name);
  }

  async edit(key: MessageKey, text: string, formatted?: FormattedText): Promise<void> {
    this.#assertConnected();
    this.#deliver(key.chatId, {
      type: 'edit',
      id: key.id,
      text,
      ...(formatted === undefined ? null : { formatted }),
    });
  }

  async delete(key: MessageKey): Promise<void> {
    this.#assertConnected();
    this.#deliver(key.chatId, { type: 'delete', id: key.id });
  }

  async sendTyping(chatId: string, kind: TypingKind): Promise<void> {
    this.#assertConnected();
    // Só para quem está olhando: "digitando" atrasado não diz nada.
    for (const connection of this.#chats.get(chatId) ?? []) {
      this.#write(connection, { type: 'typing', kind });
    }
  }

  async getGroupMetadata(): Promise<GroupMetadata> {
    throw new UnsupportedError('groups', this.name);
  }

  async updateGroupParticipants(
    _groupId: string,
    _participantIds: readonly string[],
    action: GroupParticipantAction,
  ): Promise<void> {
    throw new UnsupportedError(groupActionCapability(action), this.name);
  }

  // --- WebSocket ---

  #accept(request: Request): HttpSocketHandlers | Response {
    if (!this.#connected) return new Response('transport desconectado', { status: 503 });
    if (!this.#originAllowed(request)) return new Response('origem recusada', { status: 403 });
    const connection: Connection = {
      socket: null,
      chat: null,
      sender: null,
      authenticating: false,
      timer: undefined,
      closed: false,
    };
    return {
      onOpen: (socket) => {
        connection.socket = socket;
        this.#connections.add(connection);
        connection.timer = setTimeout(
          () => this.#close(connection, CLOSE_UNAUTHORIZED, 'auth não chegou'),
          AUTH_TIMEOUT_MS,
        );
      },
      onMessage: (_socket, data) => this.#onFrame(connection, data),
      onClose: () => this.#forget(connection),
    };
  }

  async #onFrame(connection: Connection, data: string | ArrayBuffer): Promise<void> {
    if (connection.closed) return;
    const size = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    if (size > MAX_FRAME_BYTES) {
      this.#close(connection, CLOSE_TOO_BIG, 'frame grande demais');
      return;
    }
    const frame = typeof data === 'string' ? parseJson(data) : undefined;
    if (connection.chat === null) {
      await this.#authenticate(connection, frame);
      return;
    }
    if (!isRecord(frame)) {
      this.#reject(connection, 'invalid-frame', 'frame não é um objeto JSON');
      return;
    }
    if (frame['type'] === 'message') this.#onMessage(connection, frame);
    else if (frame['type'] === 'action') this.#onAction(connection, frame);
    else this.#reject(connection, 'invalid-frame', 'tipo de frame desconhecido');
  }

  async #authenticate(connection: Connection, frame: unknown): Promise<void> {
    // Um frame só antes do `ready`: o cliente espera a resposta do `auth` antes de falar.
    if (connection.authenticating || !isRecord(frame) || frame['type'] !== 'auth') {
      this.#close(connection, CLOSE_INVALID_AUTH, 'o primeiro frame deve ser `auth`');
      return;
    }
    const { token, conversation = DEFAULT_CONVERSATION } = frame;
    if (
      typeof token !== 'string' ||
      typeof conversation !== 'string' ||
      !CONVERSATION_PATTERN.test(conversation)
    ) {
      this.#close(connection, CLOSE_INVALID_AUTH, '`auth` com token ou conversa inválidos');
      return;
    }
    connection.authenticating = true;
    let identity: Identity;
    try {
      identity = await this.#identify(token);
    } catch (error) {
      this.#refuse(connection, error);
      return;
    }
    // O cliente pode ter saído, ou o transport desconectado, durante a verificação.
    if (connection.closed) return;
    const chatId = `${identity.contact.id}/${conversation}`;
    connection.chat = {
      id: chatId,
      isGroup: false,
      kind: 'dm',
      ...(identity.tenantId === undefined ? null : { tenantId: identity.tenantId }),
    };
    connection.sender = identity.contact;
    connection.authenticating = false;
    clearTimeout(connection.timer);
    this.#expireAt(connection, identity.expiresAt);
    let peers = this.#chats.get(chatId);
    if (peers === undefined) {
      peers = new Set();
      this.#chats.set(chatId, peers);
    }
    peers.add(connection);
    this.#write(connection, { type: 'ready', chatId, userId: identity.contact.id });
    for (const pending of this.#outbox.drain(chatId)) this.#write(connection, pending);
  }

  #refuse(connection: Connection, error: unknown): void {
    if (error instanceof ForbiddenError) {
      this.#log.debug('conexão recusada sem o claim de tenant', { reason: error.message });
      this.#close(connection, CLOSE_FORBIDDEN, error.message);
      return;
    }
    if (error instanceof InvalidTokenError) {
      // Debug: token vencido é rotina (aba aberta de ontem), não incidente.
      this.#log.debug('token recusado', { reason: error.message });
      this.#close(connection, CLOSE_UNAUTHORIZED, 'token inválido');
      return;
    }
    // Falha na busca do JWKS, por exemplo: o cliente tenta de novo, e o log diz o que houve.
    this.#log.warn('não deu para verificar o token', { err: error });
    this.#close(connection, CLOSE_UNAUTHORIZED, 'não deu para verificar o token');
  }

  /** Fecha a conexão no `exp`; o cliente reconecta com um token novo (ADR 0077). */
  #expireAt(connection: Connection, expiresAt: number): void {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      this.#close(connection, CLOSE_UNAUTHORIZED, 'token venceu');
      return;
    }
    connection.timer = setTimeout(
      () => this.#expireAt(connection, expiresAt),
      Math.min(remaining, MAX_TIMER_MS),
    );
  }

  #onMessage(connection: Connection, frame: Record<string, unknown>): void {
    const { ref, text, attachments = [] } = frame;
    const chat = connection.chat as Chat;
    const sender = connection.sender as Contact;
    if (ref !== undefined && (typeof ref !== 'string' || ref.length > 128)) {
      this.#reject(connection, 'invalid-frame', '`ref` deve ser texto de até 128 caracteres');
      return;
    }
    if (
      (text !== undefined && typeof text !== 'string') ||
      !Array.isArray(attachments) ||
      attachments.length > MAX_ATTACHMENTS ||
      !attachments.every((id) => typeof id === 'string') ||
      ((text ?? '') === '' && attachments.length === 0)
    ) {
      this.#reject(
        connection,
        'invalid-frame',
        `mensagem precisa de \`text\` ou de até ${MAX_ATTACHMENTS} \`attachments\``,
        ref,
      );
      return;
    }
    const media = this.#media.takeAll(attachments as string[], sender.id);
    if (media === undefined) {
      this.#reject(
        connection,
        'media-not-found',
        'anexo inexistente, vencido ou de outro usuário',
        ref,
      );
      return;
    }
    const id = randomUUID();
    this.#write(connection, { type: 'ack', ref: ref ?? null, id });
    const base = { id, chat, sender, timestamp: Date.now(), fromMe: false };
    const sources = media.map(toSource);
    const first = sources[0];
    const message =
      first === undefined
        ? createMessage({ ...base, type: 'text', text: text as string })
        : createMessage({
            ...base,
            ...mediaType(first.mimetype, first.fileName),
            text: (text as string | undefined) || null,
            media: first,
            attachments: sources,
          });
    this.#events.emit('message', message);
  }

  #onAction(connection: Connection, frame: Record<string, unknown>): void {
    const { actionId } = frame;
    if (typeof actionId !== 'string' || actionId === '' || actionId.length > 64) {
      this.#reject(connection, 'invalid-frame', '`actionId` deve ser texto de até 64 caracteres');
      return;
    }
    // O kernel confere se o ID é de um botão enviado a este chat (ADR 0062): forjar não adianta.
    this.#events.emit('interaction', {
      id: randomUUID(),
      chat: connection.chat as Chat,
      sender: connection.sender as Contact,
      timestamp: Date.now(),
      actionId,
    });
  }

  #forget(connection: Connection): void {
    clearTimeout(connection.timer);
    connection.closed = true;
    this.#connections.delete(connection);
    const chatId = connection.chat?.id;
    if (chatId === undefined) return;
    const peers = this.#chats.get(chatId);
    peers?.delete(connection);
    if (peers?.size === 0) this.#chats.delete(chatId);
  }

  #close(connection: Connection, code: number, reason: string): void {
    if (connection.closed) return;
    // `#forget` sai pelo `onClose`; fechar aqui já tira a conexão de quem recebe frames.
    this.#forget(connection);
    connection.socket?.close(code, reason);
  }

  #reject(connection: Connection, code: ErrorFrame['code'], message: string, ref?: unknown): void {
    this.#write(connection, {
      type: 'error',
      code,
      message,
      ...(typeof ref === 'string' ? { ref } : null),
    });
  }

  #write(connection: Connection, frame: ServerFrame): void {
    connection.socket?.send(JSON.stringify(frame));
  }

  /** Para quem está na conversa, ou para o buffer se ninguém estiver. */
  #deliver(chatId: string, frame: ServerFrame): void {
    const peers = this.#chats.get(chatId);
    if (peers === undefined) {
      this.#outbox.push(chatId, frame);
      return;
    }
    for (const connection of peers) this.#write(connection, frame);
  }

  #messageFrame(content: OutgoingContent, options: SendOptions | undefined): ServerMessageFrame {
    const common = {
      type: 'message',
      id: randomUUID(),
      timestamp: Date.now(),
      ...(options?.quoted === undefined ? null : { quotedId: options.quoted.id }),
    } as const;
    switch (content.type) {
      case 'text':
        return {
          ...common,
          kind: 'text',
          text: content.text,
          ...(content.formatted === undefined ? null : { formatted: content.formatted }),
          ...(options?.actions === undefined || options.actions.length === 0
            ? null
            : { actions: options.actions.map(({ id, label }) => ({ id, label })) }),
        };
      case 'image':
      case 'video':
      case 'audio':
      case 'document': {
        const caption = 'caption' in content ? content.caption : undefined;
        const formatted = 'formattedCaption' in content ? content.formattedCaption : undefined;
        return {
          ...common,
          kind: content.type,
          media: this.#mediaRef(content),
          ...(caption === undefined ? null : { text: caption }),
          ...(formatted === undefined ? null : { formatted }),
        };
      }
      default:
        // `assertCanSend` já barrou o que o web não declara; o álbum, a fila divide (ADR 0065).
        throw new UnsupportedError('send.album', this.name);
    }
  }

  #mediaRef(content: {
    readonly media: MediaInput;
    readonly mimetype?: string;
    readonly fileName?: string;
  }): MediaRef {
    const named = content.fileName === undefined ? null : { fileName: content.fileName };
    const mimetype = content.mimetype ?? 'application/octet-stream';
    if (!Buffer.isBuffer(content.media)) return { url: content.media.url, mimetype, ...named };
    const id = this.#media.put({ bytes: content.media, mimetype, ...named });
    return { url: `${this.#routes.basePath}/media/${id}`, mimetype, ...named };
  }

  // --- HTTP de mídia ---

  async #upload(request: Request): Promise<Response> {
    if (!this.#connected) return new Response('transport desconectado', { status: 503 });
    const cors = this.#cors(request);
    if (cors === null) return new Response('origem recusada', { status: 403 });
    const token = bearerToken(request);
    if (token === null) return text('falta o header Authorization: Bearer', 401, cors);
    let identity: Identity;
    try {
      identity = await this.#identify(token);
    } catch (error) {
      if (error instanceof ForbiddenError) return text(error.message, 403, cors);
      if (error instanceof InvalidTokenError) return text('token inválido', 401, cors);
      this.#log.warn('não deu para verificar o token do upload', { err: error });
      return text('não deu para verificar o token', 503, cors);
    }
    const mimetype = request.headers.get('content-type')?.split(';')[0]?.trim();
    if (!mimetype) return text('falta o Content-Type', 415, cors);
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > this.#maxBytes) return text('arquivo grande demais', 413, cors);
    const bytes = await readLimited(request, this.#maxBytes);
    if (bytes === null) return text('arquivo grande demais', 413, cors);
    if (bytes.length === 0) return text('arquivo vazio', 400, cors);
    const name = new URL(request.url).searchParams.get('name');
    const id = this.#media.put({
      bytes,
      mimetype,
      owner: identity.contact.id,
      ...(name ? { fileName: name.slice(0, 255) } : null),
    });
    return Response.json({ id }, { status: 201, headers: cors });
  }

  #preflight(request: Request): Response {
    const cors = this.#cors(request);
    if (cors === null) return new Response('origem recusada', { status: 403 });
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
      },
    });
  }

  #download(request: Request, id: string): Response {
    const cors = this.#cors(request) ?? {};
    const media = this.#media.get(id);
    // Upload do usuário não sai por aqui: só a mídia do bot tem URL pública.
    if (media === undefined || media.owner !== undefined) return text('não encontrado', 404, cors);
    const inline = /^(image|video|audio)\//.test(media.mimetype);
    const name =
      media.fileName === undefined
        ? ''
        : `; filename*=UTF-8''${encodeURIComponent(media.fileName)}`;
    return new Response(media.bytes, {
      headers: {
        ...cors,
        'content-type': media.mimetype,
        'content-disposition': `${inline ? 'inline' : 'attachment'}${name}`,
        // A mídia vem de plugin, que pode repassar o que um usuário mandou: sem sniff e sem script.
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox',
        'cache-control': 'private, max-age=3600',
      },
    });
  }

  // --- Comum ---

  async #identify(token: string): Promise<Identity> {
    const verified = await this.#verify(token);
    const claim = this.#options.tenantClaim;
    let tenantId: string | undefined;
    if (claim !== undefined) {
      const value = verified.claims[claim];
      if ((typeof value !== 'string' && typeof value !== 'number') || value === '') {
        throw new ForbiddenError(`token sem o claim de tenant "${claim}"`);
      }
      tenantId = String(value);
    }
    // O tenant entra no ID (ADR 0072): dois tenants nunca dividem um contato nem uma conversa.
    const sub = encodeURIComponent(verified.sub);
    const id = tenantId === undefined ? sub : `${encodeURIComponent(tenantId)}:${sub}`;
    const name = verified.claims['name'];
    return {
      contact: {
        id,
        name: typeof name === 'string' ? name : null,
        phone: null,
        claims: verified.claims,
      },
      ...(tenantId === undefined ? null : { tenantId }),
      expiresAt: verified.expiresAt,
    };
  }

  #originAllowed(request: Request): boolean {
    const origin = request.headers.get('origin');
    return (
      origin === null ||
      this.#options.origins === undefined ||
      this.#options.origins.includes(origin)
    );
  }

  /** Headers de CORS para a origem do pedido; `null` se ela não é aceita. */
  #cors(request: Request): Record<string, string> | null {
    if (!this.#originAllowed(request)) return null;
    const origin = request.headers.get('origin');
    if (origin === null) return {};
    // Sem lista, qualquer origem: o upload exige o token, e o download, a URL secreta.
    return this.#options.origins === undefined
      ? { 'access-control-allow-origin': '*' }
      : { 'access-control-allow-origin': origin, vary: 'Origin' };
  }

  #assertConnected(): void {
    if (!this.#connected) throw new Error('web: transport desconectado');
  }
}

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    // JSON inválido é tratado como frame inválido por quem chamou.
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(body: string, status: number, headers: Record<string, string>): Response {
  return new Response(body, { status, headers });
}

/** Corpo inteiro, ou `null` se passar de `max` (o `Content-Length` pode mentir ou faltar). */
async function readLimited(request: Request, max: number): Promise<Buffer | null> {
  if (request.body === null) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request.body) {
    total += chunk.byteLength;
    if (total > max) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function toSource(media: StoredMedia): MediaSource {
  return {
    mimetype: media.mimetype,
    size: media.bytes.length,
    ...(media.fileName === undefined ? null : { fileName: media.fileName }),
    download: async () => media.bytes,
  };
}

/** Tipo da mensagem pelo mimetype do primeiro anexo (ADR 0065). */
function mediaType(
  mimetype: string,
  fileName: string | undefined,
):
  | { readonly type: 'image' | 'video' | 'audio' }
  | { readonly type: 'document'; readonly fileName: string | null } {
  if (mimetype.startsWith('image/')) return { type: 'image' };
  if (mimetype.startsWith('video/')) return { type: 'video' };
  if (mimetype.startsWith('audio/')) return { type: 'audio' };
  return { type: 'document', fileName: fileName ?? null };
}
