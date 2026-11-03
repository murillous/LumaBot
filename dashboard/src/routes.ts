import type { ComponentType } from 'react';
import { matchPath, type PageProps } from '#lib/router.tsx';
import { Ai } from '#pages/Ai.tsx';
import { Audit } from '#pages/Audit.tsx';
import { Connection } from '#pages/Connection.tsx';
import { Conta } from '#pages/Conta.tsx';
import { Keys } from '#pages/Keys.tsx';
import { Logs } from '#pages/Logs.tsx';
import { Metrics } from '#pages/Metrics.tsx';
import { Overview } from '#pages/Overview.tsx';
import { Plugins } from '#pages/Plugins.tsx';
import { Users } from '#pages/Users.tsx';

export const GROUPS = ['Bot', 'Observabilidade', 'Administração'] as const;
export type Group = (typeof GROUPS)[number];

interface Base {
  readonly label: string;
  readonly group: Group;
  /** Permissão da API que a tela lê (`x-permission` da spec); sem ela, qualquer pessoa logada. */
  readonly permission?: string;
}

/** Tela do app: o caminho, a página e o item do menu num lugar só. */
export interface Screen extends Base {
  /** O primeiro é o do menu; os outros também deixam o item ativo (`/plugins/:nome`). */
  readonly paths: readonly [string, ...string[]];
  readonly page: ComponentType<PageProps>;
  /**
   * `false` tira a tela dos grupos do menu; `resolveRoute` continua resolvendo o caminho. Quem
   * leva até ela é outro ponto da interface (Minha conta, no rodapé da sidebar). O `group` fica
   * só para satisfazer o tipo.
   */
  readonly menu?: false;
}

/**
 * Tabela única de telas e menu. Tela nova é uma linha aqui e o arquivo em `pages/`.
 */
export const ENTRIES: readonly Screen[] = [
  // A Visão geral junta várias leituras, cada uma com a permissão própria: a tela abre para
  // qualquer pessoa logada e esconde por seção o que ela não pode ver.
  { label: 'Visão geral', group: 'Bot', paths: ['/'], page: Overview },
  { label: 'IA', group: 'Bot', permission: 'config.read', paths: ['/ia'], page: Ai },
  {
    label: 'Plugins',
    group: 'Bot',
    permission: 'plugins.read',
    paths: ['/plugins', '/plugins/:nome'],
    page: Plugins,
  },
  {
    label: 'Logs',
    group: 'Observabilidade',
    permission: 'logs.read',
    paths: ['/logs'],
    page: Logs,
  },
  {
    label: 'Auditoria',
    group: 'Observabilidade',
    permission: 'audit.read',
    paths: ['/auditoria'],
    page: Audit,
  },
  {
    label: 'Métricas',
    group: 'Observabilidade',
    permission: 'metrics.read',
    paths: ['/metricas'],
    page: Metrics,
  },
  {
    label: 'Conexão',
    group: 'Administração',
    permission: 'connection.read',
    paths: ['/conexao'],
    page: Connection,
  },
  {
    label: 'Usuários',
    group: 'Administração',
    permission: 'users.manage',
    paths: ['/usuarios', '/usuarios/:id'],
    page: Users,
  },
  {
    label: 'Chaves de API',
    group: 'Administração',
    permission: 'keys.manage',
    paths: ['/chaves'],
    page: Keys,
  },
  { label: 'Minha conta', group: 'Administração', menu: false, paths: ['/conta'], page: Conta },
];

/** A tela do caminho e os parâmetros dele; `null` quando nenhuma casa. */
export function resolveRoute(
  path: string,
): { entry: Screen; params: Record<string, string> } | null {
  for (const entry of ENTRIES) {
    for (const pattern of entry.paths) {
      const params = matchPath(pattern, path);
      if (params !== null) return { entry, params };
    }
  }
  return null;
}
