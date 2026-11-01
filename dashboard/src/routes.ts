import type { ComponentType } from 'react';
import { matchPath, type PageProps } from '#lib/router.tsx';
import { Ai } from '#pages/Ai.tsx';
import { Audit } from '#pages/Audit.tsx';
import { Logs } from '#pages/Logs.tsx';
import { Overview } from '#pages/Overview.tsx';
import { Plugins } from '#pages/Plugins.tsx';

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
}

/** Tela que ainda é o painel genérico do Bridger (via proxy), até o dashboard ganhar a própria. */
export interface External extends Base {
  readonly href: string;
}

export type Entry = Screen | External;

export const isExternal = (entry: Entry): entry is External => 'href' in entry;

const GENERIC = '/plugins/dashboard/';

/**
 * Tabela única de telas e menu. Cada entrega de tela troca só o arquivo de `pages/`; uma tela
 * nova ou a troca de uma `External` por `Screen` é uma linha aqui.
 */
export const ENTRIES: readonly Entry[] = [
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
    label: 'Conexão',
    group: 'Administração',
    permission: 'connection.read',
    href: `${GENERIC}#/`,
  },
  {
    label: 'Usuários',
    group: 'Administração',
    permission: 'users.manage',
    href: `${GENERIC}#/usuarios`,
  },
  {
    label: 'Chaves de API',
    group: 'Administração',
    permission: 'keys.manage',
    href: `${GENERIC}#/chaves`,
  },
];

/** A tela do caminho e os parâmetros dele; `null` quando nenhuma casa. */
export function resolveRoute(
  path: string,
): { entry: Screen; params: Record<string, string> } | null {
  for (const entry of ENTRIES) {
    if (isExternal(entry)) continue;
    for (const pattern of entry.paths) {
      const params = matchPath(pattern, path);
      if (params !== null) return { entry, params };
    }
  }
  return null;
}
