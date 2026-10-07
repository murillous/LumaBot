/** De onde veio o valor de um campo, em ordem crescente de precedência. */
export type ConfigSource = 'default' | 'override' | 'file' | 'env';

export interface PluginConfigIssue {
  /** Caminho do campo (`quality`, `openai.apiKey`, `messages.needMedia`); vazio = o objeto todo. */
  readonly path: string;
  /** O que está errado. Nunca contém o valor recebido (pode ser secreto). */
  readonly message: string;
  /** Camada que forneceu o valor rejeitado; `default` = nenhuma (valor ausente). */
  readonly source: ConfigSource;
  /** Variável de ambiente, quando `source` é `env`. */
  readonly env?: string;
}

const describeSource = (plugin: string, issue: PluginConfigIssue): string => {
  switch (issue.source) {
    case 'env':
      return `env ${issue.env}`;
    case 'file': {
      const path = issue.path === '' ? '' : `.${issue.path}`;
      return `arquivo pluginConfig["${plugin}"]${path}`;
    }
    case 'override':
      return 'override salvo no storage';
    case 'default':
      return 'ausente, sem default no schema';
  }
};

/**
 * Config de plugin rejeitada: lista todos os problemas, cada um com campo e fonte. No boot, a
 * fábrica de contexto que lança este erro faz o plugin ser ignorado (motivo na tabela); numa
 * mudança de config, a mudança é recusada e o plugin segue com a config anterior.
 */
export class PluginConfigError extends Error {
  override readonly name = 'PluginConfigError';
  readonly plugin: string;
  readonly issues: readonly PluginConfigIssue[];

  constructor(plugin: string, issues: readonly PluginConfigIssue[]) {
    const lines = issues.map(
      (issue) =>
        `${issue.path === '' ? '(config)' : issue.path}: ${issue.message} (fonte: ${describeSource(plugin, issue)})`,
    );
    super(`config inválida do plugin "${plugin}":\n- ${lines.join('\n- ')}`);
    this.plugin = plugin;
    this.issues = issues;
  }
}
