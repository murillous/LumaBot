// Divisão de texto longo em partes que cabem no limite do transport (ADR 0061). Corta num
// parágrafo, depois numa linha, num espaço e, por último, num caractere; um nó partido continua
// formatado nas duas partes.

import { formatted, type MessageText, type TextNode } from './format.ts';

type Wrapper = Extract<TextNode, { readonly children: readonly TextNode[] }>;
type Leaf = Extract<TextNode, { readonly type: 'code' | 'mention' }>;

/** Trecho achatado: texto (de string ou de `code`) ou menção, com os estilos que o envolvem. */
interface Segment {
  /** Estilos e links de fora para dentro; a identidade do nó junta os pedaços de volta. */
  readonly wrap: readonly Wrapper[];
  /** Vazio na menção, que nunca é cortada. */
  readonly text: string;
  /** O `code` de origem ou a menção; `null` no texto literal. */
  readonly leaf: Leaf | null;
}

export interface SplitLimits {
  /** Limite da primeira parte (a legenda, quando a primeira parte é a mídia). */
  readonly first: number;
  /** Limite das outras partes. */
  readonly rest: number;
}

const SEPARATORS = ['\n\n', '\n', ' ', ''] as const;

/**
 * Divide `text` em partes com `measure(parte)` dentro do limite. Um texto que cabe volta sozinho,
 * sem cópia. Um caractere ou uma menção maior que o limite sai sozinho numa parte: não há como
 * cortar menos, e o transport rejeita.
 */
export function splitText(
  text: MessageText,
  limits: SplitLimits,
  measure: (text: MessageText) => number,
): MessageText[] {
  if (measure(text) <= limits.first) return [text];
  const raw = typeof text === 'string';
  const build = (segments: readonly Segment[]): MessageText =>
    raw ? segments.map((s) => s.text).join('') : formatted(rebuild(segments, 0));
  const chunks: Segment[][] = [];
  // Mede a parte já sem o espaço das pontas, como ela sai: o separador fica no fim do pedaço.
  const fits = (segments: readonly Segment[]): boolean =>
    measure(build(trim(segments))) <= (chunks.length === 0 ? limits.first : limits.rest);

  const pack = (segments: readonly Segment[], level: number): void => {
    const pieces = cut(segments, SEPARATORS[level] ?? '');
    let i = 0;
    while (i < pieces.length) {
      if (!fits(pieces[i] ?? [])) {
        if (level < SEPARATORS.length - 1) pack(pieces[i] ?? [], level + 1);
        else chunks.push(pieces[i] ?? []);
        i++;
        continue;
      }
      // Busca galopante: dobra até não caber e refina por bisseção. Cada medida custa no máximo
      // o dobro do limite, e o total fica em O(n log n).
      let ok = 1;
      let bad = 2;
      while (i + bad <= pieces.length && fits(join(pieces, i, bad))) {
        ok = bad;
        bad *= 2;
      }
      bad = Math.min(bad, pieces.length - i + 1);
      while (bad - ok > 1) {
        const mid = (ok + bad) >> 1;
        if (fits(join(pieces, i, mid))) ok = mid;
        else bad = mid;
      }
      chunks.push(join(pieces, i, ok));
      i += ok;
    }
  };
  pack(flatten(text), 0);

  const out: MessageText[] = [];
  for (const chunk of chunks) {
    const trimmed = trim(chunk);
    if (trimmed.length > 0) out.push(build(trimmed));
  }
  return out;
}

function join(pieces: readonly Segment[][], start: number, count: number): Segment[] {
  return pieces.slice(start, start + count).flat();
}

function flatten(text: MessageText): Segment[] {
  if (typeof text === 'string') return [{ wrap: [], text, leaf: null }];
  const out: Segment[] = [];
  const walk = (nodes: readonly TextNode[], wrap: readonly Wrapper[]): void => {
    for (const node of nodes) {
      if (typeof node === 'string') out.push({ wrap, text: node, leaf: null });
      else if (node.type === 'code') out.push({ wrap, text: node.text, leaf: node });
      else if (node.type === 'mention') out.push({ wrap, text: '', leaf: node });
      else walk(node.children, [...wrap, node]);
    }
  };
  walk(text.nodes, []);
  return out;
}

/** Corta logo depois de cada `separator` (ou entre code points, com `''`); a menção não corta. */
function cut(segments: readonly Segment[], separator: string): Segment[][] {
  const pieces: Segment[][] = [];
  let current: Segment[] = [];
  for (const segment of segments) {
    if (segment.leaf?.type === 'mention') {
      current.push(segment);
      continue;
    }
    let start = 0;
    for (const end of cutPoints(segment.text, separator)) {
      current.push({ ...segment, text: segment.text.slice(start, end) });
      pieces.push(current);
      current = [];
      start = end;
    }
    if (start < segment.text.length) current.push({ ...segment, text: segment.text.slice(start) });
  }
  if (current.length > 0) pieces.push(current);
  return pieces;
}

function* cutPoints(text: string, separator: string): Generator<number> {
  if (separator === '') {
    // Por code point: partir um par surrogate deixaria um caractere inválido em cada parte.
    let index = 0;
    for (const char of text) {
      index += char.length;
      yield index;
    }
    return;
  }
  // Inclusive no fim do trecho: o separador pode ser o último caractere antes de um estilo.
  for (let at = text.indexOf(separator); at !== -1; at = text.indexOf(separator, at)) {
    at += separator.length;
    yield at;
  }
}

/** Tira o espaço em branco das pontas da parte (fora de `code`) e os trechos que ficam vazios. */
function trim(chunk: readonly Segment[]): Segment[] {
  const out = [...chunk];
  const edge = (index: number, re: RegExp): void => {
    const segment = out[index];
    if (segment === undefined || segment.leaf !== null) return;
    out[index] = { ...segment, text: segment.text.replace(re, '') };
  };
  while (out.length > 0) {
    edge(0, /^\s+/);
    if (out[0]?.leaf === null && out[0].text === '') out.shift();
    else break;
  }
  while (out.length > 0) {
    edge(out.length - 1, /\s+$/);
    if (out.at(-1)?.leaf === null && out.at(-1)?.text === '') out.pop();
    else break;
  }
  return out;
}

/** Remonta a árvore: trechos seguidos com o mesmo nó de estilo voltam para um nó só. */
function rebuild(segments: readonly Segment[], depth: number): TextNode[] {
  const out: TextNode[] = [];
  let i = 0;
  while (i < segments.length) {
    const segment = segments[i] as Segment;
    const wrapper = segment.wrap[depth];
    if (wrapper !== undefined) {
      let j = i + 1;
      while (j < segments.length && segments[j]?.wrap[depth] === wrapper) j++;
      const children = rebuild(segments.slice(i, j), depth + 1);
      out.push(
        Object.freeze(
          wrapper.type === 'link'
            ? { type: 'link', url: wrapper.url, children: Object.freeze(children) }
            : { type: wrapper.type, children: Object.freeze(children) },
        ),
      );
      i = j;
      continue;
    }
    const { leaf } = segment;
    if (leaf?.type === 'mention') {
      out.push(leaf);
      i++;
      continue;
    }
    let j = i + 1;
    let text = segment.text;
    while (
      j < segments.length &&
      segments[j]?.wrap.length === depth &&
      segments[j]?.leaf === leaf
    ) {
      text += segments[j]?.text ?? '';
      j++;
    }
    if (text !== '') out.push(leaf === null ? text : Object.freeze({ type: 'code', text }));
    i = j;
  }
  return out;
}
