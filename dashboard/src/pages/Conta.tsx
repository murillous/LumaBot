import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useApi } from '#components/context.tsx';
import { PageTitle } from '#components/PageTitle.tsx';
import { StateWord } from '#components/StateWord.tsx';
import { Table } from '#components/Table.tsx';
import { Button, Card, ErrorNotice, Field, inputClass, Loading } from '#components/ui.tsx';
import { ApiFailure, messageOf, ok } from '#lib/api.ts';
import { whenOf } from './audit/format.ts';

const SESSIONS_KEY = ['auth-sessions'] as const;

type FieldName = 'currentPassword' | 'newPassword' | 'confirm';
type FieldErrors = Partial<Record<FieldName, string>>;

/** Onde cada erro da troca de senha aparece: o 400 traz o campo no `path`, o 403 é a senha atual. */
function errorsOf(error: unknown): { fields: FieldErrors; general?: string } {
  if (error instanceof ApiFailure) {
    const issues = error.problem?.errors ?? [];
    if (error.status === 400 && issues.length > 0) {
      const fields: FieldErrors = {};
      for (const issue of issues) {
        if (issue.path === 'currentPassword' || issue.path === 'newPassword') {
          fields[issue.path] = issue.message;
        }
      }
      if (Object.keys(fields).length > 0) return { fields };
    }
    // O core responde 403 "senha atual incorreta"; um 401 é sessão vencida e volta ao login.
    if (error.status === 403) {
      return { fields: { currentPassword: error.problem?.detail ?? 'Senha atual incorreta.' } };
    }
    if (error.status === 400) return { fields: { newPassword: error.message } };
  }
  return { fields: {}, general: messageOf(error) };
}

function PasswordForm({ onChanged }: { onChanged: () => void }) {
  const { client } = useApi();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: () =>
      ok(
        client.POST('/api/auth/password', {
          body: { currentPassword: current, newPassword: next },
        }),
      ),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setAgain('');
      setErrors({});
      setGeneral(undefined);
      setDone(true);
      onChanged();
    },
    onError: (error) => {
      const parsed = errorsOf(error);
      setErrors(parsed.fields);
      setGeneral(parsed.general);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setDone(false);
    setGeneral(undefined);
    const local: FieldErrors = {};
    if (current === '') local.currentPassword = 'Informe a senha atual.';
    if (next === '') local.newPassword = 'Informe a nova senha.';
    // A confirmação existe só no front: a API não recebe o campo.
    if (again !== next) local.confirm = 'A confirmação não é igual à nova senha.';
    setErrors(local);
    if (Object.keys(local).length === 0) change.mutate();
  };

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-4">
        <h2 className="font-display text-section font-semibold">Trocar a senha</h2>
        <Field label="Senha atual" error={errors.currentPassword}>
          {(props) => (
            <input
              {...props}
              type="password"
              autoComplete="current-password"
              className={inputClass}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
        <Field label="Nova senha" error={errors.newPassword}>
          {(props) => (
            <input
              {...props}
              type="password"
              autoComplete="new-password"
              className={inputClass}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          )}
        </Field>
        <Field label="Confirmar a nova senha" error={errors.confirm}>
          {(props) => (
            <input
              {...props}
              type="password"
              autoComplete="new-password"
              className={inputClass}
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          )}
        </Field>
        {general && (
          <p role="alert" className="text-danger">
            {general}
          </p>
        )}
        {done && (
          <p role="status" className="text-ok">
            Senha trocada. As outras sessões foram encerradas.
          </p>
        )}
        <div>
          <Button type="submit" variant="primary" disabled={change.isPending}>
            Trocar senha
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Sessions() {
  const { client } = useApi();
  const queryClient = useQueryClient();
  // O id da sessão que está pedindo confirmação para encerrar.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  // Foco: a confirmação recebe o foco ao abrir; cancelar devolve ao "Encerrar" da linha; o
  // sucesso leva ao título da seção (a linha some e o foco se perderia).
  const confirmButton = useRef<HTMLButtonElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const heading = useRef<HTMLHeadingElement>(null);
  const [refocus, setRefocus] = useState<{ id: string } | null>(null);

  useEffect(() => {
    if (confirming !== null) confirmButton.current?.focus();
  }, [confirming]);

  useEffect(() => {
    if (refocus !== null) rowButtons.current.get(refocus.id)?.focus();
  }, [refocus]);

  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => ok(client.GET('/api/auth/sessions')),
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      ok(client.DELETE('/api/auth/sessions/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      setConfirming(null);
      setFailure(null);
      heading.current?.focus();
    },
    onError: (error) => {
      setConfirming(null);
      setFailure(error);
    },
    // Também no erro: um 404 é sessão que já tinha acabado, e a lista precisa deixar de mostrá-la.
    onSettled: () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });

  return (
    <section aria-labelledby="sessoes" className="flex flex-col gap-3">
      <h2
        id="sessoes"
        ref={heading}
        tabIndex={-1}
        className="font-display text-section font-semibold"
      >
        Sessões abertas
      </h2>
      {sessions.isPending && <Loading label="Carregando sessões…" />}
      {sessions.isError && (
        <ErrorNotice error={sessions.error} onRetry={() => void sessions.refetch()} />
      )}
      {failure !== null && <ErrorNotice error={failure} />}
      {sessions.data &&
        (sessions.data.sessions.length === 0 ? (
          <p className="rounded-card bg-raised p-8 text-center text-muted shadow-[var(--e1),var(--top)]">
            Nenhuma sessão aberta.
          </p>
        ) : (
          <Table label="Sessões abertas">
            <thead>
              <tr>
                <th scope="col">Aberta em</th>
                <th scope="col">Último uso</th>
                <th scope="col">Expira em</th>
                <th scope="col">
                  <span className="sr-only">Ação</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    {whenOf(s.createdAt)}{' '}
                    {s.current && <StateWord tone="info">esta sessão</StateWord>}
                  </td>
                  <td>{whenOf(s.lastSeenAt)}</td>
                  <td>{whenOf(s.expiresAt)}</td>
                  <td>
                    {confirming === s.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-warn">
                          {s.current ? 'Encerrar esta sessão vai levar ao login.' : 'Encerrar?'}
                        </span>
                        <Button
                          ref={confirmButton}
                          variant="danger"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(s.id)}
                        >
                          Confirmar encerramento
                        </Button>
                        <Button
                          onClick={() => {
                            setConfirming(null);
                            setFailure(null);
                            setRefocus({ id: s.id });
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    ) : (
                      <Button
                        ref={(node) => {
                          if (node) rowButtons.current.set(s.id, node);
                          else rowButtons.current.delete(s.id);
                        }}
                        variant="danger"
                        aria-label={`Encerrar a sessão aberta em ${whenOf(s.createdAt)}`}
                        onClick={() => {
                          setFailure(null);
                          setConfirming(s.id);
                        }}
                      >
                        Encerrar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ))}
    </section>
  );
}

/** Minha conta: vale para qualquer pessoa logada, então não há permissão a conferir. */
export function Conta() {
  const queryClient = useQueryClient();
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <PageTitle>Minha conta</PageTitle>
        <p className="text-help text-muted">A sua senha e as sessões abertas com a sua conta.</p>
      </header>
      {/* Trocar a senha encerra as outras sessões: a lista muda. */}
      <PasswordForm
        onChanged={() => void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY })}
      />
      <Sessions />
    </section>
  );
}
