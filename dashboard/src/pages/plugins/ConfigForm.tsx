import { type ReactNode, useEffect, useId, useState } from 'react';
import { Segmented } from '#components/Segmented.tsx';
import { Button, ErrorNotice, Field, type FieldProps, inputClass } from '#components/ui.tsx';
import { ApiFailure, type Schemas } from '#lib/api.ts';
import { Link } from '#lib/router.tsx';
import {
  buildBody,
  envName,
  errorsByPath,
  getPath,
  isEmpty,
  isLocked,
  type Json,
  type Leaf,
  leavesOf,
  MASK,
  type Node,
  nodesOf,
  type Option,
  sameValue,
  sourceOf,
} from '#pages/plugins/schema.ts';

type PluginConfig = Schemas['PluginConfig'];

/**
 * Rótulo, ajuda e erro de um controle que não é um único `input` (etiquetas, valor só leitura).
 * O `fieldset` carrega `aria-describedby` e `aria-invalid`. Com `bare` (segmentado, que já
 * tem o próprio `fieldset` com legenda) o rótulo é só visual, para não anunciar duas vezes.
 */
function GroupField({
  label,
  help,
  error,
  bare = false,
  children,
}: {
  label: string;
  help?: string | undefined;
  error?: string | undefined;
  bare?: boolean;
  children: ReactNode | ((props: { describedBy?: string; invalid?: boolean }) => ReactNode);
}) {
  const id = useId();
  const described = [help ? `${id}-help` : undefined, error ? `${id}-error` : undefined]
    .filter(Boolean)
    .join(' ');
  const notes = (
    <>
      {help && (
        <p id={`${id}-help`} className="text-help text-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-help text-danger">
          {error}
        </p>
      )}
    </>
  );
  if (bare) {
    return (
      <div className="flex flex-col gap-1">
        <span aria-hidden="true" className="font-medium">
          {label}
        </span>
        {typeof children === 'function'
          ? children({
              ...(described && { describedBy: described }),
              ...(error && { invalid: true }),
            })
          : children}
        {notes}
      </div>
    );
  }
  return (
    <fieldset
      aria-describedby={described || undefined}
      aria-invalid={error ? true : undefined}
      className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0"
    >
      <legend className="p-0 font-medium">{label}</legend>
      {typeof children === 'function' ? children({}) : children}
      {notes}
    </fieldset>
  );
}

