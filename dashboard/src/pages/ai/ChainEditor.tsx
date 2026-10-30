import { useId, useState } from 'react';
import { Segmented } from '#components/Segmented.tsx';
import { StateWord } from '#components/StateWord.tsx';
import { Button } from '#components/ui.tsx';
import type { paths } from '#lib/api-types.d.ts';
import {
  type ChainItem,
  chainErrorTarget,
  changeProvider,
  DEFAULT_TEMPERATURE,
  joinModel,
  type ModelStatus,
  makeItem,
  moveItem,
  OUTPUT_PRESETS,
  removeAt,
  replaceAt,
  splitModel,
  stateWord,
  withMaxOutput,
  withModel,
  withTemperature,
} from './chain.ts';

export type CatalogProvider =
  paths['/api/plugins/ai/catalog']['get']['responses'][200]['content']['application/json']['providers'][number];

const MAX_SEGMENTS = 6;

const fmtNumber = (value: number): string => value.toLocaleString('pt-BR');

function paramsText(item: ChainItem, provider: CatalogProvider | undefined): string {
  return [
    provider?.name ?? (splitModel(item.model).provider || 'sem provedor'),
    item.temperature === undefined ? null : `temp. ${fmtNumber(item.temperature)}`,
    item.maxOutputTokens === undefined ? null : `${fmtNumber(item.maxOutputTokens)} tokens`,
  ]
    .filter(Boolean)
    .join(' · ');
}

const iconButton =
  'inline-flex size-11 cursor-pointer items-center justify-center rounded-btn text-ink hover:bg-plate disabled:cursor-not-allowed disabled:opacity-45';

/**
 * A cadeia numerada, com a edição da posição selecionada. Serve à ordem principal e à cadeia
 * própria de cada recurso. Sem `readOnly`, a pessoa reordena, remove, adiciona e edita.
 */
