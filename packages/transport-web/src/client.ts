// Cliente de referência do protocolo v1 (ADR 0077), sobre o `WebSocket` e o `fetch` globais: roda
// no navegador e no Node 24. Serve de exemplo para o widget do sistema do dono e aos testes de ponta
// a ponta. Só importa tipos e constantes do protocolo, sem o core nem o `jose`.

import {
  type AuthFrame,
  type ClientFrame,
  type DeleteFrame,
  type EditFrame,
  type ErrorFrame,
  MAX_FRAME_BYTES,
  type ReadyFrame,
  type ServerFrame,
  type ServerMessageFrame,
  type TypingFrame,
} from './protocol.ts';

export interface WebChatOptions {
  /** URL do WebSocket: `wss://bot.exemplo.com/transports/web/chat`. */
  readonly url: string;
  /** JWT emitido pelo sistema do dono. */
  readonly token: string;
  /** Conversa (`[A-Za-z0-9_-]`, até 64). Padrão: a do servidor (`default`). */
  readonly conversation?: string;
}

interface ClientEvents {
  message: ServerMessageFrame;
  edit: EditFrame;
  delete: DeleteFrame;
  typing: TypingFrame;
  error: ErrorFrame;
  close: { readonly code: number; readonly reason: string };
}

type Listener<T> = (payload: T) => void;

/** Conexão autenticada. Erro de um listener vai para o `console.error` e não derruba as outras. */
export class WebChatClient {
  readonly chatId: string;
  readonly userId: string;
  readonly #socket: WebSocket;
  readonly #mediaBase: string;
  readonly #token: string;
  readonly #listeners = new Map<keyof ClientEvents, Set<Listener<never>>>();
  /**
   * Frames que chegaram sem listener do tipo: os do buffer chegam logo depois do `ready`, às vezes
   * no mesmo tick, antes de o `await connectWebChat()` voltar. O primeiro `on()` os recebe.
   */
  readonly #unclaimed = new Map<keyof ClientEvents, unknown[]>();
  readonly #acks = new Map<string, (id: string) => void>();
  #refs = 0;

  constructor(socket: WebSocket, ready: ReadyFrame, options: WebChatOptions) {
    this.#socket = socket;
    this.chatId = ready.chatId;
    this.userId = ready.userId;
    this.#token = options.token;
    // `.../transports/web/chat` → `http(s)://.../transports/web`.
    const base = new URL(options.url);
    base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:';
    base.pathname = base.pathname.replace(/\/chat\/?$/, '');
    this.#mediaBase = base.href.replace(/\/$/, '');
  }

  on<E extends keyof ClientEvents>(event: E, listener: Listener<ClientEvents[E]>): () => void {
    let set = this.#listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    const entry = listener as Listener<never>;
    set.add(entry);
    const unclaimed = this.#unclaimed.get(event);
    this.#unclaimed.delete(event);
    for (const payload of unclaimed ?? []) this.#call(listener, payload as ClientEvents[E]);
    return () => set.delete(entry);
  }

  /** Envia uma mensagem e resolve com o ID que o servidor deu a ela. */
  send(text: string, options: { readonly attachments?: readonly string[] } = {}): Promise<string> {
    const ref = `r${++this.#refs}`;
    return new Promise((resolve) => {
      this.#acks.set(ref, resolve);
      this.#write({ type: 'message', ref, text, ...options });
    });
  }

  /** Clica no botão de `actions` com esse `id`. */
  click(actionId: string): void {
    this.#write({ type: 'action', actionId });
  }

  /** Sobe um arquivo e devolve o ID para `send(text, { attachments })`. */
  async upload(body: Blob | Uint8Array, mimetype: string, fileName?: string): Promise<string> {
    const url = new URL(`${this.#mediaBase}/media`);
    if (fileName !== undefined) url.searchParams.set('name', fileName);
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#token}`, 'content-type': mimetype },
      body,
    });
    if (!response.ok)
      throw new Error(`upload recusado: ${response.status} ${await response.text()}`);
    return ((await response.json()) as { id: string }).id;
  }

  /** URL absoluta da mídia de uma mensagem (o servidor manda o caminho relativo à origem). */
  mediaUrl(frame: ServerMessageFrame): string | undefined {
    return frame.media === undefined ? undefined : new URL(frame.media.url, this.#mediaBase).href;
  }

  close(): void {
    this.#socket.close(1000);
  }

  /** Repassa um frame do servidor; chamado pelo `connectWebChat`. */
  dispatch(frame: ServerFrame): void {
    if (frame.type === 'ack') {
      const resolve = frame.ref === null ? undefined : this.#acks.get(frame.ref);
      if (frame.ref !== null) this.#acks.delete(frame.ref);
      resolve?.(frame.id);
      return;
    }
    if (frame.type === 'ready') return;
    this.#emit(frame.type, frame as never);
  }

  emitClose(code: number, reason: string): void {
    this.#emit('close', { code, reason });
  }

  #emit<E extends keyof ClientEvents>(event: E, payload: ClientEvents[E]): void {
    const listeners = this.#listeners.get(event);
    if (listeners === undefined || listeners.size === 0) {
      const unclaimed = this.#unclaimed.get(event) ?? [];
      unclaimed.push(payload);
      this.#unclaimed.set(event, unclaimed);
      return;
    }
    for (const listener of listeners) this.#call(listener as Listener<ClientEvents[E]>, payload);
  }

  #call<T>(listener: Listener<T>, payload: T): void {
    try {
      listener(payload);
    } catch (error) {
      console.error('listener do WebChatClient falhou', error);
    }
  }

  #write(frame: ClientFrame): void {
    const data = JSON.stringify(frame);
    if (data.length > MAX_FRAME_BYTES) throw new RangeError('frame acima de 64 KiB');
    this.#socket.send(data);
  }
}

/**
 * Abre a conexão e se autentica. Resolve no `ready` e rejeita se o servidor fechar antes (token
 * recusado: 4401). Os frames que esperavam no buffer do servidor vão para o primeiro `on()`.
 */
export function connectWebChat(options: WebChatOptions): Promise<WebChatClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(options.url);
    let client: WebChatClient | undefined;
    socket.addEventListener('open', () => {
      const auth: AuthFrame = {
        type: 'auth',
        token: options.token,
        ...(options.conversation === undefined ? null : { conversation: options.conversation }),
      };
      socket.send(JSON.stringify(auth));
    });
    socket.addEventListener('message', (event) => {
      const frame = JSON.parse(String(event.data)) as ServerFrame;
      if (client === undefined) {
        if (frame.type !== 'ready') return;
        client = new WebChatClient(socket, frame, options);
        resolve(client);
        return;
      }
      client.dispatch(frame);
    });
    socket.addEventListener('close', (event) => {
      if (client === undefined) {
        reject(new Error(`conexão fechada antes do ready: ${event.code} ${event.reason}`));
        return;
      }
      client.emitClose(event.code, event.reason);
    });
  });
}
