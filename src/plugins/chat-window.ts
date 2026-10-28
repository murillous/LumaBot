// Janela das últimas mensagens de texto de cada chat, em memória. Comum a quem precisa de contexto
// ambiente (`luma`, `resumo`, `spontaneous`); cada plugin tem a sua, com o próprio tamanho, porque
// a janela de um não pode depender do que o outro guarda.

export interface WindowEntry {
  readonly name: string;
  readonly text: string;
}

export interface ChatWindow {
  /** Acrescenta ao chat; passando de `size`, descarta as mais antigas. */
  push(chatId: string, entry: WindowEntry): void;
  /** As últimas `limit` (todas, sem `limit`), da mais antiga para a mais nova. Cópia. */
  recent(chatId: string, limit?: number): WindowEntry[];
  clear(chatId: string): void;
}

/**
 * `size` mensagens por chat e no máximo `maxChats` chats: o mais parado sai primeiro, para um bot
 * em muitos grupos não crescer sem limite.
 */
export function createChatWindow(size: number, maxChats = 500): ChatWindow {
  // Ordem de inserção = ordem de uso: reinserir o chat a cada `push` o põe no fim.
  const chats = new Map<string, WindowEntry[]>();
  return {
    push(chatId, entry) {
      const entries = chats.get(chatId) ?? [];
      chats.delete(chatId);
      entries.push(entry);
      if (entries.length > size) entries.splice(0, entries.length - size);
      chats.set(chatId, entries);
      if (chats.size > maxChats) {
        const oldest = chats.keys().next();
        if (!oldest.done) chats.delete(oldest.value);
      }
    },
    recent(chatId, limit) {
      const entries = chats.get(chatId) ?? [];
      return limit === undefined ? [...entries] : entries.slice(-limit);
    },
    clear(chatId) {
      chats.delete(chatId);
    },
  };
}
