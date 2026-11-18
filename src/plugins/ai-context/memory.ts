// Memória de longo prazo do bot: blocos pequenos de fatos duráveis ("o João é corintiano"), um
// do chat e um de cada pessoa no chat, no storage. Entram no fim da instrução de sistema (estilo
// core memory do Letta) e só mudam quando ele lembra ou esquece, então o cache do prompt continua.
// Tudo é por chat: o que alguém conta no privado nunca aparece no grupo, nem o contrário.

import type { Collection } from '@usebridger/core';
import { z } from 'zod';
import { personId } from '#plugins/ai/person-id.ts';
import { type AiTool, aiTool, fail, ok } from '#plugins/ai/tools.ts';
import { DEFAULT_SPEECH, fill, type Speech } from './texts.ts';
import type { Entry } from './transcript.ts';

/** Um fato guardado. `about` vazio é do chat; senão, o `personId` de quem ele fala. */
export type MemoryDoc = {
  chatId: string;
  about: string;
  /** Nome da pessoa quando o fato foi guardado; o da transcrição vence, se ela falou há pouco. */
  name: string;
  text: string;
  /** Última vez que o fato foi lembrado (epoch em ms): é por ele que expira. */
  at: number;
};

/** Os blocos de um chat como vão ao prompt. */
export interface MemoryBlocks {
  readonly chat: readonly string[];
  readonly people: readonly { readonly name: string; readonly facts: readonly string[] }[];
}

export type RememberResult =
  | { readonly ok: true; readonly facts: readonly string[] }
  | { readonly ok: false; readonly facts: readonly string[] };

export interface LongMemory {
  /** O bloco do chat e os das pessoas dadas (`personId` → nome), sem os fatos expirados. */
  blocks(chatId: string, people: ReadonlyMap<string, string>): Promise<MemoryBlocks>;
  /**
   * Guarda o fato no bloco (`about` vazio = do chat). Fato repetido só renova o prazo. Bloco
   * cheio recusa com os fatos que ele tem, para o bot esquecer algum antes.
   */
  remember(chatId: string, about: string, name: string, text: string): Promise<RememberResult>;
  /** Apaga do bloco os fatos que batem com `text` (ou todos, sem `text`); devolve quantos. */
  forget(chatId: string, about: string, text?: string): Promise<number>;
  /** Os fatos de um bloco, para o bot ver o que tem antes de esquecer. */
  facts(chatId: string, about: string): Promise<string[]>;
  /** Quem tem bloco no chat (`personId` → nome guardado com o fato mais recente). */
  known(chatId: string): Promise<Map<string, string>>;
  /** Esquece tudo do chat. Devolve quantos fatos saíram. */
  clear(chatId: string): Promise<number>;
}

interface Options {
  /** Caracteres de cada bloco, somando os fatos. */
  readonly blockChars: number;
  /** Fato sem ser lembrado há mais que isso sai. */
  readonly maxAgeMs: number;
  readonly now?: () => number;
}

/** Para comparar nomes e fatos: sem acento, caixa e espaço sobrando. */
export const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const matches = (fact: string, query: string): boolean => {
  const f = normalize(fact);
  const q = normalize(query);
  return q !== '' && (f.includes(q) || q.includes(f));
};

const size = (facts: readonly string[]): number => facts.reduce((n, f) => n + f.length + 1, 0);

export function createMemory(
  docs: Collection<MemoryDoc>,
  { blockChars, maxAgeMs, now = Date.now }: Options,
): LongMemory {
  /** Os fatos vivos do chat; os expirados saem do storage aqui, sem timer. */
  const alive = async (chatId: string) => {
    const cutoff = now() - maxAgeMs;
    await docs.delete({ chatId, at: { lt: cutoff } });
    return docs.find({ where: { chatId }, orderBy: 'at' });
  };

  const facts = async (chatId: string, about: string) =>
    (await alive(chatId)).filter((d) => d.about === about).map((d) => d.text);

  return {
    async blocks(chatId, people) {
      const all = await alive(chatId);
      const chat = all.filter((d) => d.about === '').map((d) => d.text);
      // Ordem fixa (pelo id da pessoa): o mesmo conjunto de pessoas dá o mesmo texto, e o prefixo
      // do prompt não muda à toa.
      const ids = [...people.keys()].sort();
      const blocks = ids.flatMap((id) => {
        const own = all.filter((d) => d.about === id);
        if (own.length === 0) return [];
        return [{ name: people.get(id) ?? own.at(-1)?.name ?? '?', facts: own.map((d) => d.text) }];
      });
      return { chat, people: blocks };
    },
    async remember(chatId, about, name, text) {
      const current = (await alive(chatId)).filter((d) => d.about === about);
      const same = current.find((d) => normalize(d.text) === normalize(text));
      if (same) {
        await docs.update(same.id, { at: now(), name });
        return { ok: true, facts: current.map((d) => d.text) };
      }
      const existing = current.map((d) => d.text);
      if (size(existing) + text.length + 1 > blockChars) return { ok: false, facts: existing };
      await docs.insert({ chatId, about, name, text, at: now() });
      return { ok: true, facts: [...existing, text] };
    },
    async forget(chatId, about, text) {
      const current = (await alive(chatId)).filter((d) => d.about === about);
      const gone = text === undefined ? current : current.filter((d) => matches(d.text, text));
      for (const d of gone) await docs.delete(d.id);
      return gone.length;
    },
    facts,
    async known(chatId) {
      const people = new Map<string, string>();
      for (const d of await alive(chatId)) if (d.about !== '') people.set(d.about, d.name);
      return people;
    },
    clear: (chatId) => docs.delete({ chatId }),
  };
}

