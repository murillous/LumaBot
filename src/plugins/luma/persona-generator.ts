// Criação de persona a partir de uma descrição livre. Puro: monta o pedido à IA e valida o JSON
// que ela devolve; quem chama a IA é o plugin, pelo serviço `ai`.

import { FORMAT_TRAIT, type Persona } from './personas.ts';

/** Limites de cada campo: o excesso é cortado, menos nos traços, que podem recusar. */
const LIMITS = { name: 40, description: 120, context: 600, style: 300, trait: 200 };
export const MIN_TRAITS = 3;
export const MAX_TRAITS = 8;

/** A IA não devolveu uma persona aproveitável (JSON ausente, campo faltando, poucos traços). */
export class PersonaParseError extends Error {
  override readonly name = 'PersonaParseError';
}

/** Persona sem a `key`, que o plugin deriva do nome com `slugify`. */
export type GeneratedPersona = Omit<Persona, 'key'>;

export function personaPrompt(description: string): string {
  return (
    'Você é um gerador de personalidades para uma assistente de WhatsApp chamada Luma.\n' +
    'A partir da descrição livre abaixo, crie uma personalidade coerente e responda APENAS com um objeto JSON válido, sem texto extra e sem cercas de código.\n\n' +
    'Formato exato do JSON:\n' +
    '{\n' +
    `  "name": "nome curto e marcante da persona (até ${LIMITS.name} caracteres)",\n` +
    '  "description": "uma linha curta resumindo a vibe, pode começar com um emoji",\n' +
    `  "context": "quem a persona é, em 2ª pessoa ('Você é...'), até ${LIMITS.context} caracteres",\n` +
    `  "style": "como ela escreve: tom, gírias, uso de emojis, até ${LIMITS.style} caracteres",\n` +
    `  "traits": ["entre ${MIN_TRAITS} e ${MAX_TRAITS} traços de comportamento, cada um até ${LIMITS.trait} caracteres"]\n` +
    '}\n\n' +
    'Não inclua regras de formato/tamanho de mensagem nos traits — isso é adicionado automaticamente.\n\n' +
    `Descrição: ${description}`
  );
}

/** O objeto JSON do texto da IA, tolerando cerca de código e texto em volta. */
function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const cut = (value: unknown, max: number): string =>
  typeof value === 'string' ? [...value.trim()].slice(0, max).join('').trim() : '';

/**
 * Valida e normaliza a resposta da IA. Recusa JSON ausente, `name`/`context`/`style` vazios e
 * menos de {@link MIN_TRAITS} traços; o traço de formato é anexado aqui, nunca vem do modelo.
 */
export function parsePersona(text: string): GeneratedPersona {
  const raw = extractJson(text);
  if (!raw) throw new PersonaParseError('a IA não devolveu um JSON de persona');

  const name = cut(raw['name'], LIMITS.name);
  const context = cut(raw['context'], LIMITS.context);
  const style = cut(raw['style'], LIMITS.style);
  if (!name || !context || !style) {
    throw new PersonaParseError('persona incompleta (name, context ou style ausente)');
  }

  const traits = (Array.isArray(raw['traits']) ? raw['traits'] : [])
    .map((t) => cut(t, LIMITS.trait))
    .filter(Boolean)
    .slice(0, MAX_TRAITS);
  if (traits.length < MIN_TRAITS) {
    throw new PersonaParseError(`persona com ${traits.length} traço(s); o mínimo é ${MIN_TRAITS}`);
  }

  return {
    name,
    description: cut(raw['description'], LIMITS.description) || name,
    context,
    style,
    traits: [...traits, FORMAT_TRAIT],
  };
}

/** Slug em kebab-case do nome, sem acento; colisão ganha `-2`, `-3`... */
export function slugify(name: string, taken: Iterable<string> = []): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'persona';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
