// Transcrição de cada chat, em memória: tudo o que se disse nele, inclusive a Luma, com um ID curto
// por fala (`m12`). Em grupo a conversa é uma só, para a Luma saber quem disse o quê e o que ela
// mesma respondeu a cada um; o ID deixa ela (e, adiante, as tools) apontar para uma fala ou mídia.

import type { Media, MediaRef, MessageType } from '@usebridger/core';

/** Um turno da conversa como vai ao modelo. */
export interface Turn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/** Mídia de uma fala, como a Luma a lê na transcrição. */
export type MediaKind = 'figurinha' | 'imagem' | 'vídeo' | 'áudio' | 'documento';

const MEDIA: Partial<Record<MessageType, MediaKind>> = {
  sticker: 'figurinha',
  image: 'imagem',
  video: 'vídeo',
  audio: 'áudio',
  voice: 'áudio',
  document: 'documento',
};

export const mediaKind = (type: MessageType): MediaKind | undefined => MEDIA[type];

/** Nome de arquivo cabe na marca de mídia: sem colchete nem quebra de linha, curto. */
export const cleanFileName = (name: string): string =>
  name
    .replace(/[[\]\s]+/g, ' ')
    .trim()
    .slice(0, 80);

/** A marca da mídia na transcrição: `[documento: contrato.pdf]`, `[figurinha]`. */
export const mediaLabel = (entry: Pick<Entry, 'media' | 'fileName'>): string =>
  entry.fileName ? `[${entry.media}: ${entry.fileName}]` : `[${entry.media}]`;

export interface Entry {
  /** ID curto no chat (`m12`): é o que a Luma vê e cita. */
  readonly ref: string;
  /** Epoch em ms. */
  readonly at: number;
  readonly fromLuma: boolean;
  readonly name: string;
  /** `personId` de quem falou (ausente nas falas dela): liga a fala ao bloco de memória da pessoa. */
  readonly person?: string;
  readonly text: string | null;
  readonly media?: MediaKind;
  /** Nome do documento (`contrato.pdf`), já limpo: é como a Luma sabe qual mídia é PDF. */
  readonly fileName?: string;
  /** De onde baixar a mídia depois; ausente na de visualização única, que a Luma não guarda. */
  readonly file?: MediaFile;
  /** `ref` da fala citada, se ela ainda está na transcrição. */
  readonly replyTo?: string;
}

/**
 * A mídia de uma fala para baixar depois, sem a mensagem: a referência do kernel (`media.ref`),
 * que o transport baixa de novo mesmo depois do CDN, ou, sem ela, a própria `Media`, que é lazy.
 * A referência pode conter a chave que decifra o arquivo: nunca vai para log nem para o modelo.
 */
export type MediaFile =
  | { readonly type: MessageType; readonly ref: MediaRef }
  | { readonly type: MessageType; readonly live: Media };

export type NewEntry = Omit<Entry, 'ref'>;

/**
 * Resumo rolante das falas mais velhas do chat, até `through` inclusive (a compactação). Vive
 * enquanto a fala mais nova que ele cobre viveria: a retenção de 2 h vale também para ele.
 */
export interface Summary {
  readonly text: string;
  /** `ref` da última fala que o resumo cobre. */
  readonly through: string;
  /** `at` dessa fala: é por ele que o resumo expira. */
  readonly at: number;
}

/** Posição de uma fala no chat, pelo `ref` (`m12` → 12): os `ref` só crescem. */
export const seq = (ref: string): number => Number(ref.slice(1));

export interface Transcript {
  /**
   * Registra a fala com os IDs que ela tem na plataforma: a resposta da Luma em vários balões tem
   * vários, e citar qualquer um deles acha a mesma fala. Passando de `maxMessages`, a mais antiga sai.
   */
  add(chatId: string, entry: NewEntry, platformIds: readonly string[]): Entry;
  /** A fala com esse ID da plataforma, se ainda está na transcrição. */
  find(chatId: string, platformId: string): Entry | undefined;
  /** A fala pelo ID curto, com ou sem o `#` (`m12`, `#m12`), se ainda está na transcrição. */
  get(chatId: string, ref: string): Entry | undefined;
  /** Falas vivas, da mais antiga à mais nova. Cópia. */
  entries(chatId: string): Entry[];
  /** O resumo das falas mais velhas, se o chat tem um vivo. */
  summary(chatId: string): Summary | undefined;
  /**
   * Guarda o resumo do chat. Ignorado se a fala `through` não está mais na transcrição: a memória
   * foi limpa (ou a persona trocou) enquanto o resumo era gerado, e ele falaria da conversa velha.
   */
  setSummary(chatId: string, summary: Summary): void;
  /** Esquece o chat, resumo incluído. `true` se havia algo. */
  clear(chatId: string): boolean;
  /** Chats com fala viva, para o `!luma stats`. */
  size(): number;
}

interface Options {
  /** Falas guardadas por chat. */
  readonly maxMessages: number;
  /** Fala mais velha que isso sai da transcrição. */
  readonly maxAgeMs: number;
  /** Chats guardados; o mais parado sai primeiro, para um bot em muitos grupos não crescer sem limite. */
  readonly maxChats?: number;
  /** Relógio injetável; os testes não esperam. */
  readonly now?: () => number;
}

interface ChatState {
  entries: Entry[];
  /** ID da plataforma → `ref`. Só das falas vivas. */
  ids: Map<string, string>;
  /** Contador dos `ref`; não volta atrás enquanto o chat vive, para um ID nunca mudar de dono. */
  next: number;
  summary?: Summary | undefined;
}

/**
 * Sem timer: a fala expirada sai na leitura e no `add`. Nada sobrevive ao `stop()`, e um restart
 * esquece as conversas, como antes.
 */
