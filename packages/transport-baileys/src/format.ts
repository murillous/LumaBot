// Texto formatado neutro do core (ADR 0061) na marcação do WhatsApp: `*negrito*`, `_itálico_`,
// `` `código` `` e `@número` com o JID na lista de menções. Função pura.

import type { FormattedText, TextNode } from '@zapforge/core';
import { jidDecode } from 'baileys';

export interface RenderedText {
  readonly text: string;
  /** JIDs das menções da árvore, na ordem e sem repetição. */
  readonly mentions: readonly string[];
}

/**
 * Renderiza a árvore. O WhatsApp não tem escape: um `*` literal do texto pode casar com outro e
 * virar negrito, como já acontece no app. Por isso o texto literal vai como está.
 */
export function renderWhatsApp(text: FormattedText): RenderedText {
  const mentions = new Set<string>();
  const render = (nodes: readonly TextNode[]): string => {
    let out = '';
    for (const node of nodes) {
      if (typeof node === 'string') {
        out += node;
        continue;
      }
      switch (node.type) {
        case 'bold':
        case 'italic':
          out += wrap(node.type === 'bold' ? '*' : '_', render(node.children));
          break;
        case 'code':
          out += wrap('`', node.text);
          break;
        case 'link': {
          // O WhatsApp não tem link com rótulo: a URL aparece e vira link sozinha.
          const label = render(node.children);
          out += label === node.url ? node.url : `${label} (${node.url})`;
          break;
        }
        case 'mention':
          mentions.add(node.contact.id);
          // O app troca `@<usuário do JID>` pelo nome do contato, inclusive com LID.
          out += `@${jidDecode(node.contact.id)?.user ?? node.contact.id}`;
          break;
      }
    }
    return out;
  };
  return { text: render(text.nodes), mentions: [...mentions] };
}

/**
 * O marcador só vale colado no texto (`* a *` sai literal): o espaço das pontas fica do lado de
 * fora.
 */
function wrap(marker: string, inner: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  const [, lead = '', core = '', trail = ''] = match ?? [];
  if (core === '') return inner;
  return `${lead}${marker}${core}${marker}${trail}`;
}
