import { StateWord, type Tone } from '#components/StateWord.tsx';
import { type ModelStatus, secondsUntil } from './ai-state.ts';
import { useAiStatus } from './queries.ts';
import { Remote, Section } from './Remote.tsx';

function stateOf(model: ModelStatus): { tone: Tone; word: string } {
  if (model.state === 'ready') return { tone: 'ok', word: 'pronto' };
  if (model.state === 'cooldown')
    return {
      tone: 'warn',
      word: model.until ? `em espera, ${secondsUntil(model.until)} s` : 'em espera',
    };
  return { tone: 'warn', word: 'pulado, sem chave' };
}

/** A cadeia principal na ordem de tentativa, com o estado de cada posição; edita-se na tela IA. */
export function ChainSummary() {
  const status = useAiStatus();
  return (
    <Section title="Cadeia de IA" link={{ to: '/ia', label: 'Editar' }}>
      <Remote query={status}>
        {({ models }) =>
          models.length === 0 ? (
            <p className="text-muted">Nenhum modelo na cadeia.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {models.map((model, i) => {
                const { tone, word } = stateOf(model);
                return (
                  <li key={model.model} className="flex flex-wrap items-baseline gap-x-3 py-2">
                    <span className="w-6 text-muted">{i + 1}.</span>
                    <span className="min-w-0 break-all font-mono text-label">{model.model}</span>
                    <span className="ml-auto">
                      <StateWord tone={tone}>{word}</StateWord>
                    </span>
                  </li>
                );
              })}
            </ol>
          )
        }
      </Remote>
    </Section>
  );
}