export function createTranscript({
  maxMessages,
  maxAgeMs,
  maxChats = 500,
  now = Date.now,
}: Options): Transcript {
  // Ordem de inserção = ordem de uso: reinserir o chat a cada `add` o põe no fim.
  const chats = new Map<string, ChatState>();

  const drop = (state: ChatState, count: number) => {
    const gone = new Set(state.entries.splice(0, count).map((e) => e.ref));
    for (const [id, ref] of state.ids) if (gone.has(ref)) state.ids.delete(id);
  };

  /** Estado do chat sem as falas expiradas; chat sem nenhuma fala viva é esquecido. */
  const alive = (chatId: string): ChatState | undefined => {
    const state = chats.get(chatId);
    if (!state) return undefined;
    const cutoff = now() - maxAgeMs;
    const expired = state.entries.findIndex((e) => e.at >= cutoff);
    drop(state, expired === -1 ? state.entries.length : expired);
    if (state.summary && state.summary.at < cutoff) state.summary = undefined;
    if (state.entries.length === 0) {
      chats.delete(chatId);
      return undefined;
    }
    return state;
  };

  return {
    add(chatId, entry, platformIds) {
      const state: ChatState = alive(chatId) ?? { entries: [], ids: new Map(), next: 1 };
      const full: Entry = { ...entry, ref: `m${state.next}` };
      state.next += 1;
      state.entries.push(full);
      for (const id of platformIds) state.ids.set(id, full.ref);
      if (state.entries.length > maxMessages) drop(state, state.entries.length - maxMessages);
      chats.delete(chatId);
      chats.set(chatId, state);
      if (chats.size > maxChats) {
        const oldest = chats.keys().next();
        if (!oldest.done) chats.delete(oldest.value);
      }
      return full;
    },
    find(chatId, platformId) {
      const state = alive(chatId);
      const ref = state?.ids.get(platformId);
      return ref ? state?.entries.find((e) => e.ref === ref) : undefined;
    },
    get(chatId, ref) {
      const wanted = ref.trim().replace(/^#/, '').toLowerCase();
      return alive(chatId)?.entries.find((e) => e.ref === wanted);
    },
    entries: (chatId) => [...(alive(chatId)?.entries ?? [])],
    summary: (chatId) => alive(chatId)?.summary,
    setSummary(chatId, summary) {
      const state = alive(chatId);
      if (state?.entries.some((e) => e.ref === summary.through)) state.summary = summary;
    },
    clear: (chatId) => chats.delete(chatId),
    size() {
      for (const id of [...chats.keys()]) alive(id);
      return chats.size;
    },
  };
}

/** Trecho de uma fala da Luma para lembrá-la do que foi citado, sem repetir um textão. */
const QUOTE_EXCERPT = 80;

const clock = (at: number, timeZone: string) =>
  new Date(at).toLocaleTimeString('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' });

/** Cabeçalho de uma fala: `[#m12 16:30]`. */
export const header = (entry: Pick<Entry, 'ref' | 'at'>, timeZone: string) =>
  `[#${entry.ref} ${clock(entry.at, timeZone)}]`;

/**
 * O dia de hoje para a fala de agora (`terça-feira, 17/11/2026`): a hora já está no cabeçalho dela.
 * A data fica fora do sistema para o prefixo do prompt não mudar e o cache do provider valer.
 */
export const today = (at: number, timeZone: string) =>
  new Date(at).toLocaleDateString('pt-BR', {
    timeZone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

/** A citação como a Luma a lê, ou `''` se a fala não cita nada que ainda esteja na transcrição. */
export function replyNote(replyTo: Entry | undefined): string {
  if (!replyTo) return '';
  if (!replyTo.fromLuma) return `(respondendo #${replyTo.ref})`;
  const text = (replyTo.text ?? '').replace(/\s+/g, ' ').trim();
  const excerpt = text.length > QUOTE_EXCERPT ? `${text.slice(0, QUOTE_EXCERPT)}…` : text;
  return excerpt ? `(respondendo à sua fala "${excerpt}")` : '(respondendo a você)';
}

/** Corpo de uma fala de alguém: mídia, citação e texto, nessa ordem. */
export function body(entry: Entry, byRef: ReadonlyMap<string, Entry>): string {
  const reply = entry.replyTo ? replyNote(byRef.get(entry.replyTo)) : '';
  return [reply, entry.media ? mediaLabel(entry) : '', entry.text ?? ''].filter(Boolean).join(' ');
}

/**
 * A transcrição em turnos para o modelo: as falas seguidas das pessoas viram um turno `user`, uma
 * linha `[#m12 16:30] Nome: fala` por mensagem; as da Luma, um turno `assistant` só com o texto,
 * para ela não imitar o cabeçalho na resposta.
 */
export function toTurns(entries: readonly Entry[], timeZone: string): Turn[] {
  const byRef = new Map(entries.map((e) => [e.ref, e]));
  const turns: { role: Turn['role']; lines: string[] }[] = [];
  for (const entry of entries) {
    const role = entry.fromLuma ? 'assistant' : 'user';
    const line = entry.fromLuma
      ? (entry.text ?? '')
      : `${header(entry, timeZone)} ${entry.name}: ${body(entry, byRef)}`;
    if (!line) continue;
    const last = turns.at(-1);
    if (last?.role === role) last.lines.push(line);
    else turns.push({ role, lines: [line] });
  }
  return turns.map((t) => ({ role: t.role, text: t.lines.join('\n') }));
}

/** Modelo que imita o cabeçalho da transcrição na resposta: tira antes de ir ao chat. */
export const stripHeader = (text: string) => text.replace(/^\[#m\d+[^\]]*\]\s*(?:➜\s*)?/, '');
