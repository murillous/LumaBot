import { type ComponentProps, type ReactNode, useId } from 'react';
import { messageOf } from '#lib/api.ts';

// Componentes base do guia (DESIGN.md, tabela de Componentes). Só o que a Base usa; as telas
// seguintes acrescentam o resto aqui, sempre com as cores saindo dos tokens.

const FOCUS_TARGET = 'min-h-11'; // alvo de toque de 44 px

type Variant = 'primary' | 'secondary' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-bg',
  secondary: 'bg-plate text-ink',
  danger: 'bg-danger-soft text-danger',
};

/** Primário (um por tela, no máximo), secundário e destrutivo (quem usa pede confirmação). */
export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...rest
}: ComponentProps<'button'> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      type={type}
      className={`inline-flex ${FOCUS_TARGET} cursor-pointer items-center justify-center gap-2 rounded-btn px-4 font-medium disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${className}`}
    />
  );
}

/** Campo de texto: 16 px no celular para o iOS não dar zoom. */
export const inputClass = `${FOCUS_TARGET} w-full rounded-field bg-raised px-3 text-base text-ink shadow-e1 md:text-body aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-danger`;

export interface FieldProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

/** Rótulo visível acima, ajuda abaixo e o erro junto do campo. */
export function Field({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: string;
  error?: string | undefined;
  children: (props: FieldProps) => ReactNode;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const described = [help ? helpId : undefined, error ? errorId : undefined]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children({
        id,
        ...(described && { 'aria-describedby': described }),
        ...(error && { 'aria-invalid': true as const }),
      })}
      {help && (
        <p id={helpId} className="text-help text-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-help text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Bloco autocontido: `--raised`, raio 14, `e1` mais o brilho de topo. */
export function Card({ className = '', ...rest }: ComponentProps<'div'>) {
  return (
    <div
      {...rest}
      className={`rounded-card bg-raised p-6 shadow-[var(--e1),var(--top)] ${className}`}
    />
  );
}

/** Erro da API com a mensagem e, quando há o que repetir, "Tentar de novo". */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-field bg-danger-soft p-4">
      <p className="text-danger">{messageOf(error)}</p>
      {onRetry && <Button onClick={onRetry}>Tentar de novo</Button>}
    </div>
  );
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <p role="status" className="text-muted">
      {label}
    </p>
  );
}

/** Tela cuja permissão a pessoa não tem. */
export function Forbidden() {
  return (
    <section className="flex flex-col gap-2">
      <h1 className="font-display text-title font-semibold">Sem permissão</h1>
      <p className="text-muted">Você não tem permissão para ver esta tela.</p>
    </section>
  );
}
