import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ME } from '#App.tsx';
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

type Confirming = 'disable' | 'sessions' | 'reset' | 'role';

const CONFIRM_TEXT: Record<Confirming, string> = {
  disable: 'Desativar encerra as sessões da pessoa na hora e ela não consegue entrar.',
  sessions: 'Encerrar as sessões desconecta a pessoa de todos os dispositivos.',
  role: 'Rebaixar o seu próprio papel tira de você permissões do painel assim que confirmar.',
  reset: 'Redefinir apaga a senha atual, encerra as sessões e gera um novo link de convite.',
};

const CONFIRM_BUTTON: Record<Confirming, string> = {
  disable: 'Desativar',
  sessions: 'Encerrar sessões',
  reset: 'Redefinir senha',
  role: 'Mudar o meu papel',
};

/** Quanto maior, mais poder; serve para saber se a mudança é um rebaixamento. */
const RANK: Record<Role, number> = { viewer: 0, admin: 1, owner: 2 };

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
  const [nextRole, setNextRole] = useState<Role>();
  const roleGroup = useRef<HTMLDivElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  // De onde a confirmação saiu: cancelar ou concluir devolve o foco para lá.
  const origins = useRef<Partial<Record<Confirming, HTMLElement | null>>>({});
  useEffect(() => {
    if (confirming !== undefined) confirmButton.current?.focus();
  }, [confirming]);

  // A resposta da ação já traz a pessoa atualizada: grava no detalhe e relê a lista.
  const saved = (data: User) => {
    cache.setQueryData(key, data);
    void cache.invalidateQueries({ queryKey: USERS });
  };
  const role = useMutation({
    mutationFn: (next: Role) =>
      ok(client.PATCH('/api/users/{id}', { ...path, body: { role: next } })),
    onSuccess: (data) => {
      saved(data);
      // O papel da própria sessão mudou: o menu e as permissões vêm de `/api/auth/me`.
      if (data.id === me.id) void cache.invalidateQueries({ queryKey: ME });
    },
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
    onSuccess: (data) => {
      setRevoked(data.revoked);
      // Encerrou as próprias sessões: a releitura de `me` leva o app ao login.
      if (id === me.id) void cache.invalidateQueries({ queryKey: ME });
    },
  });
  const reset = useMutation({
    mutationFn: () => ok(client.POST('/api/users/{id}/reset-password', path)),
    // O token não pode ficar no cache de mutations depois de mostrado.
    gcTime: 0,
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
  // Redefinir a própria senha derrubaria a sessão e o link se perderia; e o core não aceita
  // convite de conta desativada.
  const canReset = !self && target.status === 'active';
  const resetNote = self
    ? 'Para a sua conta, troque a senha em Minha conta.'
    : target.status !== 'active'
      ? 'Redefinir a senha só vale para conta ativa: reative a conta antes.'
      : undefined;
  const error = role.error ?? status.error ?? sessions.error ?? reset.error;

  // Erro velho de outra ação não fica na tela quando uma nova começa.
  const clearOutcomes = () => {
    role.reset();
    status.reset();
    sessions.reset();
    reset.reset();
    setRevoked(undefined);
  };
  const close = (action: Confirming) => {
    setConfirming(undefined);
    origins.current[action]?.focus();
  };
  const run = (action: Confirming) => {
    clearOutcomes();
    close(action);
    if (action === 'disable') status.mutate(false);
    else if (action === 'sessions') sessions.mutate();
    else if (action === 'role') {
      if (nextRole !== undefined) role.mutate(nextRole);
    } else {
      // Mostrado o token, solta a mutation: com `gcTime: 0` ele sai do cache em seguida.
      reset.mutate(undefined, { onSuccess: () => reset.reset() });
    }
  };
  const ask = (action: Confirming, origin: HTMLElement) => {
    clearOutcomes();
    origins.current[action] = origin;
    setConfirming(action);
  };
  const changeRole = (next: Role, origin: HTMLElement) => {
    if (next === target.role || busy) return;
    if (self && RANK[next] < RANK[target.role]) {
      setNextRole(next);
      ask('role', origin);
      return;
    }
    clearOutcomes();
    role.mutate(next);
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
          <div ref={roleGroup} tabIndex={-1} className="flex flex-col gap-2">
            <span className="font-medium">Papel</span>
            <Segmented
              label="Papel"
              // O admin não promove ninguém a dono (a API recusa): a opção nem aparece.
              options={ROLES.filter((r) => canManageRole(actorRole, r)).map((r) => ({
                value: r,
                label: ROLE_LABEL[r],
              }))}
              value={target.role}
              onChange={(next) => changeRole(next, roleGroup.current ?? document.body)}
            />
          </div>

          {confirming !== undefined && (
            <div
              role="alert"
              className="flex flex-col items-start gap-3 rounded-field bg-warn-soft p-4"
            >
              <p className="text-warn">
                {CONFIRM_TEXT[confirming]}
                {self && confirming !== 'role' ? ' Como é a sua conta, você sai agora.' : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button ref={confirmButton} variant="danger" onClick={() => run(confirming)}>
                  {CONFIRM_BUTTON[confirming]}
                </Button>
                <Button onClick={() => close(confirming)}>Cancelar</Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {target.status === 'active' ? (
              <Button
                variant="danger"
                disabled={busy}
                onClick={(event) => ask('disable', event.currentTarget)}
              >
                Desativar
              </Button>
            ) : (
              <Button
                disabled={busy}
                onClick={() => {
                  clearOutcomes();
                  status.mutate(true);
                }}
              >
                Reativar
              </Button>
            )}
            <Button
              variant="danger"
              disabled={busy}
              onClick={(event) => ask('sessions', event.currentTarget)}
            >
              Encerrar sessões
            </Button>
            {canReset && (
              <Button
                variant="danger"
                disabled={busy}
                onClick={(event) => ask('reset', event.currentTarget)}
              >
                Redefinir senha
              </Button>
            )}
          </div>
          {resetNote !== undefined && <p className="text-help text-muted">{resetNote}</p>}
        </>
      )}
    </div>
  );
}
