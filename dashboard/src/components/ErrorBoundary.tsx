import { Component, type ReactNode } from 'react';
import { ErrorNotice } from './ui.tsx';

/**
 * Uma tela que lança ao renderizar não derruba o menu: mostra a mensagem e "Tentar de novo". Quem
 * usa dá uma `key` que muda com a tela, para trocar de tela também limpar o erro.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: undefined };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error: error ?? new Error('erro desconhecido') };
  }

  override componentDidCatch(error: unknown): void {
    console.error('falha ao renderizar a tela', error);
  }

  override render(): ReactNode {
    if (this.state.error === undefined) return this.props.children;
    return (
      <ErrorNotice error={this.state.error} onRetry={() => this.setState({ error: undefined })} />
    );
  }
}
