import { type FormEvent, useState } from 'react';
import { useApi } from '#components/context.tsx';
import { Button, ErrorNotice, Field, inputClass } from '#components/ui.tsx';
import { ok } from '#lib/api.ts';
import { Link } from '#lib/router.tsx';
import { Gate } from './Login.tsx';

/**
 * Aceite de convite (`POST /api/auth/invites/accept`). No primeiro acesso o token é o de
 * bootstrap (o bot o grava ao lado do banco), e nome e e-mail do primeiro owner vão junto.
 */
export function Invite({ onDone }: { onDone: () => void }) {
  const api = useApi();
  // `/convite?token=…`: o link do convite já chega com o token preenchido.
  const [token, setToken] = useState(() => new URLSearchParams(location.search).get('token') ?? '');
  const [password, setPassword] = useState('');
  const [first, setFirst] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await ok(
        api.client.POST('/api/auth/invites/accept', {
          body: { token, password, ...(first && { name, email }) },
        }),
      );
      onDone();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Gate title="Aceitar convite">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Convite" help="O token do convite, ou o do primeiro acesso.">
          {(props) => (
            <input
              {...props}
              className={`${inputClass} font-mono`}
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          )}
        </Field>
        <Field label="Nova senha" help="Mínimo de 10 caracteres.">
          {(props) => (
            <input
              {...props}
              className={inputClass}
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5"
            checked={first}
            onChange={(e) => setFirst(e.target.checked)}
          />
          Primeiro acesso (token de bootstrap)
        </label>
        {first && (
          <>
            <Field label="Nome">
              {(props) => (
                <input
                  {...props}
                  className={inputClass}
                  autoComplete="name"
                  required
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
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
          </>
        )}
        {error !== undefined && <ErrorNotice error={error} />}
        <Button type="submit" variant="primary" disabled={busy}>
          Definir senha e entrar
        </Button>
      </form>
      <p className="text-help text-muted">
        <Link to="/" className="text-ink underline">
          Voltar ao login
        </Link>
      </p>
    </Gate>
  );
}
