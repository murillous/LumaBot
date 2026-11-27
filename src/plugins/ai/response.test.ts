import { describe, expect, it } from 'vitest';
import { cleanResponse, splitIntoParts } from './response.ts';

describe('cleanResponse', () => {
  it('tira o raciocínio, o rótulo e os espaços', () => {
    expect(cleanResponse('  <think>hmm\ncalcula</think>Luma: oi, tudo bem?  ')).toBe(
      'oi, tudo bem?',
    );
  });

  it('limita a repetição desenfreada de um caractere a 30', () => {
    expect(cleanResponse(`a${'k'.repeat(200)}b`)).toBe(`a${'k'.repeat(30)}b`);
  });

  it('deixa passar a repetição curta', () => {
    expect(cleanResponse('kkkkkkk')).toBe('kkkkkkk');
  });

  it('link em markdown vira texto e URL soltos, que o WhatsApp abre', () => {
    expect(cleanResponse('olha [esse vídeo](https://youtu.be/abc?t=3) kkk')).toBe(
      'olha esse vídeo: https://youtu.be/abc?t=3 kkk',
    );
  });

  it('link em markdown cujo texto é a própria URL fica só com a URL', () => {
    expect(cleanResponse('[https://g1.com/x](https://g1.com/x)')).toBe('https://g1.com/x');
  });

  it('texto vazio continua vazio', () => {
    expect(cleanResponse('<think>só pensando</think>')).toBe('');
  });
});

describe('splitIntoParts', () => {
  const opts = { maxLength: 30, maxParts: 2 };

  it('divide pelo marcador [PARTE]', () => {
    expect(splitIntoParts('um[PARTE]dois', opts)).toEqual(['um', 'dois']);
  });

  it('acima do teto, o excedente marcado vai junto no último balão', () => {
    expect(splitIntoParts('um[PARTE]dois[PARTE]três', opts)).toEqual(['um', 'dois\n\ntrês']);
  });

  it('com teto 1, tudo vai num balão só', () => {
    expect(splitIntoParts('um[PARTE]dois', { ...opts, maxParts: 1 })).toEqual(['um\n\ndois']);
  });

  it('com um marcador só e texto curto, devolve o texto como veio', () => {
    expect(splitIntoParts('só um[PARTE]', { ...opts, maxLength: 100 })).toEqual(['só um[PARTE]']);
  });

  it('texto curto sem marcador fica inteiro', () => {
    expect(splitIntoParts('oi tudo bem', opts)).toEqual(['oi tudo bem']);
  });

  it('corta o texto longo numa pontuação perto do limite', () => {
    const text = 'Eu fui ao mercado ontem. Comprei pão e leite e voltei.';
    expect(splitIntoParts(text, opts)).toEqual([
      'Eu fui ao mercado ontem.',
      'Comprei pão e leite e voltei.',
    ]);
  });

  it('sem ponto natural, corta no limite', () => {
    expect(splitIntoParts('a'.repeat(50), opts)).toEqual(['a'.repeat(30), 'a'.repeat(20)]);
  });

  it('não corta no meio de um link: ele vai inteiro para o balão seguinte', () => {
    const url = 'https://youtu.be/abcdefg';
    expect(splitIntoParts(`olha esse aqui mano ${url} kkk`, opts)).toEqual([
      'olha esse aqui mano',
      `${url} kkk`,
    ]);
  });

  it('link maior que o balão vai inteiro, passando do limite', () => {
    const url = `https://exemplo.com/${'a'.repeat(40)}`;
    expect(splitIntoParts(`${url} fim`, opts)).toEqual([url, 'fim']);
  });

  it('respeita maxParts sem perder texto: o resto vai inteiro no último balão', () => {
    expect(splitIntoParts('a'.repeat(200), opts)).toEqual(['a'.repeat(30), 'a'.repeat(170)]);
  });

  it('vazio não gera balão', () => {
    expect(splitIntoParts('', opts)).toEqual([]);
  });
});
