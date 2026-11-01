import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Invite } from '#auth/Invite.tsx';
import { Login } from '#auth/Login.tsx';
import { ApiProvider, EnvProvider, SessionProvider, useApi } from '#components/context.tsx';
import { Shell } from '#components/Shell.tsx';
import { ErrorNotice, Loading } from '#components/ui.tsx';
import { ApiFailure, createApi, ok } from '#lib/api.ts';
import type { AppEnv } from '#lib/env.ts';
import { navigate, usePath } from '#lib/router.tsx';

const ME = ['me'] as const;

/** Esquece tudo o que veio da API e marca "sem sessão": o `Gate` mostra o login. */
function forget(client: QueryClient): void {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== ME[0] });
  client.setQueryData(ME, null);
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center px-4">
      {children}
    </main>
  );
}

/** Decide entre carregando, erro, entrada (login ou convite) e o app com a sessão. */
function Gatekeeper() {
  const api = useApi();
  const client = useQueryClient();
  const path = usePath();
  const me = useQuery({
    queryKey: ME,
    queryFn: async () => {
      try {
        return await ok(api.client.GET('/api/auth/me'));
      } catch (error) {
        // 401 é "sem sessão", não falha: `null` leva ao login.
        if (error instanceof ApiFailure && error.status === 401) return null;
        throw error;
      }
    },
  });

  const logout = useCallback(() => {
    api.client
      .POST('/api/auth/logout')
      .catch((error: unknown) => console.warn('falha ao encerrar a sessão no servidor', error))
      // A tela de entrada vale mesmo que o servidor não tenha respondido: a sessão some daqui.
      .finally(() => forget(client));
  }, [api, client]);

  if (me.isPending) {
    return (
      <Centered>
        <Loading />
      </Centered>
    );
  }
  // Com sessão carregada, a falha de uma revalidação (bot fora do ar) não troca o app pelo erro:
  // o Shell segue de pé e o indicador mostra "reconectando".
  if (me.isError && me.data === undefined) {
    return (
      <Centered>
        <ErrorNotice error={me.error} onRetry={() => void me.refetch()} />
      </Centered>
    );
  }
  if (me.data === null) {
    const entered = () => void client.invalidateQueries({ queryKey: ME });
    if (path === '/convite') {
      return (
        <Invite
          onDone={() => {
            navigate('/', { replace: true });
            entered();
          }}
        />
      );
    }
    return <Login onDone={entered} />;
  }
  return (
    <SessionProvider
      me={me.data}
      logout={logout}
      onStreamClosed={() => void client.invalidateQueries({ queryKey: ME })}
    >
      <Shell />
    </SessionProvider>
  );
}

export function App({ env, queryClient }: { env: AppEnv; queryClient?: QueryClient }) {
  // Um cliente da API e um cache por montagem; o 401 de qualquer chamada derruba a sessão.
  const [{ api, client }] = useState(() => {
    const client =
      queryClient ??
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      });
    const api = createApi(env);
    api.onUnauthorized(() => forget(client));
    return { api, client };
  });
  return (
    <EnvProvider value={env}>
      <ApiProvider value={api}>
        <QueryClientProvider client={client}>
          <Gatekeeper />
        </QueryClientProvider>
      </ApiProvider>
    </EnvProvider>
  );
}
