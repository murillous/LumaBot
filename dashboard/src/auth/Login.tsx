import { type FormEvent, type ReactNode, useState } from 'react';
import { useApi } from '#components/context.tsx';
import { Button, Card, ErrorNotice, Field, inputClass } from '#components/ui.tsx';
import { ok } from '#lib/api.ts';
import { Link } from '#lib/router.tsx';

/** Moldura das telas de entrada (login e convite), antes de haver sessão. */
export function Gate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center gap-6 px-4 py-8">
      <p className="font-display text-section font-semibold">Luma</p>
      <Card className="flex flex-col gap-4">
        <h1 className="font-display text-section font-semibold">{title}</h1>
        {children}
      </Card>
    </main>
  );
}

/** `POST /api/auth/login`: o cookie de sessão sai na resposta. */
export function Login({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await ok(api.client.POST('/api/auth/login', { body: { email, password } }));
      onDone();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Gate title="Entrar">
      <form onSubmit={submit} className="flex flex-col gap-4">
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
        <Field label="Senha">
          {(props) => (
            <input
              {...props}
              className={inputClass}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        {error !== undefined && <ErrorNotice error={error} />}
        <Button type="submit" variant="primary" disabled={busy}>
          Entrar
        </Button>
      </form>
      <p className="text-help text-muted">
        Primeiro acesso ou convite?{' '}
        <Link to="/convite" className="text-ink underline">
          Defina sua senha
        </Link>
        .
      </p>
    </Gate>
  );
}
