import type { ReactNode } from 'react';

/**
 * Título da tela (28, `font-display`). Toda tela usa este componente: o `tabIndex={-1}` deixa o
 * Shell levar o foco até ele quando a rota troca, para o leitor de tela anunciar a tela nova.
 */
export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 tabIndex={-1} className="font-display text-title font-semibold">
      {children}
    </h1>
  );
}
