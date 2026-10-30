import { useState } from 'react';
import { Segmented } from '#components/Segmented.tsx';
import { StateWord } from '#components/StateWord.tsx';
import { ExpandRow, Table } from '#components/Table.tsx';
import { Field, inputClass } from '#components/ui.tsx';
import { type CatalogProvider, ChainEditor } from './ChainEditor.tsx';
import { type ChainItem, keyEnvName, type ModelStatus } from './chain.ts';

/** Resumo da seção Fallback de `docs/ai.md`: o que a cadeia faz em cada situação. */
const FALLBACK_RULES: readonly (readonly [string, string])[] = [
  [
    'Erro transitório (429, 408, 409, 5xx, falha de rede, timeout)',
    'Registra um aviso e tenta o próximo modelo.',
  ],
  ['Outro erro (400, chave inválida)', 'Para na hora, porque se repetiria no próximo.'],
  [
    '429 (limite de uso)',
    'O modelo vai para o fim da cadeia pelo tempo de espera; continua nela. Zera ao reiniciar o bot.',
  ],
  ['Provedor não registrado (sem chave, ou plugin desligado)', 'Registra um erro e pula o modelo.'],
  ['Cancelamento de quem chamou', 'Para sem tentar o próximo.'],
  ['Todos falharam', 'A Luma avisa no chat que está indisponível.'],
];

