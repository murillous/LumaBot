import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApi, useSession } from '#components/context.tsx';
import { PageTitle } from '#components/PageTitle.tsx';
import { Button, ErrorNotice, Forbidden, Loading } from '#components/ui.tsx';
import { ApiFailure, messageOf, ok, type Schemas } from '#lib/api.ts';
import { useLeaveGuard } from '#lib/router.tsx';
import { type CatalogProvider, ChainEditor } from './ai/ChainEditor.tsx';
import {
  type AiDraft,
  buildAiBody,
  buildResourceBody,
  type ChainItem,
  isRecord,
  lockedLabel,
  type ModelStatus,
  msToSeconds,
  normalizeOwn,
  parseChain,
  sameChain,
  secondsToMs,
  viewOverrides,
} from './ai/chain.ts';
import {
  FallbackRules,
  KeysTable,
  LimitFields,
  type Limits,
  RESOURCES,
  ResourceTable,
} from './ai/Sections.tsx';

type PluginConfig = Schemas['PluginConfig'];

const AI = 'ai';
const RESOURCE_NAMES = RESOURCES.map((r) => r.plugin);

/** Erros 400 por plugin (`ai`, `luma`...) e caminho (`models.0.temperature`). */
type Errors = Record<string, Record<string, string>>;

function h2(text: string) {
  return <h2 className="font-display text-section font-semibold">{text}</h2>;
}

export function Ai() {
  const { can } = useSession();
  if (!can('config.read')) return <Forbidden />;
  return <AiScreen />;
}

function AiScreen() {
  const { client } = useApi();
  const aiConfig = useQuery({
    queryKey: ['ai-screen', 'config', AI],
    queryFn: () => ok(client.GET('/api/plugins/{name}/config', { params: { path: { name: AI } } })),
  });
  const catalog = useQuery({
    queryKey: ['ai-screen', 'catalog'],
    queryFn: () => ok(client.GET('/api/plugins/ai/catalog')),
  });
  const resources = useQueries({
    queries: RESOURCE_NAMES.map((name) => ({
      queryKey: ['ai-screen', 'config', name],
      queryFn: () => ok(client.GET('/api/plugins/{name}/config', { params: { path: { name } } })),
    })),
  });

  if (aiConfig.isPending || catalog.isPending) {
    return (
      <section className="flex flex-col gap-4">
        <PageTitle>IA</PageTitle>
        <Loading />
      </section>
    );
  }
  const failed = aiConfig.error ?? catalog.error;
  if (failed || !aiConfig.data || !catalog.data) {
    return (
      <section className="flex flex-col gap-4">
        <PageTitle>IA</PageTitle>
        <ErrorNotice
          error={failed}
          onRetry={() => {
            void aiConfig.refetch();
            void catalog.refetch();
          }}
        />
      </section>
    );
  }
  const resourceConfigs: Record<string, PluginConfig | undefined> = Object.fromEntries(
    RESOURCE_NAMES.map((name, i) => [name, resources[i]?.data]),
  );
  // Espera as cinco terminarem: a cadeia própria de cada recurso entra no rascunho no 1º render.
  if (resources.some((r) => r.isPending)) {
    return (
      <section className="flex flex-col gap-4">
        <PageTitle>IA</PageTitle>
        <Loading />
      </section>
    );
  }
  return (
    <AiForm
      aiConfig={aiConfig.data}
      catalog={catalog.data.providers}
      resourceConfigs={resourceConfigs}
    />
  );
}

/** Rascunho da cadeia própria de cada recurso; `null` é a ordem principal. */
const ownOf = (config: PluginConfig | undefined): ChainItem[] | null => {
  const view = config?.view?.config;
  const chain = isRecord(view) ? parseChain(view['models']) : [];
  return chain.length > 0 ? chain : null;
};

const numberOf = (config: unknown, key: string, fallback: number): number => {
  const value = isRecord(config) ? config[key] : undefined;
  return typeof value === 'number' ? value : fallback;
};

