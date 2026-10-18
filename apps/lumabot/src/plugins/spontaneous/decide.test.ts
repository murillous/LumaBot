import { describe, expect, it } from 'vitest';
import { NONE, parseReaction, reactionPrompt } from './decide.ts';

const allowed = ['😂', '💀', '👁️'];

describe('parseReaction', () => {
  it.each([
    ['😂', '😂'],
    ['  💀\n', '💀'],
    ['"😂"', '😂'],
    ['😂.', '😂'],
    ['👁', '👁️'],
    ['👁️', '👁️'],
  ])('aceita %j', (text, expected) => {
    expect(parseReaction(text, allowed)).toBe(expected);
  });

  it.each([
    [NONE],
    ['Nenhuma'],
    [''],
    ['🔥'],
    ['😂😂'],
    ['acho que 😂'],
    ['😂 porque é engraçado'],
  ])('não reage: %j', (text) => {
    expect(parseReaction(text, allowed)).toBeNull();
  });
});

describe('reactionPrompt', () => {
  it('lista os emojis e dá a conversa em ordem', () => {
    const { instructions, content } = reactionPrompt(
      [
        { name: 'Ana', text: 'perdi o ônibus' },
        { name: 'Bia', text: 'kkkk' },
      ],
      allowed,
    );

    expect(instructions).toContain('😂 💀 👁️');
    expect(instructions).toContain(NONE);
    expect(content).toBe('Conversa:\nAna: perdi o ônibus\nBia: kkkk');
  });
});