export function ChainEditor({
  name,
  items,
  onChange,
  catalog,
  status,
  now,
  readOnly,
  errors,
  footer,
  locked,
  flat,
}: {
  /** Identifica a cadeia nos rótulos dos botões e dos campos. */
  name: string;
  items: readonly ChainItem[];
  onChange: (items: ChainItem[]) => void;
  catalog: readonly CatalogProvider[];
  /** Estado por item da cadeia (`GET /status`); sem a chamada, a palavra não aparece. */
  status: Readonly<Record<string, ModelStatus>>;
  now: number;
  readOnly: boolean;
  /** Erros 400 desta cadeia por caminho (`models.1.temperature`). */
  errors: Readonly<Record<string, string>>;
  /** Texto depois da lista (a ordem principal fecha dizendo o que acontece se todos falharem). */
  footer?: string;
  /** Por que a cadeia só tem leitura ("definido por BRIDGER_AI__MODELS"). */
  locked?: string | null;
  /** Dentro de uma tabela: a edição não vira outro card. */
  flat?: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const [adding, setAdding] = useState(false);
  const index = Math.min(selected, items.length - 1);
  const current = items[index];
  const providerOf = (item: ChainItem) =>
    catalog.find((p) => p.id === splitModel(item.model).provider);

  const rowErrors = (i: number): boolean =>
    Object.keys(errors).some((path) => chainErrorTarget(path)?.index === i);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3">
        <ol aria-label={`Ordem de tentativa, ${name}`} className="flex flex-col">
          {items.map((item, i) => {
            const provider = providerOf(item);
            const word = stateWord(status[item.model], provider !== undefined, now);
            const isSelected = i === index;
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: a mesma cadeia pode ter o modelo repetido vindo do arquivo; a posição desempata
                key={`${i}-${item.model}`}
                className={`flex items-center gap-1 rounded-field border-t border-line first:border-t-0 ${isSelected ? 'bg-raised shadow-e1' : ''}`}
              >
                <span aria-hidden="true" className="w-8 shrink-0 text-center text-muted">
                  {i + 1}
                </span>
                <button
                  type="button"
                  aria-current={isSelected ? 'true' : undefined}
                  aria-label={`Editar ${item.model}`}
                  onClick={() => setSelected(i)}
                  className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col items-start py-2 text-left"
                >
                  <span className="max-w-full break-all font-mono text-label">{item.model}</span>
                  <span className="text-help text-muted">{paramsText(item, provider)}</span>
                  {rowErrors(i) ? (
                    <StateWord tone="danger">com erro</StateWord>
                  ) : (
                    word && <StateWord tone={word.tone}>{word.text}</StateWord>
                  )}
                </button>
                {!readOnly && (
                  <div className="flex shrink-0">
                    <button
                      type="button"
                      aria-label={`Subir ${item.model}`}
                      disabled={i === 0}
                      onClick={() => {
                        onChange(moveItem(items, i, i - 1));
                        setSelected(i - 1);
                      }}
                      className={iconButton}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Descer ${item.model}`}
                      disabled={i === items.length - 1}
                      onClick={() => {
                        onChange(moveItem(items, i, i + 1));
                        setSelected(i + 1);
                      }}
                      className={iconButton}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Remover ${item.model}`}
                      disabled={items.length <= 1}
                      onClick={() => {
                        onChange(removeAt(items, i));
                        setSelected(0);
                      }}
                      className={iconButton}
                    >
                      ×
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {footer && <p className="text-help text-muted">{footer}</p>}
        {locked && <p className="text-help text-muted">Só leitura: {locked}.</p>}
        {!readOnly && (
          <div className="flex flex-col items-start gap-3">
            <Button aria-expanded={adding} onClick={() => setAdding(!adding)}>
              Adicionar modelo
            </Button>
            {adding && (
              <AddModel
                name={name}
                catalog={catalog}
                inChain={items.map((i) => i.model)}
                onAdd={(model) => {
                  onChange([...items, makeItem(model)]);
                  setSelected(items.length);
                  setAdding(false);
                }}
              />
            )}
          </div>
        )}
      </div>
      {!readOnly && current !== undefined && (
        <PositionEditor
          key={`${index}-${items.length}`}
          name={name}
          position={index + 1}
          item={current}
          catalog={catalog}
          errors={errors}
          index={index}
          taken={items.filter((_, i) => i !== index).map((i) => i.model)}
          flat={flat === true}
          onChange={(item) => onChange(replaceAt(items, index, item))}
        />
      )}
    </div>
  );
}

function AddModel({
  name,
  catalog,
  inChain,
  onAdd,
}: {
  name: string;
  catalog: readonly CatalogProvider[];
  inChain: readonly string[];
  onAdd: (model: string) => void;
}) {
  return (
    <fieldset className="m-0 flex w-full min-w-0 flex-col gap-3 rounded-field border-0 bg-sunken p-3">
      <legend className="sr-only">Catálogo de modelos, {name}</legend>
      {catalog.map((provider) => (
        <div key={provider.id} className="flex flex-col gap-1">
          <h4 className="font-medium">{provider.name}</h4>
          <div className="flex flex-wrap gap-2">
            {provider.models.map((m) => {
              const model = joinModel(provider.id, m.id);
              return (
                <Button
                  key={model}
                  disabled={inChain.includes(model)}
                  aria-label={`Adicionar ${model}`}
                  onClick={() => onAdd(model)}
                  className="font-mono text-label"
                >
                  {m.id}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </fieldset>
  );
}

function PositionEditor({
  name,
  position,
  item,
  catalog,
  errors,
  index,
  taken,
  flat,
  onChange,
}: {
  name: string;
  position: number;
  item: ChainItem;
  catalog: readonly CatalogProvider[];
  errors: Readonly<Record<string, string>>;
  index: number;
  /** Modelos das outras posições: a mesma cadeia não repete modelo. */
  taken: readonly string[];
  flat: boolean;
  onChange: (item: ChainItem) => void;
}) {
  const id = useId();
  const { provider: providerId, id: modelId } = splitModel(item.model);
  const provider = catalog.find((p) => p.id === providerId);
  const range = provider?.temperature ?? DEFAULT_TEMPERATURE;
  const knownModel = provider?.models.some((m) => m.id === modelId) ?? false;
  const errorOf = (field: string) => errors[`models.${index}.${field}`];
  const modelError = errorOf('model') ?? errors[`models.${index}`];
  const tempError = errorOf('temperature');
  const outputError = errorOf('maxOutputTokens');

  // Valor fora dos presets (vindo do arquivo) ganha a própria opção, para não sumir da tela.
  const outputOptions = [
    ...OUTPUT_PRESETS.map((v) => ({
      value: v === undefined ? 'default' : String(v),
      label: v === undefined ? 'padrão' : fmtNumber(v),
    })),
    ...(item.maxOutputTokens !== undefined &&
    !(OUTPUT_PRESETS as readonly (number | undefined)[]).includes(item.maxOutputTokens)
      ? [
          {
            value: String(item.maxOutputTokens),
            label: `${fmtNumber(item.maxOutputTokens)} (atual)`,
          },
        ]
      : []),
  ];
  const providerOptions = catalog.map((p) => ({ value: p.id, label: p.name }));
  const pickProvider = (next: string) => {
    const target = catalog.find((p) => p.id === next);
    const first = target?.models.find((m) => !taken.includes(joinModel(next, m.id)))?.id;
    if (target === undefined || first === undefined) return;
    onChange(changeProvider(item, next, first, target.temperature ?? DEFAULT_TEMPERATURE));
  };

  return (
    <section
      aria-label={`Edição da posição ${position}, ${name}`}
      className={`flex min-w-0 flex-col gap-4 ${flat ? 'border-t border-line pt-4' : 'rounded-card bg-raised p-4 shadow-[var(--e1),var(--top)]'}`}
    >
      <h3 className="font-display text-sub font-semibold">Posição {position}</h3>

      <div className="flex flex-col gap-1">
        <span className="font-medium">Provedor</span>
        {catalog.length > MAX_SEGMENTS ? (
          <select
            aria-label="Provedor"
            value={providerId}
            onChange={(event) => pickProvider(event.target.value)}
            className="min-h-11 rounded-field bg-raised px-3 text-base text-ink shadow-e1 md:text-body"
          >
            {provider === undefined && <option value={providerId}>{providerId}</option>}
            {providerOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <Segmented
            label="Provedor"
            options={providerOptions}
            value={provider === undefined ? '' : providerId}
            onChange={pickProvider}
          />
        )}
        {provider === undefined && (
          <p className="text-help text-warn">Provedor fora do catálogo.</p>
        )}
        {provider?.key === 'missing' && (
          <p className="text-help text-danger">
            Sem chave da {provider.name}: esta posição é pulada. Veja{' '}
            <a href="#chaves" className="underline">
              Chaves
            </a>
            .
          </p>
        )}
      </div>

      <fieldset
        className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0"
        aria-invalid={modelError ? true : undefined}
        aria-describedby={modelError ? `${id}-model-error` : undefined}
      >
        <legend className="mb-1 font-medium">Modelo</legend>
        {provider?.models.map((m) => (
          <label key={m.id} className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="radio"
              name={`${id}-model`}
              checked={m.id === modelId}
              disabled={taken.includes(joinModel(providerId, m.id))}
              onChange={() => onChange(withModel(item, joinModel(providerId, m.id)))}
            />
            <span className="break-all font-mono text-label">{m.id}</span>
            {(m.audio || m.nativeSearch) && (
              <span className="text-help text-muted">
                {[m.audio && 'áudio', m.nativeSearch && 'busca nativa'].filter(Boolean).join(', ')}
              </span>
            )}
          </label>
        ))}
        {!knownModel && (
          <label className="flex min-h-11 items-center gap-3">
            <input type="radio" name={`${id}-model`} checked readOnly />
            <span className="break-all font-mono text-label">{modelId}</span>
            <span className="text-help text-warn">fora do catálogo</span>
          </label>
        )}
        {modelError && (
          <p id={`${id}-model-error`} className="text-help text-danger">
            {modelError}
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-temp`} className="font-medium">
          Temperatura
        </label>
        <div className="flex items-center gap-3">
          <input
            id={`${id}-temp`}
            type="range"
            min={range.min}
            max={range.max}
            step={0.1}
            disabled={item.temperature === undefined}
            value={item.temperature ?? Math.min(1, range.max)}
            aria-invalid={tempError ? true : undefined}
            aria-describedby={tempError ? `${id}-temp-error` : undefined}
            onChange={(event) =>
              onChange(withTemperature(item, Math.round(Number(event.target.value) * 10) / 10))
            }
            className="min-h-11 min-w-0 flex-1 accent-ink disabled:opacity-45"
          />
          <output htmlFor={`${id}-temp`} className="w-16 text-right font-mono text-label">
            {item.temperature === undefined ? 'padrão' : fmtNumber(item.temperature)}
          </output>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={item.temperature === undefined}
            onChange={(event) =>
              onChange(
                withTemperature(item, event.target.checked ? undefined : Math.min(1, range.max)),
              )
            }
          />
          Padrão do provedor
        </label>
        <p className="text-help text-muted">
          De {fmtNumber(range.min)} a {fmtNumber(range.max)} neste provedor.
        </p>
        {item.temperature !== undefined && item.temperature > range.max && (
          <p className="text-help text-warn">
            Temperatura {fmtNumber(item.temperature)} acima do máximo do provedor.
          </p>
        )}
        {tempError && (
          <p id={`${id}-temp-error`} className="text-help text-danger">
            {tempError}
          </p>
        )}
      </div>

      <fieldset
        className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0"
        aria-invalid={outputError ? true : undefined}
        aria-describedby={outputError ? `${id}-out-error` : undefined}
      >
        <legend className="mb-1 font-medium">Saída máxima</legend>
        <Segmented
          label="Valores de saída máxima"
          options={outputOptions}
          value={item.maxOutputTokens === undefined ? 'default' : String(item.maxOutputTokens)}
          onChange={(value) =>
            onChange(withMaxOutput(item, value === 'default' ? undefined : Number(value)))
          }
        />
        {outputError && (
          <p id={`${id}-out-error`} className="text-help text-danger">
            {outputError}
          </p>
        )}
      </fieldset>
    </section>
  );
}
