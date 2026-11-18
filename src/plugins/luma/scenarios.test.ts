import { describe, expect, it } from 'vitest';
import { scripted } from '#plugins/ai/testing.ts';
import { askPrompt, play, SCENARIOS } from './scenarios.ts';

// Cada cenário com o modelo falso fazendo o papel de um modelo que acerta: o que se confere é o
// contexto que a Luma monta (o modelo real só acerta se ele estiver lá) e o caminho das tools.
describe.each(SCENARIOS.map((s) => [`#${s.issue} ${s.name}`, s] as const))('%s', (_, s) => {
  it('o modelo recebe o contexto de que precisa', async () => {
    const model = scripted(...s.fake);

    const { askCall } = await play(s, { model });

    expect(s.context(askPrompt(model, askCall))).toEqual([]);
  });

  it('com as respostas certas, o resultado passa no critério do cenário', async () => {
    const played = await play(s, { model: scripted(...s.fake) });

    expect(await s.outcome(played)).toEqual([]);
  });
});

describe('os critérios reprovam', () => {
  const byName = (name: string) => {
    const s = SCENARIOS.find((x) => x.name === name);
    if (!s) throw new Error(`cenário ausente: ${name}`);
    return s;
  };

  it('a resposta errada', async () => {
    const s = byName('o que você disse pra Bia?');

    const played = await play(s, { model: scripted('56', 'não lembro') });

    expect(await s.outcome(played)).not.toEqual([]);
  });

  it('as figurinhas trocadas', async () => {
    const s = byName('juntar figurinhas por ID');
    const swapped = scripted(
      ...s.fake.map((step) =>
        typeof step === 'string'
          ? step
          : JSON.parse(
              JSON.stringify(step)
                .replace('\\"#m2\\"', '\\"#mX\\"')
                .replace('\\"#m1\\"', '\\"#m2\\"')
                .replace('\\"#mX\\"', '\\"#m1\\"'),
            ),
      ),
    );

    const played = await play(s, { model: swapped });

    expect(await s.outcome(played)).not.toEqual([]);
  });
});
