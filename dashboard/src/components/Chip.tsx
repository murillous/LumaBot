import type { ReactNode } from 'react';
import type { Tone } from './StateWord.tsx';

const TONE_CHIP: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-agent-soft text-agent',
};

/** Só onde o estado é o assunto do item ("Precisa de atenção"); sempre com palavra. */
export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 text-label ${TONE_CHIP[tone]}`}>
      {children}
    </span>
  );
}
