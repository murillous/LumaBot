import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useApi, useSession } from '#components/context.tsx';
import { PageTitle } from '#components/PageTitle.tsx';
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
import { messageOf, ok, type Schemas } from '#lib/api.ts';
import { useLeaveGuard } from '#lib/router.tsx';
import { CreatedSecret } from './keys/CreatedSecret.tsx';

type ApiKey = Schemas['ApiKey'];
type Created = Schemas['ApiKeyCreated'];

const KEYS = ['keys'] as const;

const whenOf = (iso: string | null): string => {
  if (iso === null) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('pt-BR');
};

export function Keys() {
  const { can } = useSession();
  if (!can('keys.manage')) return <Forbidden />;
  return <KeysScreen />;
}

function KeysScreen() {
  const { client } = useApi();
  const keys = useQuery({ queryKey: KEYS, queryFn: () => ok(client.GET('/api/keys')) });
  const [creating, setCreating] = useState(false);
  // O segredo só existe aqui, no estado da tela: sair da tela ou fechar o aviso o descarta.
  const [created, setCreated] = useState<Created | null>(null);
  useLeaveGuard(created !== null, 'A chave criada não aparece de novo. Sair mesmo assim?');

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-72 flex-1 flex-col gap-1">
          <PageTitle>Chaves de API</PageTitle>
          <p className="text-help text-muted">
            Acesso de programas à API do bot, com as permissões escolhidas. Revogar corta o acesso
            na hora.
          </p>
        </div>
        {!creating && created === null && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            Nova chave
          </Button>
        )}
      </header>

      {created !== null && <CreatedSecret created={created} onClose={() => setCreated(null)} />}

      {creating && (
        <CreateForm
          onCancel={() => setCreating(false)}
          onCreated={(key) => {
            setCreated(key);
            setCreating(false);
          }}
        />
      )}

      {keys.isPending && <Loading label="Carregando chaves…" />}
      {keys.isError && <ErrorNotice error={keys.error} onRetry={() => void keys.refetch()} />}
      {keys.data !== undefined &&
        (keys.data.keys.length === 0 ? (
          <p className="rounded-card bg-raised p-8 text-center text-muted shadow-[var(--e1),var(--top)]">
            Nenhuma chave criada.
          </p>
        ) : (
          <Table label="Chaves de API">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Permissões</th>
                <th>Criada</th>
                <th>Último uso</th>
                <th>Estado</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.data.keys.map((key) => (
                <KeyRow key={key.id} apiKey={key} />
              ))}
            </tbody>
          </Table>
        ))}
    </section>
  );
}

function CreateForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (key: Created) => void;
}) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const { me } = useSession();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<readonly string[]>([]);

  const create = useMutation({
    // Sem cache: o segredo não pode ficar no `MutationCache` do react-query depois de entregue.
    gcTime: 0,
    mutationFn: (body: { name: string; permissions: string[] }) =>
      ok(client.POST('/api/keys', { body })),
    onSuccess: (key) => {
      onCreated(key);
      void queryClient.invalidateQueries({ queryKey: KEYS });
    },
  });

  const toggle = (permission: string) =>
    setPicked((now) =>
      now.includes(permission) ? now.filter((p) => p !== permission) : [...now, permission],
    );
  const trimmed = name.trim();

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed === '' || picked.length === 0) return;
          // Na ordem da lista da pessoa, não na ordem dos cliques.
          create.mutate({
            name: trimmed,
            permissions: me.permissions.filter((p) => picked.includes(p)),
          });
        }}
      >
        <Field label="Nome" help="Para você reconhecer a chave depois, como o programa que a usa.">
          {(props) => (
            <input
              {...props}
              className={inputClass}
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="font-medium">Permissões</legend>
          <p className="text-help text-muted">
            Só as que você mesmo tem. Dê à chave o mínimo de que o programa precisa.
          </p>
          {me.permissions.map((permission) => (
            <label key={permission} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="size-5 accent-ink"
                checked={picked.includes(permission)}
                onChange={() => toggle(permission)}
              />
              <span className="font-mono text-label">{permission}</span>
            </label>
          ))}
        </fieldset>
        {create.isError && <ErrorNotice error={create.error} />}
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending || trimmed === '' || picked.length === 0}
          >
            Criar chave
          </Button>
          <Button disabled={create.isPending} onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function KeyRow({ apiKey }: { apiKey: ApiKey }) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const revoke = useMutation({
    mutationFn: () => ok(client.DELETE('/api/keys/{id}', { params: { path: { id: apiKey.id } } })),
    onSuccess: () => {
      // Fecha já: se o refetch falhar, a linha não deixa disparar um segundo DELETE.
      setConfirming(false);
      return queryClient.invalidateQueries({ queryKey: KEYS });
    },
  });
  const confirmButton = useRef<HTMLButtonElement>(null);
  const revokeButton = useRef<HTMLButtonElement>(null);
  const settled = useRef(false);
  // O botão focado some na troca; o foco acompanha. Na 1ª montagem não mexe.
  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    (confirming ? confirmButton : revokeButton).current?.focus();
  }, [confirming]);
  const revoked = apiKey.revokedAt !== null;

  return (
    <tr>
      <td className="break-all">{apiKey.name}</td>
      <td className="min-w-48 break-all font-mono text-label">{apiKey.permissions.join(', ')}</td>
      <td className="text-label text-muted">{whenOf(apiKey.createdAt)}</td>
      <td className="text-label text-muted">{whenOf(apiKey.lastUsedAt)}</td>
      <td>
        {revoked ? (
          <StateWord tone="danger">revogada</StateWord>
        ) : (
          <StateWord tone="ok">ativa</StateWord>
        )}
      </td>
      <td>
        {!revoked &&
          (confirming ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-warn">Quem usa esta chave perde o acesso.</p>
              {revoke.isError && (
                <p role="alert" className="text-danger">
                  {messageOf(revoke.error)}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  ref={confirmButton}
                  variant="danger"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate()}
                >
                  Confirmar revogação de {apiKey.name}
                </Button>
                <Button onClick={() => setConfirming(false)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <Button ref={revokeButton} variant="danger" onClick={() => setConfirming(true)}>
              Revogar
              <span className="sr-only"> {apiKey.name}</span>
            </Button>
          ))}
      </td>
    </tr>
  );
}
