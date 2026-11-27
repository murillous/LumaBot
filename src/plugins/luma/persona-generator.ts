// Criação de persona a partir de uma descrição livre. Puro: monta o pedido à IA e valida o objeto
// que ela devolve (saída estruturada); quem chama a IA é o plugin, pelo serviço `ai`.

import { z } from 'zod';
import { FORMAT_TRAIT, type Persona } from './personas.ts';

/** Limites de cada campo: o excesso é cortado, menos nos traços, que podem recusar. */
const LIMITS = { name: 40, description: 120, context: 600, style: 300, trait: 200 };
export const MIN_TRAITS = 3;
export const MAX_TRAITS = 8;

/** A IA não devolveu uma persona aproveitável (objeto ausente, campo vazio, poucos traços). */
export class PersonaParseError extends Error {
  override readonly name = 'PersonaParseError';
}

/** Persona sem a `key`, que o plugin deriva do nome com `slugify`. */
export type GeneratedPersona = Omit<Persona, 'key'>;

/** Schema da resposta da IA (saída estruturada); `parsePersona` corta e confere o conteúdo. */
export const personaSchema = z.object({
  name: z.string(),
  description: z.string(),
  context: z.string(),
  style: z.string(),
  traits: z.array(z.string()),
});

export function personaPrompt(description: string): string {
  return (
    'Você é um gerador de personalidades para uma assistente de WhatsApp chamada Luma.\n' +
    'A partir da descrição livre abaixo, crie uma personalidade coerente.\n\n' +
    `name: curto e marcante (até ${LIMITS.name} caracteres). ` +
    'description: uma linha com a vibe, pode começar com emoji. ' +
    `context: quem ela é, em 2ª pessoa ('Você é...'), até ${LIMITS.context} caracteres. ` +
    `style: tom, gírias, emojis, até ${LIMITS.style} caracteres. ` +
    `traits: ${MIN_TRAITS} a ${MAX_TRAITS} comportamentos, cada um até ${LIMITS.trait} caracteres.\n\n` +
    'Não inclua regras de formato/tamanho de mensagem nos traits — isso é adicionado automaticamente.\n\n' +
    `Descrição: ${description}`
  );
}

const cut = (value: unknown, max: number): string =>
  typeof value === 'string' ? [...value.trim()].slice(0, max).join('').trim() : '';

/**
 * Valida e normaliza o objeto da IA. Recusa objeto ausente, `name`/`context`/`style` vazios e
 * menos de {@link MIN_TRAITS} traços; o traço de formato é anexado aqui, nunca vem do modelo.
 */
export function parsePersona(output: unknown): GeneratedPersona {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new PersonaParseError('a IA não devolveu um objeto de persona');
  }
  const raw = output as Record<string, unknown>;

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
