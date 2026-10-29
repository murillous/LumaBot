export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Escolha entre poucas opções (até 6; mais que isso vira `select`). Fundo `--sunken`, opção
 * ativa em `--raised` com `e1`, `aria-pressed` em cada botão.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** Nome do grupo para leitor de tela. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="m-0 inline-flex min-w-0 flex-wrap gap-1 rounded-field border-0 bg-sunken p-1">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className="min-h-11 cursor-pointer rounded-sm px-3 text-ink aria-pressed:bg-raised aria-pressed:font-medium aria-pressed:shadow-e1"
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
