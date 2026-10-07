// Erros do contrato de storage. Todo adapter usa estas classes para que quem chama (kernel,
// plugins, suíte de contrato) trate a falha igual em memória, SQLite ou Postgres.

/** Operação depois de `StoragePort.close()`. */
export class StorageClosedError extends Error {
  override readonly name = 'StorageClosedError';

  constructor() {
    super('Storage fechado: a operação foi chamada depois de close().');
  }
}

/** Plugin com nome que cai no namespace reservado do kernel. */
export class ReservedNamespaceError extends Error {
  override readonly name = 'ReservedNamespaceError';
  readonly namespace: string;

  constructor(namespace: string) {
    super(
      `Namespace de storage "${namespace}" é reservado ao kernel (prefixo "$"). ` +
        'Renomeie o plugin.',
    );
    this.namespace = namespace;
  }
}