function Tags({
  label,
  values,
  disabled,
  onChange,
}: {
  label: string;
  values: readonly string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const tag = draft.trim();
    if (tag !== '' && !values.includes(tag)) onChange([...values, tag]);
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-2">
      {values.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {values.map((tag) => (
            <li
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-plate py-0.5 pr-0.5 pl-3 text-help"
            >
              {tag}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remover ${tag}`}
                  onClick={() => onChange(values.filter((v) => v !== tag))}
                  className="grid size-11 cursor-pointer place-items-center rounded-full"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <input
            aria-label={`Adicionar a ${label}`}
            className={inputClass}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button onClick={add}>Adicionar</Button>
        </div>
      )}
    </div>
  );
}

interface Ctx {
  config: unknown;
  sources: Readonly<Record<string, string>>;
  plugin: string;
  readOnly: boolean;
  secretsWritable: boolean;
  canSecrets: boolean;
  errors: Readonly<Record<string, string>>;
  valueOf: (leaf: Leaf) => unknown;
  set: (leaf: Leaf, value: unknown) => void;
}

function Input({ leaf, ctx }: { leaf: Leaf; ctx: Ctx }) {
  const source = sourceOf(ctx.sources, leaf.path);
  const locked = isLocked(source);
  const value = ctx.valueOf(leaf);
  const control = leaf.control;
  const error = ctx.errors[leaf.path];
  const disabled = ctx.readOnly || locked;
  const lockNote =
    source === 'env'
      ? `Definido pela variável ${envName(ctx.plugin, leaf.path)}: não muda por aqui.`
      : source === 'file'
        ? 'Definido no arquivo de config: não muda por aqui.'
        : undefined;
  const secretNote =
    control.kind === 'secret' && !ctx.canSecrets
      ? 'Sem permissão para gravar segredos (secrets.write).'
      : undefined;
  const help = [leaf.help, lockNote, secretNote].filter(Boolean).join(' ') || undefined;

  if (control.kind === 'models') {
    const chain = Array.isArray(value) ? (value as { model?: string }[]) : [];
    // No plugin ai o `models` é a própria ordem principal; nos outros, vazio herda dela.
    const main = ctx.plugin === 'ai' && leaf.path === 'models';
    return (
      <div className="flex flex-col gap-1">
        <span className="font-medium">{leaf.label === 'models' ? 'Modelos' : leaf.label}</span>
        {chain.length > 0 ? (
          <ol className="m-0 list-decimal pl-6">
            {chain.map((item, i) => (
              // A posição é parte do sentido da cadeia (ordem de tentativa); o id repete.
              // biome-ignore lint/suspicious/noArrayIndexKey: a ordem é o dado
              <li key={`${i}-${item.model}`} className="font-mono text-label">
                {item.model}
              </li>
            ))}
          </ol>
        ) : (
          !main && <p>{leaf.path === 'models' ? 'Ordem principal' : 'Ordem principal da IA'}</p>
        )}
        <p className="text-help text-muted">
          <Link to="/ia" className="underline">
            {main ? 'Editar na tela IA' : 'Escolher na tela IA'}
          </Link>
        </p>
      </div>
    );
  }

  if (control.kind === 'segmented' || control.kind === 'toggle') {
    const options: readonly { raw: Option; label: string }[] =
      control.kind === 'toggle'
        ? [
            { raw: true, label: 'Sim' },
            { raw: false, label: 'Não' },
          ]
        : control.options.map((option) => ({ raw: option, label: String(option) }));
    // Opcional sem valor não aparece marcado: nenhuma opção ativa.
    const current = options.find((o) => o.raw === value);
    return (
      <GroupField label={leaf.label} help={help} error={error} bare={!disabled}>
        {(aria) =>
          disabled ? (
            <p className="font-mono text-label">{current?.label ?? '—'}</p>
          ) : (
            <Segmented
              {...aria}
              label={leaf.label}
              options={options.map((o) => ({ value: String(o.raw), label: o.label }))}
              value={current === undefined ? '' : String(current.raw)}
              onChange={(next) => {
                // O valor volta como o schema o declara (enum numérico continua número).
                const picked = options.find((o) => String(o.raw) === next);
                if (picked !== undefined) ctx.set(leaf, picked.raw);
              }}
            />
          )
        }
      </GroupField>
    );
  }

  if (control.kind === 'tags') {
    return (
      <GroupField label={leaf.label} help={help} error={error}>
        <Tags
          label={leaf.label}
          values={Array.isArray(value) ? (value as string[]) : []}
          disabled={disabled}
          onChange={(next) => ctx.set(leaf, next)}
        />
      </GroupField>
    );
  }

  if (control.kind === 'json') {
    return (
      <GroupField label={leaf.label} help={help ?? 'Não se edita por aqui; o valor é mantido.'}>
        <pre className="m-0 overflow-x-auto font-mono text-label">
          {JSON.stringify(value, null, 2)}
        </pre>
      </GroupField>
    );
  }

  return (
    <Field label={leaf.label} help={help} error={error}>
      {(props: FieldProps) => {
        switch (control.kind) {
          case 'slider':
            return (
              <div className="flex min-h-11 items-center gap-3">
                <input
                  {...props}
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  disabled={disabled}
                  value={typeof value === 'number' ? value : control.min}
                  onChange={(e) => ctx.set(leaf, Number(e.target.value))}
                  className="w-full accent-ink"
                />
                <output htmlFor={props.id} className="min-w-10 text-right font-mono text-label">
                  {typeof value === 'number' ? value : '—'}
                </output>
              </div>
            );
          case 'number':
            return (
              <div className="flex items-center gap-2">
                <input
                  {...props}
                  type="number"
                  inputMode={control.integer ? 'numeric' : 'decimal'}
                  step={control.integer ? 1 : 'any'}
                  {...(control.min !== undefined && { min: control.min })}
                  {...(control.max !== undefined && { max: control.max })}
                  disabled={disabled}
                  placeholder={leaf.placeholder}
                  value={typeof value === 'number' ? value : ''}
                  onChange={(e) =>
                    ctx.set(leaf, e.target.value === '' ? null : Number(e.target.value))
                  }
                  className={inputClass}
                />
                {control.unit && <span className="text-muted">{control.unit}</span>}
              </div>
            );
          case 'select':
            return (
              <select
                {...props}
                disabled={disabled}
                value={String(value ?? '')}
                onChange={(e) =>
                  ctx.set(
                    leaf,
                    control.options.find((o) => String(o) === e.target.value) ?? e.target.value,
                  )
                }
                className={inputClass}
              >
                {isEmpty(value) && <option value="">—</option>}
                {control.options.map((option) => (
                  <option key={String(option)} value={String(option)}>
                    {String(option)}
                  </option>
                ))}
              </select>
            );
          case 'color': {
            const valid = (v: unknown): v is string =>
              typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
            const shown = valid(value) ? value : valid(control.fallback) ? control.fallback : '';
            // Sem valor nem padrão não há cor para o seletor mostrar: só o campo de texto.
            return (
              <div className="flex items-center gap-3">
                {shown !== '' && (
                  <input
                    {...props}
                    type="color"
                    disabled={disabled}
                    value={shown}
                    onChange={(e) => ctx.set(leaf, e.target.value)}
                    className="h-11 w-14 cursor-pointer rounded-field bg-raised p-1 shadow-e1 disabled:opacity-45"
                  />
                )}
                <input
                  {...(shown === ''
                    ? props
                    : {
                        'aria-label': `${leaf.label} (hex)`,
                        'aria-describedby': props['aria-describedby'],
                        'aria-invalid': props['aria-invalid'],
                      })}
                  type="text"
                  disabled={disabled}
                  value={typeof value === 'string' ? value : ''}
                  placeholder={shown === '' ? leaf.placeholder : shown}
                  onChange={(e) => ctx.set(leaf, e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>
            );
          }
          case 'secret': {
            const saved = getPath(ctx.config, leaf.path) === MASK;
            return (
              <input
                {...props}
                type="password"
                autoComplete="new-password"
                disabled={disabled || !ctx.secretsWritable || !ctx.canSecrets}
                placeholder={saved ? MASK : ''}
                value={typeof value === 'string' && value !== MASK ? value : ''}
                onChange={(e) => ctx.set(leaf, e.target.value)}
                className={inputClass}
              />
            );
          }
          default:
            return (
              <input
                {...props}
                type="text"
                disabled={disabled}
                placeholder={leaf.placeholder}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => ctx.set(leaf, e.target.value)}
                className={inputClass}
              />
            );
        }
      }}
    </Field>
  );
}

function Tree({ nodes, ctx }: { nodes: readonly Node[]; ctx: Ctx }) {
  return nodes.map((node) =>
    node.type === 'field' ? (
      <Input key={node.path} leaf={node} ctx={ctx} />
    ) : (
      <section key={node.path} aria-label={node.label} className="flex flex-col gap-4">
        <h3 className="font-display text-sub font-semibold">{node.label}</h3>
        <Tree nodes={node.children} ctx={ctx} />
      </section>
    ),
  );
}

/**
 * Formulário gerado do JSON Schema. Guarda só o que a pessoa mudou (`edits`); o corpo do `PUT`
 * junta isso aos overrides que já existiam (ver `buildBody`).
 */
export function ConfigForm({
  plugin,
  data,
  canWrite,
  canSecrets,
  saving,
  error,
  onSave,
  onDirtyChange,
}: {
  plugin: string;
  data: PluginConfig;
  canWrite: boolean;
  canSecrets: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  saving: boolean;
  error: unknown;
  onSave: (body: Json) => void;
}) {
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [confirming, setConfirming] = useState(false);
  const nodes = nodesOf((data.schema ?? {}) as Json);
  const leaves = leavesOf(nodes);
  const config = data.view?.config ?? {};
  const sources = data.view?.sources ?? {};
  const failure = error instanceof ApiFailure ? error : undefined;
  const errors = errorsByPath(failure?.problem?.errors);
  const allMatched =
    failure !== undefined &&
    Object.keys(errors).length > 0 &&
    Object.keys(errors).every((path) => leaves.some((leaf) => leaf.path === path));

  const ctx: Ctx = {
    config,
    sources,
    plugin,
    readOnly: !canWrite,
    secretsWritable: data.secretsWritable,
    canSecrets,
    errors,
    valueOf: (leaf) => (leaf.path in edits ? edits[leaf.path] : getPath(config, leaf.path)),
    set: (leaf, value) => {
      const initial = getPath(config, leaf.path);
      // Voltar ao valor de partida (ou segredo vazio, que mantém o salvo) desfaz a edição.
      const undo =
        sameValue(value, initial) ||
        (isEmpty(value) && isEmpty(initial)) ||
        (leaf.control.kind === 'secret' && isEmpty(value));
      setEdits((prev) => {
        const { [leaf.path]: _old, ...rest } = prev;
        return undo ? rest : { ...rest, [leaf.path]: value };
      });
    },
  };

  const dirty = Object.keys(edits).length > 0;
  const invalidNow = data.view === null;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const save = () => {
    onSave(buildBody({ leaves, config, sources, messages: data.view?.messages ?? {}, edits }));
    setConfirming(false);
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalidNow && !confirming) setConfirming(true);
        else save();
      }}
    >
      {invalidNow && (
        <div role="alert" className="rounded-field bg-warn-soft p-4 text-warn">
          <p>A config atual é inválida e o formulário abre sem os valores.</p>
          <ul className="m-0 mt-2 list-disc pl-6">
            {(data.issues ?? []).map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                <span className="font-mono text-label">{issue.path}</span>: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!data.secretsWritable && leaves.some((l) => l.control.kind === 'secret') && (
        <p className="text-help text-muted">
          Segredo novo pede BRIDGER_SECRET_KEY no bot; os já salvos continuam valendo.
        </p>
      )}
      {error !== undefined && error !== null && !allMatched && <ErrorNotice error={error} />}
      {allMatched && (
        <p role="alert" className="text-danger">
          Revise os campos marcados.
        </p>
      )}
      <Tree nodes={nodes} ctx={ctx} />
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          {confirming ? (
            <>
              <p className="text-warn">Salvar substitui todos os overrides atuais.</p>
              <Button type="submit" variant="danger" disabled={saving}>
                Substituir e salvar
              </Button>
              <Button onClick={() => setConfirming(false)}>Cancelar</Button>
            </>
          ) : (
            <>
              <Button type="submit" variant="primary" disabled={saving || (!dirty && !invalidNow)}>
                Salvar
              </Button>
              {dirty && <span className="text-muted">Alterações não salvas</span>}
            </>
          )}
        </div>
      )}
    </form>
  );
}
