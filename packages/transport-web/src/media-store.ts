// Arquivos em memória do transport (ADR 0077): os uploads do usuário e a mídia que o bot envia. A
// validade é conferida quando o mapa anda, sem timer: nada sobrevive ao `stop()` por causa dele.

import { randomBytes } from 'node:crypto';

export interface StoredMedia {
  readonly bytes: Buffer;
  readonly mimetype: string;
  readonly fileName?: string;
  /** Contato que fez o upload; ausente na mídia do bot, que qualquer um com a URL baixa. */
  readonly owner?: string;
}

interface Entry extends StoredMedia {
  readonly expiresAt: number;
}

export const MEDIA_TTL_MS: number = 60 * 60 * 1000;
/** Teto de todos os arquivos juntos; acima dele, sai o mais antigo. */
export const MEDIA_STORE_MAX_BYTES: number = 256 * 1024 * 1024;

export class MediaStore {
  // Ordem de inserção = ordem de validade, porque o TTL é um só: o mais antigo está na frente.
  readonly #entries = new Map<string, Entry>();
  #bytes = 0;
  readonly #now: () => number;
  readonly #maxBytes: number;

  constructor(options: { readonly now?: () => number; readonly maxBytes?: number } = {}) {
    this.#now = options.now ?? Date.now;
    this.#maxBytes = options.maxBytes ?? MEDIA_STORE_MAX_BYTES;
  }

  /** Guarda e devolve um ID aleatório de 128 bits, que serve de URL de download. */
  put(media: StoredMedia): string {
    this.#prune();
    const id = randomBytes(16).toString('base64url');
    this.#entries.set(id, { ...media, expiresAt: this.#now() + MEDIA_TTL_MS });
    this.#bytes += media.bytes.length;
    for (const [oldest, entry] of this.#entries) {
      if (this.#bytes <= this.#maxBytes || oldest === id) break;
      this.#delete(oldest, entry);
    }
    return id;
  }

  /** O arquivo, se ainda vale. */
  get(id: string): StoredMedia | undefined {
    const entry = this.#entries.get(id);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#delete(id, entry);
      return undefined;
    }
    return entry;
  }

  /**
   * Tira os uploads de `owner` do mapa, todos ou nenhum: a mensagem passa a segurar os bytes, e o
   * mesmo upload não entra em duas mensagens. `undefined` se algum não existe, venceu ou é de
   * outro contato.
   */
  takeAll(ids: readonly string[], owner: string): StoredMedia[] | undefined {
    const now = this.#now();
    const found: Entry[] = [];
    for (const id of ids) {
      const entry = this.#entries.get(id);
      if (entry === undefined || entry.owner !== owner || entry.expiresAt <= now) return undefined;
      found.push(entry);
    }
    // O mesmo ID duas vezes acharia a mesma entrada duas vezes; apagar de novo é inofensivo.
    for (const [index, id] of ids.entries()) {
      if (this.#entries.delete(id)) this.#bytes -= (found[index] as Entry).bytes.length;
    }
    return found;
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }

  get size(): number {
    return this.#entries.size;
  }

  #prune(): void {
    const now = this.#now();
    for (const [id, entry] of this.#entries) {
      if (entry.expiresAt > now) break;
      this.#delete(id, entry);
    }
  }

  #delete(id: string, entry: Entry): void {
    this.#entries.delete(id);
    this.#bytes -= entry.bytes.length;
  }
}