function baselineOf(config: PluginConfig): AiDraft {
  const view = config.view?.config;
  return {
    chain: isRecord(view) ? parseChain(view['models']) : [],
    timeoutMs: numberOf(view, 'timeoutMs', 60_000),
    cooldownMs: numberOf(view, 'cooldownMs', 60_000),
    maxToolSteps: numberOf(view, 'maxToolSteps', 5),
    keys: {},
  };
}

const limitsOf = (draft: AiDraft): Limits => ({
  timeout: msToSeconds(draft.timeoutMs),
  cooldown: msToSeconds(draft.cooldownMs),
  steps: String(draft.maxToolSteps),
});

function AiForm({
  aiConfig,
  catalog,
  resourceConfigs,
}: {
  aiConfig: PluginConfig;
  catalog: readonly CatalogProvider[];
  resourceConfigs: Record<string, PluginConfig | undefined>;
}) {
  const { client } = useApi();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const canWrite = can('config.write');
  const canKeys = can('secrets.write');

  const base = baselineOf(aiConfig);
  const baseOwn = Object.fromEntries(RESOURCE_NAMES.map((n) => [n, ownOf(resourceConfigs[n])]));

  const [chain, setChain] = useState<ChainItem[]>(() => [...base.chain]);
  const [limits, setLimits] = useState<Limits>(() => limitsOf(base));
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [own, setOwn] = useState<Record<string, ChainItem[] | null>>(() => baseOwn);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string[]>([]);

  const timeoutMs = secondsToMs(limits.timeout);
  const cooldownMs = secondsToMs(limits.cooldown);
  const steps = Number(limits.steps);
  const limitErrors: Partial<Record<keyof Limits, string>> = {
    ...((timeoutMs === null || timeoutMs <= 0) && {
      timeout: 'Informe os segundos (maior que 0).',
    }),
    ...(cooldownMs === null && { cooldown: 'Informe os segundos (0 ou mais).' }),
    ...(!Number.isInteger(steps) || steps < 1
      ? { steps: 'Informe um número inteiro, 1 ou mais.' }
      : {}),
    ...errorsOf(errors[AI] ?? {}),
  };
  const localInvalid =
    timeoutMs === null ||
    timeoutMs <= 0 ||
    cooldownMs === null ||
    !Number.isInteger(steps) ||
    steps < 1;

  const unavailable = new Set(RESOURCE_NAMES.filter((n) => resourceConfigs[n]?.view == null));
  const ownChanged = RESOURCE_NAMES.filter((n) => {
    if (unavailable.has(n)) return false;
    const a = normalizeOwn(own[n] ?? null);
    const b = normalizeOwn(baseOwn[n] ?? null);
    return a === null || b === null ? a !== b : !sameChain(a, b);
  });
  const draft: AiDraft = {
    chain,
    timeoutMs: timeoutMs ?? base.timeoutMs,
    cooldownMs: cooldownMs ?? base.cooldownMs,
    maxToolSteps: Number.isInteger(steps) && steps >= 1 ? steps : base.maxToolSteps,
    keys,
  };
  const aiChanged =
    !sameChain(chain, base.chain) ||
    draft.timeoutMs !== base.timeoutMs ||
    draft.cooldownMs !== base.cooldownMs ||
    draft.maxToolSteps !== base.maxToolSteps ||
    Object.values(keys).some((v) => v !== '');
  const dirty = aiChanged || ownChanged.length > 0;
  useLeaveGuard(dirty, 'Há alterações não salvas. Sair desta tela descarta tudo.');

  // O estado de cada modelo que aparece na tela, inclusive os do rascunho e os de cadeia própria.
  const listed = [
    ...new Set([
      ...chain.map((i) => i.model),
      ...Object.values(own).flatMap((c) => (c ?? []).map((i) => i.model)),
    ]),
  ].sort();
  const statusQuery = useQuery({
    queryKey: ['ai-screen', 'status', listed.join(',')],
    queryFn: () =>
      ok(
        client.GET('/api/plugins/ai/status', {
          params: { query: listed.length > 0 ? { models: listed.join(',') } : {} },
        }),
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const status: Record<string, ModelStatus> = Object.fromEntries(
    (statusQuery.data?.models ?? []).map((m) => [m.model, m]),
  );
  // Com modelo em espera, o "N s" conta a cada segundo.
  const [now, setNow] = useState(() => Date.now());
  const cooling = (statusQuery.data?.models ?? []).some((m) => m.state === 'cooldown');
  useEffect(() => {
    setNow(Date.now());
    if (!cooling) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooling]);

  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setSaved(false);
      setter(value);
    };

  async function save() {
    setSaving(true);
    setSaved(false);
    setErrors({});
    setGeneral([]);
    const nextErrors: Errors = {};
    const loose: string[] = [];
    let failed = false;
    const put = async (name: string, body: Record<string, unknown>) => {
      const { data, error, response } = await client.PUT('/api/plugins/{name}/config', {
        params: { path: { name } },
        body,
      });
      if (response.ok && data) {
        queryClient.setQueryData(['ai-screen', 'config', name], data);
        return;
      }
      failed = true;
      const problem = error as Schemas['Problem'] | undefined;
      const issues = problem?.errors ?? [];
      // 409 é o segredo sombreado por env ou arquivo: também vem com o campo no `path`.
      if ((response.status === 400 || response.status === 409) && issues.length > 0) {
        for (const issue of issues) {
          const byPath = nextErrors[name] ?? {};
          byPath[issue.path] = issue.message;
          nextErrors[name] = byPath;
        }
      } else {
        loose.push(messageOf(new ApiFailure(response.status, problem)));
      }
    };
    try {
      if (aiChanged) {
        const overrides = aiConfig.view ? viewOverrides(aiConfig.view) : {};
        await put(AI, buildAiBody(overrides, base, draft));
      }
      for (const name of ownChanged) {
        if (failed) break;
        const cfg = resourceConfigs[name];
        const overrides = cfg?.view ? viewOverrides(cfg.view) : {};
        await put(name, buildResourceBody(overrides, own[name] ?? null));
      }
    } catch (error) {
      failed = true;
      loose.push(messageOf(error));
    }
    setErrors(nextErrors);
    setGeneral(loose);
    if (!failed) {
      setKeys({});
      setSaved(true);
    }
    setSaving(false);
  }

  function discard() {
    setChain([...base.chain]);
    setLimits(limitsOf(base));
    setKeys({});
    setOwn(baseOwn);
    setErrors({});
    setGeneral([]);
    setSaved(false);
  }

  if (aiConfig.view === null) {
    return (
      <section className="flex flex-col gap-4">
        <PageTitle>IA</PageTitle>
        <div role="alert" className="rounded-field bg-danger-soft p-4 text-danger">
          <p>A config atual da IA é inválida; corrija pelo arquivo ou pelo painel genérico.</p>
          <ul className="mt-2 list-disc pl-6">
            {(aiConfig.issues ?? []).map((issue) => (
              <li key={`${issue.path}-${issue.message}`}>
                <span className="font-mono text-label">{issue.path}</span>: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  const aiErrors = errors[AI] ?? {};
  const aiSources = aiConfig.view?.sources ?? {};
  const limitLock = (field: string) => lockedLabel(AI, aiSources, field);
  const [lockTimeout, lockCooldown, lockSteps] = [
    limitLock('timeoutMs'),
    limitLock('cooldownMs'),
    limitLock('maxToolSteps'),
  ];
  const lockedLimits: Partial<Record<keyof Limits, string>> = {
    ...(lockTimeout && { timeout: lockTimeout }),
    ...(lockCooldown && { cooldown: lockCooldown }),
    ...(lockSteps && { steps: lockSteps }),
  };
  const lockedModels = Object.fromEntries(
    RESOURCE_NAMES.map((n) => [
      n,
      lockedLabel(n, resourceConfigs[n]?.view?.sources ?? {}, 'models'),
    ]),
  );
  const placed = (path: string) =>
    /^models(\.|$)/.test(path) ||
    /^keys\./.test(path) ||
    ['timeoutMs', 'cooldownMs', 'maxToolSteps'].includes(path);
  const unplaced = [
    ...Object.entries(errors).flatMap(([plugin, byPath]) =>
      Object.entries(byPath)
        .filter(([path]) => !placed(path))
        .map(([path, message]) => `${plugin === AI ? '' : `${plugin}: `}${path}: ${message}`),
    ),
    ...general,
  ];

  return (
    <section className="flex flex-col gap-6">
      <PageTitle>IA</PageTitle>

      <div className="flex flex-col gap-3">
        {h2('Ordem de tentativa')}
        {chain.length === 0 && (
          <p className="text-muted">
            Nenhum modelo na cadeia.{canWrite ? ' Adicione um para a Luma responder.' : ''}
          </p>
        )}
        {catalog.length === 0 ? (
          <p className="text-muted">O catálogo de provedores está vazio.</p>
        ) : (
          <ChainEditor
            name="ordem principal"
            items={chain}
            onChange={edit(setChain)}
            catalog={catalog}
            status={status}
            now={now}
            readOnly={!canWrite || Boolean(lockedLabel(AI, aiSources, 'models'))}
            errors={aiErrors}
            locked={lockedLabel(AI, aiSources, 'models')}
            footer="Se todos falharem, a Luma avisa no chat que está indisponível."
          />
        )}
      </div>

      <div className="flex flex-col gap-3">
        {h2('Quando passa para o próximo')}
        <FallbackRules />
        <LimitFields
          value={limits}
          onChange={edit(setLimits)}
          readOnly={!canWrite}
          locked={lockedLimits}
          errors={limitErrors}
        />
      </div>

      <div className="flex flex-col gap-3">
        {h2('Por recurso')}
        <ResourceTable
          own={own}
          unavailable={unavailable}
          main={chain}
          onChange={(plugin, next) => {
            setSaved(false);
            setOwn({ ...own, [plugin]: next });
          }}
          catalog={catalog}
          status={status}
          now={now}
          readOnly={!canWrite}
          locked={lockedModels}
          errors={errors}
        />
      </div>

      <div id="chaves" className="flex flex-col gap-3">
        {h2('Chaves')}
        <KeysTable
          catalog={catalog}
          typed={keys}
          onType={(provider, value) => {
            setSaved(false);
            setKeys({ ...keys, [provider]: value });
          }}
          canWrite={canWrite && canKeys}
          secretsWritable={aiConfig.secretsWritable}
          sources={aiSources}
          schema={aiConfig.schema}
          errors={aiErrors}
        />
      </div>

      {unplaced.length > 0 && (
        <div role="alert" className="rounded-field bg-danger-soft p-4 text-danger">
          <p>Não foi possível salvar:</p>
          <ul className="list-disc pl-6">
            {unplaced.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!dirty || localInvalid || saving} onClick={save}>
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </Button>
          {dirty && (
            <>
              <Button disabled={saving} onClick={discard}>
                Descartar
              </Button>
              <p role="status" className="text-warn">
                Alterações não salvas
              </p>
            </>
          )}
          {saved && !dirty && (
            <p role="status" className="text-ok">
              Alterações salvas
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Erros do 400 que caem nos três campos de limite. */
function errorsOf(byPath: Record<string, string>): Partial<Record<keyof Limits, string>> {
  return {
    ...(byPath['timeoutMs'] && { timeout: byPath['timeoutMs'] }),
    ...(byPath['cooldownMs'] && { cooldown: byPath['cooldownMs'] }),
    ...(byPath['maxToolSteps'] && { steps: byPath['maxToolSteps'] }),
  };
}
