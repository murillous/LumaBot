import { describe, expect, it } from 'vitest';
import { PersonaParseError, parsePersona, personaPrompt, slugify } from './persona-generator.ts';
import { FORMAT_TRAIT } from './personas.ts';

const valid = {
  name: 'Vovó Italiana',
  description: '👵 carinhosa e brava',
  context: 'Você é uma vovó italiana.',
  style: 'fala com sotaque',
  traits: ['faz massa', 'chama de bambino', 'reclama de tudo'],
};

describe('parsePersona', () => {
  it('aceita o JSON puro e anexa o traço de formato', () => {
    const persona = parsePersona(JSON.stringify(valid));

    expect(persona).toMatchObject({ name: 'Vovó Italiana', style: 'fala com sotaque' });
    expect(persona.traits).toEqual([...valid.traits, FORMAT_TRAIT]);
  });

  it('tolera cerca de código e texto em volta', () => {
    const text = `Claro!\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\nEspero que goste.`;

    expect(parsePersona(text).name).toBe('Vovó Italiana');
  });

  it('corta o que passa do limite e ignora traço vazio', () => {
    const persona = parsePersona(
      JSON.stringify({
        ...valid,
        name: 'x'.repeat(100),
        traits: [...valid.traits, '', '   ', 7],
      }),
    );

    expect([...persona.name]).toHaveLength(40);
    expect(persona.traits).toHaveLength(4);
  });

  it('limita a 8 traços (mais o de formato)', () => {
    const traits = Array.from({ length: 12 }, (_, i) => `traço ${i}`);

    expect(parsePersona(JSON.stringify({ ...valid, traits })).traits).toHaveLength(9);
  });

  it('usa o nome quando a descrição vem vazia', () => {
    expect(parsePersona(JSON.stringify({ ...valid, description: '' })).description).toBe(
      'Vovó Italiana',
    );
  });

  it.each([
    ['sem JSON', 'não consegui'],
    ['JSON quebrado', '{ "name": '],
    ['array', '[1, 2]'],
    ['sem nome', JSON.stringify({ ...valid, name: '' })],
    ['sem contexto', JSON.stringify({ ...valid, context: undefined })],
    ['poucos traços', JSON.stringify({ ...valid, traits: ['um', 'dois'] })],
    ['traços que não são lista', JSON.stringify({ ...valid, traits: 'muitos' })],
  ])('recusa: %s', (_, text) => {
    expect(() => parsePersona(text)).toThrow(PersonaParseError);
  });
});

describe('slugify', () => {
  it('kebab-case sem acento', () => {
    expect(slugify('Vovó Italiana!')).toBe('vovo-italiana');
  });

  it('nome sem letras vira "persona"', () => {
    expect(slugify('✨✨')).toBe('persona');
  });

  it('colisão ganha sufixo numérico', () => {
    expect(slugify('Vovó', ['vovo', 'vovo-2'])).toBe('vovo-3');
    expect(slugify('Vovó', ['outra'])).toBe('vovo');
  });
});

describe('personaPrompt', () => {
  it('leva a descrição e pede só JSON', () => {
    const prompt = personaPrompt('um pirata');

    expect(prompt).toContain('Descrição: um pirata');
    expect(prompt).toContain('APENAS com um objeto JSON');
  });
});
