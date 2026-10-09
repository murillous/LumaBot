// Texto formatado neutro (ADR 0061). O plugin monta uma árvore mínima com os helpers, e o
// transport a traduz para a marcação da plataforma, com o escape dela. Texto cru (string) continua
// valendo e vai ao transport como veio.

import type { Contact } from '#message/types.ts';

/** O que uma menção precisa para virar `@número`, `<@id>` ou `text_mention` no transport. */
export type MentionTarget = Pick<Contact, 'id' | 'name' | 'phone' | 'username'>;

/** Nó da árvore de `FormattedText`. Uma string é texto literal, que o transport escapa. */
export type TextNode =
  | string
  | { readonly type: 'bold' | 'italic'; readonly children: readonly TextNode[] }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'link'; readonly url: string; readonly children: readonly TextNode[] }
  | { readonly type: 'mention'; readonly contact: MentionTarget };

/** Texto formatado neutro, congelado. Monte com `fmt`, `bold`, `italic`, `code`, `link` e `mention`. */
export interface FormattedText {
  readonly type: 'formatted';
  readonly nodes: readonly TextNode[];
}

/** Texto que o plugin envia: cru (a marcação da plataforma, sem escape) ou formatado neutro. */
export type MessageText = string | FormattedText;

/** Parte que os helpers aceitam: texto literal ou outro trecho formatado. */
export type TextPart = string | FormattedText;

/** Monta o `FormattedText`; os nós já vêm validados e congelados. */
export function formatted(nodes: readonly TextNode[]): FormattedText {
  return Object.freeze({ type: 'formatted', nodes: Object.freeze([...nodes]) });
}

/** Nós de `parts`, sem string vazia; lança `TypeError` para o que não é texto (JS sem tipos). */
function nodesOf(parts: readonly unknown[], where: string): TextNode[] {
  const nodes: TextNode[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      if (part !== '') nodes.push(part);
    } else if (isFormatted(part)) {
      nodes.push(...part.nodes);
    } else {
      throw new TypeError(`${where}: esperava string ou texto formatado, recebeu ${typeof part}`);
    }
  }
  return nodes;
}

export function isFormatted(value: unknown): value is FormattedText {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'formatted' &&
    Array.isArray((value as { nodes?: unknown }).nodes)
  );
}

// Um estilo sem conteúdo some: `****` no Discord e entity vazia no Telegram dão erro ou lixo.
function style(type: 'bold' | 'italic', parts: readonly TextPart[]): FormattedText {
  const children = nodesOf(parts, type);
  if (children.length === 0) return formatted([]);
  return formatted([Object.freeze({ type, children: Object.freeze(children) })]);
}

export function bold(...parts: TextPart[]): FormattedText {
  return style('bold', parts);
}

export function italic(...parts: TextPart[]): FormattedText {
  return style('italic', parts);
}

/** Código em linha. O conteúdo é sempre literal: não aceita outra formatação dentro. */
export function code(text: string): FormattedText {
  if (typeof text !== 'string') throw new TypeError('code: esperava string');
  if (text === '') return formatted([]);
  return formatted([Object.freeze({ type: 'code', text })]);
}

/**
 * Link com rótulo; sem rótulo, mostra a URL. Só `http:` e `https:`: no web a URL vira `href`, e
 * `javascript:` seria XSS.
 */
export function link(url: string, label?: TextPart): FormattedText {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new TypeError(`link: URL inválida: ${String(url)}`, { cause: error });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError(`link: só http e https são aceitos: ${url}`);
  }
  const children = nodesOf([label ?? url], 'link');
  return formatted([
    Object.freeze({
      type: 'link',
      url,
      children: Object.freeze(children.length ? children : [url]),
    }),
  ]);
}

/**
 * Menção portátil. O transport põe a sintaxe da plataforma e notifica o contato. Guarda só os
 * campos de que precisa, para não levar os `claims` do contato ao conteúdo enviado.
 */
export function mention(contact: MentionTarget): FormattedText {
  if (typeof contact?.id !== 'string' || contact.id === '') {
    throw new TypeError('mention: o contato precisa de um `id`');
  }
  const target: MentionTarget = Object.freeze({
    id: contact.id,
    name: contact.name ?? null,
    phone: contact.phone ?? null,
    ...(contact.username !== undefined && { username: contact.username }),
  });
  return formatted([Object.freeze({ type: 'mention', contact: target })]);
}

/**
 * Tag que compõe o texto: `` fmt`Notas de ${bold(aluno)}: ${nota}` ``. Valores interpolados são
 * literais, então o texto do usuário nunca vira marcação.
 */
export function fmt(
  strings: TemplateStringsArray,
  ...values: readonly (TextPart | number)[]
): FormattedText {
  const parts: unknown[] = [];
  strings.forEach((literal, index) => {
    parts.push(literal);
    if (index < values.length) {
      const value = values[index];
      parts.push(typeof value === 'number' ? String(value) : value);
    }
  });
  return formatted(nodesOf(parts, 'fmt'));
}

/**
 * Texto visível, sem marcação: o que a pessoa lê. Uma menção vira `@` mais o usuário, o nome, o
 * telefone ou o ID, nessa ordem. A string crua volta como está.
 */
export function plainText(text: MessageText): string {
  if (typeof text === 'string') return text;
  let out = '';
  const walk = (nodes: readonly TextNode[]): void => {
    for (const node of nodes) {
      if (typeof node === 'string') out += node;
      else if (node.type === 'code') out += node.text;
      else if (node.type === 'mention') out += `@${mentionLabel(node.contact)}`;
      else walk(node.children);
    }
  };
  walk(text.nodes);
  return out;
}

function mentionLabel(contact: MentionTarget): string {
  return contact.username ?? contact.name ?? contact.phone ?? contact.id;
}
