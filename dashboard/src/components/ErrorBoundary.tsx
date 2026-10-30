import { Component, type ReactNode } from 'react';
import { ErrorNotice } from './ui.tsx';

interface Props {
  children: ReactNode;
  /** Quando muda, limpa o erro sem remontar os filhos (trocar só o parâmetro da mesma tela). */
  resetKey?: string;
}
interface State {
  error: unknown;
  resetKey: string | undefined;
}

/**
 * Uma tela que lança ao renderizar não derruba o menu: mostra a mensagem e "Tentar de novo". Quem
 * usa dá uma `key` que muda com a tela, para trocar de tela também limpar o erro; `resetKey`
 * limpa o erro sem remontar, para o estado local sobreviver a uma troca de parâmetro.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: undefined, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
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
