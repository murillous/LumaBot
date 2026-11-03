import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi, useSession } from '#components/context.tsx';
import { Segmented } from '#components/Segmented.tsx';
import { StateWord } from '#components/StateWord.tsx';
import { Button, ErrorNotice, Loading } from '#components/ui.tsx';
import { ok } from '#lib/api.ts';
import {
  canManageRole,
  ROLE_LABEL,
  ROLES,
  type Role,
  statusOf,
  type User,
  whenOf,
} from './format.ts';
import type { Revealed } from './Secret.tsx';

type Confirming = 'disable' | 'sessions' | 'reset';

const CONFIRM_TEXT: Record<Confirming, string> = {
  disable: 'Desativar encerra as sessões da pessoa na hora e ela não consegue entrar.',
  sessions: 'Encerrar as sessões desconecta a pessoa de todos os dispositivos.',
  reset: 'Redefinir apaga a senha atual, encerra as sessões e gera um novo link de convite.',
};

const CONFIRM_BUTTON: Record<Confirming, string> = {
  disable: 'Desativar',
  sessions: 'Encerrar sessões',
  reset: 'Redefinir senha',
};

export const USERS = ['users'] as const;

/** Uma pessoa aberta (`GET /api/users/{id}`) com as ações sobre ela. */
export function Detail({
  id,
  onRevealed,
}: {
  id: string;
  onRevealed: (revealed: Revealed) => void;
}) {
  const { client } = useApi();
  const { me } = useSession();
  const cache = useQueryClient();
  const key = ['user', id] as const;
  const path = { params: { path: { id } } };
  const user = useQuery({
    queryKey: key,
    queryFn: () => ok(client.GET('/api/users/{id}', path)),
  });
  const [confirming, setConfirming] = useState<Confirming>();
  const [revoked, setRevoked] = useState<number>();

  // A resposta da ação já traz a pessoa atualizada: grava no detalhe e relê a lista.
  const saved = (data: User) => {
    cache.setQueryData(key, data);
    void cache.invalidateQueries({ queryKey: USERS });
  };
  const role = useMutation({
    mutationFn: (next: Role) =>
      ok(client.PATCH('/api/users/{id}', { ...path, body: { role: next } })),
    onSuccess: saved,
  });
  const status = useMutation({
    mutationFn: (enable: boolean) =>
      ok(
        enable
          ? client.POST('/api/users/{id}/enable', path)
          : client.POST('/api/users/{id}/disable', path),
      ),
    onSuccess: saved,
  });
  const sessions = useMutation({
    mutationFn: () => ok(client.DELETE('/api/users/{id}/sessions', path)),
    onSuccess: (data) => setRevoked(data.revoked),
  });
  const reset = useMutation({
    mutationFn: () => ok(client.POST('/api/users/{id}/reset-password', path)),
    onSuccess: (data) => {
      onRevealed({
        title: `Link para ${user.data?.name ?? 'a pessoa'} definir uma senha nova`,
        token: data.token,
        expiresAt: data.expiresAt,
      });
      // A pessoa volta a ter convite pendente e sem sessões.
      void cache.invalidateQueries({ queryKey: key });
      void cache.invalidateQueries({ queryKey: USERS });
    },
  });

  if (user.isPending) return <Loading />;
  if (user.isError) return <ErrorNotice error={user.error} onRetry={() => void user.refetch()} />;

  const target = user.data;
  const state = statusOf(target);
  const actorRole: Role = me.role ?? 'admin';
  const manageable = canManageRole(actorRole, target.role);
  const self = me.id === target.id;
  const busy = role.isPending || status.isPending || sessions.isPending || reset.isPending;
  const error = role.error ?? status.error ?? sessions.error ?? reset.error;

  const run = (action: Confirming) => {
    setConfirming(undefined);
    if (action === 'disable') status.mutate(false);
    else if (action === 'sessions') sessions.mutate();
    else reset.mutate();
  };
  const ask = (action: Confirming) => {
    setRevoked(undefined);
    setConfirming(action);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-section font-semibold">{target.name}</h2>
        <p className="font-mono text-label text-muted">{target.email}</p>
      </div>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted">Estado</dt>
        <dd className="m-0">
          <StateWord tone={state.tone}>{state.text}</StateWord>
          {self && <span className="text-muted"> (você)</span>}
        </dd>
        <dt className="text-muted">Papel</dt>
        <dd className="m-0">{ROLE_LABEL[target.role]}</dd>
        <dt className="text-muted">Último acesso</dt>
        <dd className="m-0">{whenOf(target.lastLoginAt)}</dd>
        <dt className="text-muted">Criado em</dt>
        <dd className="m-0">{whenOf(target.createdAt)}</dd>
      </dl>

      {error !== null && <ErrorNotice error={error} />}
      {revoked !== undefined && (
        <p role="status" className="text-ok">
          {revoked === 1 ? '1 sessão encerrada.' : `${revoked} sessões encerradas.`}
        </p>
      )}

      {!manageable ? (
        <p className="text-muted">Só um dono pode alterar uma conta de dono.</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className="font-medium">Papel</span>
            <Segmented
              label="Papel"
              // O admin não promove ninguém a dono (a API recusa): a opção nem aparece.
              options={ROLES.filter((r) => canManageRole(actorRole, r)).map((r) => ({
                value: r,
                label: ROLE_LABEL[r],
              }))}
              value={target.role}
              onChange={(next) => {
                if (next !== target.role && !busy) role.mutate(next);
              }}
            />
          </div>

          {confirming !== undefined && (
            <div
              role="alert"
              className="flex flex-col items-start gap-3 rounded-field bg-warn-soft p-4"
            >
              <p className="text-warn">
                {CONFIRM_TEXT[confirming]}
                {self ? ' Como é a sua conta, você sai agora.' : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={() => run(confirming)}>
                  {CONFIRM_BUTTON[confirming]}
                </Button>
                <Button onClick={() => setConfirming(undefined)}>Cancelar</Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {target.status === 'active' ? (
              <Button variant="danger" disabled={busy} onClick={() => ask('disable')}>
                Desativar
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => status.mutate(true)}>
                Reativar
              </Button>
            )}
            <Button variant="danger" disabled={busy} onClick={() => ask('sessions')}>
              Encerrar sessões
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => ask('reset')}>
              Redefinir senha
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
