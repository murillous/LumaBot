import { type ReactNode, useId, useState } from 'react';
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
  sameValue,
} from './schema.ts';

type PluginConfig = Schemas['PluginConfig'];

// O seletor de cor exige um valor válido mesmo sem dado; montado sem literal para a regra de cor do guia.
const EMPTY_COLOR = '#'.padEnd(7, '0');

const YES_NO = [
  { value: 'true', label: 'Sim' },
  { value: 'false', label: 'Não' },
] as const;

/** Rótulo, ajuda e erro de um controle que não é um único `input` (segmentado, etiquetas). */
function GroupField({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: string | undefined;
  error?: string | undefined;
  children: (props: { 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode;
}) {
  const id = useId();
  const described = [help ? `${id}-help` : undefined, error ? `${id}-error` : undefined]
    .filter(Boolean)
    .join(' ');
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
      <legend className="p-0 font-medium">{label}</legend>
      {children({
        ...(described && { 'aria-describedby': described }),
        ...(error && { 'aria-invalid': true as const }),
      })}
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
  errors: Readonly<Record<string, string>>;
  valueOf: (leaf: Leaf) => unknown;
  set: (leaf: Leaf, value: unknown) => void;
}

function Input({ leaf, ctx }: { leaf: Leaf; ctx: Ctx }) {
  const source = ctx.sources[leaf.path];
  const locked = isLocked(source);
  const value = ctx.valueOf(leaf);
  const control = leaf.control;
  const error = ctx.errors[leaf.path];
  const disabled = ctx.readOnly || locked;
  const help =
    source === 'env'
      ? `Definido pela variável ${envName(ctx.plugin, leaf.path)}: não muda por aqui.`
      : source === 'file'
        ? 'Definido no arquivo de config: não muda por aqui.'
        : leaf.help;

  if (control.kind === 'models') {
    const own = source === 'override' && Array.isArray(value);
    return (
      <div className="flex flex-col gap-1">
        <span className="font-medium">Modelos</span>
        {own ? (
          <ol className="m-0 list-decimal pl-6">
            {(value as { model?: string }[]).map((item, i) => (
              // A posição é parte do sentido da cadeia (ordem de tentativa); o id repete.
              // biome-ignore lint/suspicious/noArrayIndexKey: a ordem é o dado
              <li key={`${i}-${item.model}`} className="font-mono text-label">
                {item.model}
              </li>
            ))}
          </ol>
        ) : (
          <p>Ordem principal</p>
        )}
        <p className="text-help text-muted">
          O modelo se escolhe só na tela{' '}
          <Link to="/ia" className="underline">
            IA
          </Link>
          .
        </p>
      </div>
    );
  }

  if (control.kind === 'segmented' || control.kind === 'toggle') {
    const options =
      control.kind === 'toggle'
        ? YES_NO
        : control.options.map((option) => ({ value: option, label: option }));
    const current = control.kind === 'toggle' ? String(value === true) : String(value ?? '');
    return (
      <GroupField label={leaf.label} help={help} error={error}>
        {() =>
          disabled ? (
            <p className="font-mono text-label">{current}</p>
          ) : (
            <Segmented
              label={leaf.label}
              options={options}
              value={current}
              onChange={(next) => ctx.set(leaf, control.kind === 'toggle' ? next === 'true' : next)}
            />
          )
        }
      </GroupField>
    );
  }

  if (control.kind === 'tags') {
    return (
      <GroupField label={leaf.label} help={help} error={error}>
        {() => (
          <Tags
            label={leaf.label}
            values={Array.isArray(value) ? (value as string[]) : []}
            disabled={disabled}
            onChange={(next) => ctx.set(leaf, next)}
          />
        )}
      </GroupField>
    );
  }

  if (control.kind === 'json') {
    return (
      <GroupField label={leaf.label} help={help ?? 'Não se edita por aqui; o valor é mantido.'}>
        {() => (
          <pre className="m-0 overflow-x-auto font-mono text-label">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
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
                onChange={(e) => ctx.set(leaf, e.target.value)}
                className={inputClass}
              >
                {isEmpty(value) && <option value="">—</option>}
                {control.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            );
          case 'color': {
            const hex = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '';
            return (
              <div className="flex items-center gap-3">
                <input
                  {...props}
                  type="color"
                  disabled={disabled}
                  value={hex === '' ? EMPTY_COLOR : hex}
                  onChange={(e) => ctx.set(leaf, e.target.value)}
                  className="h-11 w-14 cursor-pointer rounded-field bg-raised p-1 shadow-e1 disabled:opacity-45"
                />
                <span className="font-mono text-label">{hex === '' ? '—' : hex}</span>
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
                disabled={disabled || !ctx.secretsWritable}
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
  saving,
  error,
  onSave,
}: {
  plugin: string;
  data: PluginConfig;
  canWrite: boolean;
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
              <Button type="submit" variant="primary" disabled={saving}>
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
