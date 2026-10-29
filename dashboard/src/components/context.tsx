import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Api } from '#lib/api.ts';
import type { paths } from '#lib/api-types.d.ts';
import type { AppEnv, EventSourceLike } from '#lib/env.ts';

/** O ator de `GET /api/auth/me`. */
export type MeView = paths['/api/auth/me']['get']['responses'][200]['content']['application/json'];

const ApiContext = createContext<Api | null>(null);
export const ApiProvider = ApiContext.Provider;

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (api === null) throw new Error('useApi fora do ApiProvider');
  return api;
}

export interface Session {
  readonly me: MeView;
  /** O ator tem a permissão; `undefined` é a tela aberta a qualquer pessoa logada. */
  readonly can: (permission: string | undefined) => boolean;
  readonly logout: () => void;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error('useSession fora do SessionProvider');
  return session;
}

export function SessionProvider({
  me,
  logout,
  children,
}: {
  me: MeView;
  logout: () => void;
  children: ReactNode;
}) {
  const session = useMemo<Session>(() => {
    const permissions = new Set(me.permissions);
    return {
      me,
      can: (permission) => permission === undefined || permissions.has(permission),
      logout,
    };
  }, [me, logout]);
  return (
    <SessionContext.Provider value={session}>
      <LiveProvider env={useEnv()} enabled={session.can('connection.read')}>
        {children}
      </LiveProvider>
    </SessionContext.Provider>
  );
}

const EnvContext = createContext<AppEnv | null>(null);
export const EnvProvider = EnvContext.Provider;

function useEnv(): AppEnv {
  const env = useContext(EnvContext);
  if (env === null) throw new Error('useEnv fora do EnvProvider');
  return env;
}

/** `connecting` até o 1º aberto; `reconnecting` quando o stream cai; `off` sem `connection.read`. */
export type LiveStatus = 'off' | 'connecting' | 'live' | 'reconnecting';

export type LiveHandler = (data: unknown, event: MessageEvent<string>) => void;

interface Live {
  readonly status: LiveStatus;
  /** Assina os eventos de um tipo do stream; devolve o cancelamento. As telas usam isto. */
  readonly listen: (type: string, handler: LiveHandler) => () => void;
}

const LiveContext = createContext<Live>({ status: 'off', listen: () => () => undefined });

export const useLive = (): Live => useContext(LiveContext);

/** Assina um tipo de evento enquanto o componente existe. */
export function useLiveEvent(type: string, handler: LiveHandler): void {
  const { listen } = useLive();
  // O handler novo a cada render não pode reassinar: fica numa ref.
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => listen(type, (data, event) => latest.current(data, event)), [listen, type]);
}

// O EventSource desiste depois de uma resposta que não é 200 (401, 403, 503): reabre com folga.
const REOPEN_MS = 5000;
const CLOSED = 2;

/**
 * Um stream por aba para o app todo (o browser limita conexões por origem). Sem `enabled` (a
 * pessoa não tem `connection.read`) nem abre: o `/api/events` responderia 403 em laço.
 */
function LiveProvider({
  env,
  enabled,
  children,
}: {
  env: AppEnv;
  enabled: boolean;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const handlers = useRef(new Map<string, Set<LiveHandler>>());
  // O `EventSource` atual e os tipos já ligados nele; reconectar por conta nossa recomeça do zero.
  const current = useRef<{ source: EventSourceLike; types: Set<string> } | null>(null);

  const attach = useCallback((type: string) => {
    const live = current.current;
    if (live === null || live.types.has(type)) return;
    live.types.add(type);
    live.source.addEventListener(type, (message) => {
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch {
        // O servidor só manda JSON; um frame ilegível é descartado sem derrubar o stream.
        return;
      }
      for (const handler of handlers.current.get(type) ?? []) handler(data, message);
    });
  }, []);

  const listen = useCallback(
    (type: string, handler: LiveHandler) => {
      const set = handlers.current.get(type) ?? new Set<LiveHandler>();
      set.add(handler);
      handlers.current.set(type, set);
      attach(type);
      return () => {
        set.delete(handler);
      };
    },
    [attach],
  );

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = (): void => {
      const source = env.openEvents(`${env.baseUrl}/api/events`);
      current.current = { source, types: new Set() };
      for (const type of handlers.current.keys()) attach(type);
      source.onopen = () => setStatus('live');
      source.onerror = () => {
        setStatus('reconnecting');
        if (source.readyState === CLOSED) {
          source.close();
          timer = setTimeout(open, REOPEN_MS);
        }
      };
    };
    open();
    return () => {
      clearTimeout(timer);
      current.current?.source.close();
      current.current = null;
      setStatus('connecting');
    };
  }, [env, enabled, attach]);

  const value = useMemo<Live>(
    () => ({ status: enabled ? status : 'off', listen }),
    [enabled, status, listen],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
