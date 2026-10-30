import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi, useLiveEvent, useSession } from '#components/context.tsx';
import { PageTitle } from '#components/PageTitle.tsx';
import { StateWord } from '#components/StateWord.tsx';
import { Switch } from '#components/Switch.tsx';
import { Card, ErrorNotice, Loading } from '#components/ui.tsx';
import { ok, type Schemas } from '#lib/api.ts';
import { Link, type PageProps } from '#lib/router.tsx';
import { ConfigForm } from '#pages/plugins/ConfigForm.tsx';
import { groupPlugins, stateOf } from '#pages/plugins/groups.ts';

type Plugin = Schemas['Plugin'];

const PLUGINS = ['plugins'] as const;

function Row({
  plugin,
  selected,
  canManage,
  onToggle,
  busy,
}: {
  plugin: Plugin;
  selected: boolean;
  canManage: boolean;
  onToggle: (plugin: Plugin, enable: boolean) => void;
  busy: boolean;
}) {
  const state = stateOf(plugin);
  return (
    <li className="flex items-center justify-between gap-3 py-1">
      <div className="flex min-w-0 flex-col">
        <Link
          to={`/plugins/${encodeURIComponent(plugin.name)}`}
          {...(selected && { 'aria-current': 'page' as const })}
          className={`flex min-h-11 items-center truncate rounded-field px-3 ${selected ? 'bg-raised font-medium shadow-e1' : ''}`}
        >
          {plugin.name}
        </Link>
        {state.word && (
          <span className="px-3 text-help">
            <StateWord tone={state.word.tone}>{state.word.text}</StateWord>
            {state.detail && <span className="text-muted">: {state.detail}</span>}
          </span>
        )}
      </div>
      {canManage ? (
        <Switch
          label={plugin.name}
          checked={state.on}
          disabled={busy}
          onChange={(next) => onToggle(plugin, next)}
        />
      ) : (
        !state.on && !state.word && <span className="pr-3 text-help text-muted">desligado</span>
      )}
    </li>
  );
}

function ConfigPane({ name }: { name: string }) {
  const api = useApi();
  const { can } = useSession();
  const client = useQueryClient();
  const key = ['plugin-config', name] as const;
  const path = { params: { path: { name } } };
  const config = useQuery({
    queryKey: key,
    queryFn: () => ok(api.client.GET('/api/plugins/{name}/config', path)),
    enabled: can('config.read'),
  });
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      ok(api.client.PUT('/api/plugins/{name}/config', { ...path, body })),
    onMutate: () => setSaved(false),
    onSuccess: (data) => {
      client.setQueryData(key, data);
      setSaved(true);
    },
  });

  if (!can('config.read')) {
    return <p className="text-muted">Você não tem permissão para ver a config deste plugin.</p>;
  }
  if (config.isPending) return <Loading />;
  if (config.isError)
    return <ErrorNotice error={config.error} onRetry={() => void config.refetch()} />;
  if (config.data.schema === null) {
    return <p className="text-muted">Este plugin não tem config.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {saved && (
        <p role="status" className="text-ok">
          Config salva; o plugin recarregou.
        </p>
      )}
      <ConfigForm
        // Versão nova (salva ou relida) remonta o formulário com o que o servidor devolveu.
        key={JSON.stringify([config.data.view?.config ?? null, config.data.view?.sources ?? null])}
        plugin={name}
        data={config.data}
        canWrite={can('config.write')}
        saving={save.isPending}
        error={save.error}
        onSave={(body) => save.mutate(body)}
      />
    </div>
  );
}

/** Liga, desliga e ajusta cada plugin: lista agrupada e, ao lado, o formulário da config. */
export function Plugins({ params }: PageProps) {
  const api = useApi();
  const { can } = useSession();
  const client = useQueryClient();
  const selected = params['nome'];
  const list = useQuery({
    queryKey: PLUGINS,
    queryFn: () => ok(api.client.GET('/api/plugins')),
  });
  // Ligar, desligar ou recarregar um plugin (de qualquer lugar) relê a lista.
  useLiveEvent('plugin.status', () => void client.invalidateQueries({ queryKey: PLUGINS }));

  const toggle = useMutation({
    mutationFn: ({ plugin, enable }: { plugin: Plugin; enable: boolean }) => {
      const p = { params: { path: { name: plugin.name } } };
      return ok(
        enable
          ? api.client.POST('/api/plugins/{name}/enable', p)
          : api.client.POST('/api/plugins/{name}/disable', p),
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: PLUGINS }),
  });

  const plugins = list.data?.plugins ?? [];
  const current = plugins.find((p) => p.name === selected);

  let left: React.ReactNode;
  if (list.isPending) left = <Loading />;
  else if (list.isError) {
    left = <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;
  } else if (plugins.length === 0) left = <p className="text-muted">Nenhum plugin registrado.</p>;
  else {
    left = (
      <div className="flex flex-col gap-4">
        {toggle.isError && <ErrorNotice error={toggle.error} />}
        {groupPlugins(plugins).map((group) => (
          <section key={group.name} aria-label={group.name} className="flex flex-col gap-1">
            <h2 className="font-display text-sub font-semibold">{group.name}</h2>
            <ul className="m-0 list-none divide-y divide-line p-0">
              {group.plugins.map((plugin) => (
                <Row
                  key={plugin.name}
                  plugin={plugin}
                  selected={plugin.name === selected}
                  canManage={can('plugins.manage')}
                  busy={toggle.isPending}
                  onToggle={(p, enable) => toggle.mutate({ plugin: p, enable })}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  let right: React.ReactNode;
  if (selected === undefined)
    right = <p className="text-muted">Escolha um plugin para ver a config.</p>;
  else if (list.isSuccess && current === undefined) {
    right = <p className="text-muted">Plugin “{selected}” não encontrado.</p>;
  } else right = <ConfigPane key={selected} name={selected} />;

  return (
    <section className="flex flex-col gap-6">
      <PageTitle>Plugins</PageTitle>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div>{left}</div>
        {(selected !== undefined || list.isSuccess) && (
          <Card className="flex flex-col gap-4">
            {selected !== undefined && (
              <h2 className="font-display text-section font-semibold">
                <span className="font-mono text-body">{selected}</span>
              </h2>
            )}
            {right}
          </Card>
        )}
      </div>
    </section>
  );
}
