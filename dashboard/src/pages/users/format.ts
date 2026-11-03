import type { Tone } from '#components/StateWord.tsx';
import type { paths } from '#lib/api-types.d.ts';

export type User = paths['/api/users/{id}']['get']['responses'][200]['content']['application/json'];
export type Role = User['role'];

export const ROLES: readonly Role[] = ['owner', 'admin', 'viewer'];

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Dono',
  admin: 'Administrador',
  viewer: 'Leitor',
};

/** Mesma regra do core (`canManageRole`): o admin não toca em owner nem promove a owner. */
export const canManageRole = (actor: Role, target: Role): boolean =>
  actor === 'owner' || (actor === 'admin' && target !== 'owner');

/** Estado em palavra: desativado vence, depois convite pendente, depois ativo. */
export function statusOf(user: User): { tone: Tone; text: string } {
  if (user.status === 'disabled') return { tone: 'warn', text: 'desativado' };
  if (user.pendingInvite) return { tone: 'info', text: 'convite pendente' };
  return { tone: 'ok', text: 'ativo' };
}

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export const whenOf = (at: string | null): string =>
  at === null ? 'nunca' : WHEN.format(new Date(at));

/** Link absoluto do convite; o token vai na query da rota `/convite` que o app já tem. */
export const inviteUrl = (token: string): string =>
  `${location.origin}/convite?token=${encodeURIComponent(token)}`;