/** Os blocos como fecham a instrução de sistema; `''` sem nenhum fato. */
export function renderMemory(blocks: MemoryBlocks, speech: Speech = DEFAULT_SPEECH): string {
  const { texts } = speech;
  const sections: string[] = [];
  if (blocks.chat.length > 0) {
    sections.push(`${texts.memoryChat}\n${blocks.chat.map((f) => `- ${f}`).join('\n')}`);
  }
  for (const p of blocks.people) {
    const title = fill(texts.memoryPerson, { name: p.name });
    sections.push(`${title}\n${p.facts.map((f) => `- ${f}`).join('\n')}`);
  }
  return sections.join('\n\n');
}

/** Quem falou na transcrição (`personId` → nome mais recente), para achar o bloco pelo nome. */
export function peopleOf(entries: readonly Entry[]): Map<string, string> {
  const people = new Map<string, string>();
  for (const e of entries) if (!e.fromSelf && e.person) people.set(e.person, e.name);
  return people;
}

/** O ato de lembrar ou esquecer, para a auditoria; nunca o fato. */
export type MemoryAudit = (
  action: 'ai-context.memory.remember' | 'ai-context.memory.forget',
  ctx: { readonly chatId: string; readonly isGroup: boolean; readonly block: 'chat' | 'person' },
) => void;

interface ToolDeps {
  readonly memory: LongMemory;
  /** As falas vivas do chat, para achar a pessoa pelo nome. */
  readonly entries: (chatId: string) => readonly Entry[];
  readonly audit: MemoryAudit;
  readonly speech?: Speech;
}

const MAX_FACT = 200;

/**
 * A pessoa pelo nome: quem falou na transcrição ou quem já tem bloco no chat. `undefined` sem o
 * nome (o bloco do chat); `null` se ninguém com esse nome.
 */
async function resolve(
  deps: ToolDeps,
  chatId: string,
  sender: { id: string; name: string },
  name: string | undefined,
): Promise<{ id: string; name: string } | null | undefined> {
  if (name === undefined || normalize(name) === '') return undefined;
  const wanted = normalize(name);
  if (normalize(sender.name) === wanted) return sender;
  const people = peopleOf(deps.entries(chatId));
  for (const [id, n] of people) if (normalize(n) === wanted) return { id, name: n };
  // Quem não falou nas últimas horas ainda pode ter bloco: o nome guardado com o fato serve.
  for (const [id, n] of await deps.memory.known(chatId)) {
    if (normalize(n) === wanted) return { id, name: n };
  }
  return null;
}

/** `remember` e `forget`: o bot edita a própria memória longa do chat. */
export function memoryTools(deps: ToolDeps): AiTool[] {
  const { texts } = deps.speech ?? DEFAULT_SPEECH;
  const person = z.string().optional().describe(texts.toolPerson);
  const senderOf = (t: Parameters<AiTool['run']>[1]) => {
    const chatId = t.message.chat.id;
    const id = personId(t.message.sender);
    const name =
      peopleOf(deps.entries(chatId)).get(id) ?? t.message.sender.name ?? texts.unknownSender;
    return { id, name };
  };

  const remember = aiTool({
    name: 'remember',
    description: texts.toolRemember,
    args: z.object({
      fact: z.string().min(1).max(MAX_FACT).describe(texts.toolRememberFact),
      person,
    }),
    sideEffects: true,
    run: async ({ fact, person: name }, t) => {
      const chatId = t.message.chat.id;
      const sender = senderOf(t);
      const who = await resolve(deps, chatId, sender, name);
      if (who === null) return fail('unknown-person', name);
      const result = await deps.memory.remember(
        chatId,
        who?.id ?? '',
        who?.name ?? '',
        fact.trim(),
      );
      if (!result.ok) return fail('full', result.facts.join(' | '));
      deps.audit('ai-context.memory.remember', {
        chatId,
        isGroup: t.message.chat.isGroup,
        block: who ? 'person' : 'chat',
      });
      return ok({ facts: [...result.facts] });
    },
  });

  const forget = aiTool({
    name: 'forget',
    description: texts.toolForget,
    args: z.object({
      fact: z.string().optional().describe(texts.toolForgetFact),
      person,
    }),
    sideEffects: true,
    run: async ({ fact, person: name }, t) => {
      const chatId = t.message.chat.id;
      const who = await resolve(deps, chatId, senderOf(t), name);
      if (who === null) return fail('unknown-person', name);
      const about = who?.id ?? '';
      const removed = await deps.memory.forget(chatId, about, fact);
      if (removed === 0) {
        return fail('not-found', (await deps.memory.facts(chatId, about)).join(' | '));
      }
      deps.audit('ai-context.memory.forget', {
        chatId,
        isGroup: t.message.chat.isGroup,
        block: who ? 'person' : 'chat',
      });
      return ok({ removed });
    },
  });

  return [remember, forget];
}