export function FallbackRules() {
  return (
    <Table label="Quando passa para o próximo modelo">
      <thead>
        <tr>
          <th scope="col">Situação</th>
          <th scope="col">O que acontece</th>
        </tr>
      </thead>
      <tbody>
        {FALLBACK_RULES.map(([situation, outcome]) => (
          <tr key={situation}>
            <td>{situation}</td>
            <td>{outcome}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export interface Limits {
  readonly timeout: string;
  readonly cooldown: string;
  readonly steps: string;
}

/** Os três limites da cadeia, em segundos e passos; `errors` traz o texto de cada campo inválido. */
export function LimitFields({
  value,
  onChange,
  readOnly,
  errors,
}: {
  value: Limits;
  onChange: (value: Limits) => void;
  readOnly: boolean;
  errors: Partial<Record<keyof Limits, string>>;
}) {
  const fields = [
    {
      key: 'timeout',
      label: 'Tempo limite por tentativa (segundos)',
      help: 'Um modelo travado não segura a cadeia.',
    },
    {
      key: 'cooldown',
      label: 'Espera depois do 429 (segundos)',
      help: 'Quanto tempo o modelo fica no fim da cadeia.',
    },
    {
      key: 'steps',
      label: 'Passos por resposta com ferramentas',
      help: 'Chamar a ferramenta e responder já são dois passos.',
    },
  ] as const;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {fields.map(({ key, label, help }) => (
        <Field key={key} label={label} help={help} error={errors[key]}>
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="decimal"
              value={value[key]}
              disabled={readOnly}
              onChange={(event) => onChange({ ...value, [key]: event.target.value })}
              className={inputClass}
            />
          )}
        </Field>
      ))}
    </div>
  );
}

export interface Resource {
  /** Nome do plugin (`PUT /api/plugins/<nome>/config`). */
  readonly plugin: string;
  readonly label: string;
  readonly hint?: string;
}

export const RESOURCES: readonly Resource[] = [
  { plugin: 'luma', label: 'Conversa' },
  { plugin: 'resumo', label: 'Resumo' },
  { plugin: 'transcribe', label: 'Transcrição', hint: 'Precisa de modelo que aceite áudio.' },
  { plugin: 'spontaneous', label: 'Reação com emoji' },
  {
    plugin: 'web-search',
    label: 'Busca na web, reserva',
    hint: 'Só o Gemini busca; os outros são pulados.',
  },
];

type Mode = 'main' | 'own';

/** Cada recurso usa a ordem principal ou uma cadeia própria (`models` do plugin). */
export function ResourceTable({
  own,
  unavailable,
  main,
  onChange,
  catalog,
  status,
  now,
  readOnly,
  errors,
}: {
  /** Cadeia própria por plugin; `null` é a ordem principal. */
  own: Readonly<Record<string, readonly ChainItem[] | null>>;
  /** Plugins cuja config não carregou. */
  unavailable: ReadonlySet<string>;
  main: readonly ChainItem[];
  onChange: (plugin: string, chain: ChainItem[] | null) => void;
  catalog: readonly CatalogProvider[];
  status: Readonly<Record<string, ModelStatus>>;
  now: number;
  readOnly: boolean;
  /** Erros 400 por plugin e caminho. */
  errors: Readonly<Record<string, Readonly<Record<string, string>>>>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Table label="Cadeia de cada recurso">
      <thead>
        <tr>
          <th scope="col">Recurso</th>
          <th scope="col">Cadeia</th>
          <th scope="col">Modelos</th>
        </tr>
      </thead>
      <tbody>
        {RESOURCES.map(({ plugin, label, hint }) => {
          const chain = own[plugin] ?? null;
          const mode: Mode = chain === null ? 'main' : 'own';
          if (unavailable.has(plugin)) {
            return (
              <tr key={plugin}>
                <td>{label}</td>
                <td colSpan={2}>
                  <StateWord tone="warn">indisponível</StateWord>
                  <span className="text-muted"> — a config do plugin não carregou.</span>
                </td>
              </tr>
            );
          }
          const nameCell = (
            <span key="name" className="flex flex-col">
              <span>{label}</span>
              {hint && <span className="text-help text-muted">{hint}</span>}
            </span>
          );
          return (
            <ExpandRow
              key={plugin}
              expanded={open === plugin}
              onToggle={() => setOpen(open === plugin ? null : plugin)}
              cells={[
                nameCell,
                readOnly ? (
                  <span key="mode">{mode === 'main' ? 'Ordem principal' : 'Própria'}</span>
                ) : (
                  <Segmented<Mode>
                    key="mode"
                    label={`Cadeia de ${label}`}
                    options={[
                      { value: 'main', label: 'Ordem principal' },
                      { value: 'own', label: 'Própria' },
                    ]}
                    value={mode}
                    onChange={(next) => {
                      if (next === mode) return;
                      onChange(plugin, next === 'main' ? null : [...main]);
                      setOpen(next === 'own' ? plugin : open);
                    }}
                  />
                ),
                <span key="n" className="text-muted">
                  {chain === null ? 'os da ordem principal' : `${chain.length}`}
                </span>,
              ]}
              detail={
                chain === null ? (
                  <p className="text-muted">Usa a ordem de tentativa principal, acima.</p>
                ) : (
                  <ChainEditor
                    name={label}
                    items={chain}
                    onChange={(next) => onChange(plugin, next)}
                    catalog={catalog}
                    status={status}
                    now={now}
                    readOnly={readOnly}
                    errors={errors[plugin] ?? {}}
                  />
                )
              }
            />
          );
        })}
      </tbody>
    </Table>
  );
}

/** Uma linha por provedor do catálogo: configurada, pela variável ou sem chave. */
export function KeysTable({
  catalog,
  typed,
  onType,
  canWrite,
  secretsWritable,
  errors,
}: {
  catalog: readonly CatalogProvider[];
  typed: Readonly<Record<string, string>>;
  onType: (provider: string, value: string) => void;
  /** A pessoa tem `secrets.write`. */
  canWrite: boolean;
  /** O servidor tem chave mestra para guardar segredo. */
  secretsWritable: boolean;
  errors: Readonly<Record<string, string>>;
}) {
  return (
    <Table label="Chaves dos provedores">
      <thead>
        <tr>
          <th scope="col">Provedor</th>
          <th scope="col">Estado</th>
          {canWrite && <th scope="col">Chave</th>}
        </tr>
      </thead>
      <tbody>
        {catalog.map((provider) => {
          const error = errors[`keys.${provider.id}`];
          const errorId = `key-${provider.id}-error`;
          return (
            <tr key={provider.id}>
              <th scope="row" className="font-medium">
                {provider.name}
              </th>
              <td>
                {provider.key === 'configured' && <StateWord tone="ok">configurada</StateWord>}
                {provider.key === 'missing' && <StateWord tone="danger">sem chave</StateWord>}
                {provider.key === 'env' && (
                  <span className="text-muted">
                    pela variável{' '}
                    <span className="font-mono text-label">{keyEnvName(provider.id)}</span>
                  </span>
                )}
              </td>
              {canWrite && (
                <td>
                  {provider.key === 'env' ? (
                    <span className="text-help text-muted">só leitura</span>
                  ) : secretsWritable ? (
                    <div className="flex flex-col gap-1">
                      <input
                        type="password"
                        autoComplete="new-password"
                        aria-label={`Chave de ${provider.name}`}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        placeholder={provider.key === 'missing' ? 'cole a chave' : 'trocar chave'}
                        value={typed[provider.id] ?? ''}
                        onChange={(event) => onType(provider.id, event.target.value)}
                        className={inputClass}
                      />
                      {error && (
                        <p id={errorId} className="text-help text-danger">
                          {error}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-help text-muted">
                      O servidor não tem chave mestra: defina pela variável.
                    </span>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
