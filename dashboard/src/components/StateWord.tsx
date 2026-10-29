import type { ReactNode } from 'react';

export type Tone = 'ok' | 'warn' | 'danger' | 'info';

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-agent',
};

/** Estado em tabela e lista: a palavra na cor do estado, sem etiqueta. */
export function StateWord({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={TONE_TEXT[tone]}>{children}</span>;
}
