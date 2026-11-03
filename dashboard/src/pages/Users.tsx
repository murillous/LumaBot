import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useApi, useSession } from '#components/context.tsx';
import { PageTitle } from '#components/PageTitle.tsx';
import { Segmented } from '#components/Segmented.tsx';
import { StateWord } from '#components/StateWord.tsx';
import { Table } from '#components/Table.tsx';
import {
  Button,
  Card,
  ErrorNotice,
  Field,
  Forbidden,
  inputClass,
  Loading,
} from '#components/ui.tsx';
import { ok } from '#lib/api.ts';
import { Link, type PageProps } from '#lib/router.tsx';
import { Detail, USERS } from './users/Detail.tsx';
import { canManageRole, ROLE_LABEL, ROLES, type Role, statusOf, whenOf } from './users/format.ts';
import { type Revealed, Secret } from './users/Secret.tsx';

export function Users({ params }: PageProps) {
  const { can } = useSession();
  if (!can('users.manage')) return <Forbidden />;
  return <UsersScreen selected={params['id']} />;
}

function InviteForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (revealed: Revealed) => void;
}) {
  const { client } = useApi();
  const { me } = useSession();
  const cache = useQueryClient();
  const actorRole: Role = me.role ?? 'admin';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const create = useMutation({
    mutationFn: () =>
      ok(client.POST('/api/users', { body: { name: name.trim(), email: email.trim(), role } })),
    onSuccess: (data) => {
      void cache.invalidateQueries({ queryKey: USERS });
      onCreated({
        title: `Convite para ${data.user.name}`,
        token: data.invite.token,
        expiresAt: data.invite.expiresAt,
      });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 className="font-display text-section font-semibold">Convidar pessoa</h2>
        <Field label="Nome">
          {(props) => (
            <input
              {...props}
              className={inputClass}
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="E-mail">
          {(props) => (
            <input
              {...props}
              className={inputClass}
              type="email"
              required
              maxLength={320}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-col gap-2">
          <span className="font-medium">Papel</span>
          <Segmented
            label="Papel"
            options={ROLES.filter((r) => canManageRole(actorRole, r)).map((r) => ({
              value: r,
              label: ROLE_LABEL[r],
            }))}
            value={role}
            onChange={setRole}
          />
        </div>
        {create.isError && <ErrorNotice error={create.error} />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Criar convite
          </Button>
          <Button onClick={onCancel}>Cancelar</Button>
        </div>
      </form>
    </Card>
  );
}

function UsersScreen({ selected }: { selected: string | undefined }) {
  const { client } = useApi();
  const list = useQuery({
    queryKey: USERS,
    queryFn: () => ok(client.GET('/api/users')),
  });
  const [inviting, setInviting] = useState(false);
  // Fica aqui, e não no detalhe, para sobreviver à troca de pessoa: é a única chance de ver o link.
  const [revealed, setRevealed] = useState<Revealed>();

  let body: React.ReactNode;
  if (list.isPending) body = <Loading />;
  else if (list.isError) {
    body = <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;
  } else if (list.data.users.length === 0) {
    body = <p className="text-muted">Nenhuma pessoa cadastrada.</p>;
  } else {
    body = (
      <Table label="Usuários">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Papel</th>
            <th>Estado</th>
            <th>Último acesso</th>
          </tr>
        </thead>
        <tbody>
          {list.data.users.map((user) => {
            const state = statusOf(user);
            return (
              <tr key={user.id}>
                <td>
                  <Link
                    to={`/usuarios/${encodeURIComponent(user.id)}`}
                    {...(user.id === selected && { 'aria-current': 'true' as const })}
                    className={`flex min-h-11 flex-col justify-center rounded-field ${user.id === selected ? 'font-medium' : ''}`}
                  >
                    <span>{user.name}</span>
                    <span className="font-mono text-label text-muted">{user.email}</span>
                  </Link>
                </td>
                <td>{ROLE_LABEL[user.role]}</td>
                <td>
                  <StateWord tone={state.tone}>{state.text}</StateWord>
                </td>
                <td className="text-muted">{whenOf(user.lastLoginAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle>Usuários</PageTitle>
        {!inviting && (
          <Button variant="primary" onClick={() => setInviting(true)}>
            Convidar pessoa
          </Button>
        )}
      </header>
      {revealed !== undefined && (
        <Secret revealed={revealed} onClose={() => setRevealed(undefined)} />
      )}
      {inviting && (
        <InviteForm
          onCancel={() => setInviting(false)}
          onCreated={(next) => {
            setInviting(false);
            setRevealed(next);
          }}
        />
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div>{body}</div>
        {selected !== undefined && (
          <Card>
            <Detail key={selected} id={selected} onRevealed={setRevealed} />
          </Card>
        )}
      </div>
    </section>
  );
}
