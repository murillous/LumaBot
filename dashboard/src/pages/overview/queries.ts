import { useQuery } from '@tanstack/react-query';
import { useApi } from '#components/context.tsx';
import { ok } from '#lib/api.ts';

// As leituras da Visão geral. Cada uma é uma query própria: a que falha não derruba as outras, e
// a cadeia de IA e o "Precisa de atenção" compartilham o mesmo `ai/status`.

const DAY_MS = 24 * 60 * 60 * 1000;

export function useConnection() {
  const api = useApi();
  return useQuery({
    queryKey: ['overview', 'connection'],
    queryFn: () => ok(api.client.GET('/api/connection')),
  });
}

export function useAiStatus(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: ['overview', 'ai-status'],
    enabled,
    queryFn: () => ok(api.client.GET('/api/plugins/ai/status')),
  });
}

export function usePlugins(enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['overview', 'plugins'],
    enabled,
    queryFn: () => ok(api.client.GET('/api/plugins')),
  });
}

/** Avisos e erros das últimas 24 h; o `from` nasce na chamada para a chave não mudar a cada render. */
export function useRecentProblems(enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['overview', 'logs-warn'],
    enabled,
    queryFn: () =>
      ok(
        api.client.GET('/api/logs', {
          params: {
            query: { level: 'warn', from: new Date(Date.now() - DAY_MS).toISOString(), limit: 50 },
          },
        }),
      ),
  });
}

export function useRecentAudit() {
  const api = useApi();
  return useQuery({
    queryKey: ['overview', 'audit'],
    queryFn: () => ok(api.client.GET('/api/audit', { params: { query: { limit: 5 } } })),
  });
}

export function useMetricCatalog() {
  const api = useApi();
  return useQuery({
    queryKey: ['overview', 'metrics-catalog'],
    queryFn: () => ok(api.client.GET('/api/plugins/metrics/catalog')),
  });
}
