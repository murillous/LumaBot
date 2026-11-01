/** Interruptor (liga e desliga plugin): `role="switch"`, ligado em `--ok`. */
export function Switch({
  label,
  checked,
  onChange,
  disabled,
}: {
  /** O que o interruptor liga, para leitor de tela (o nome do plugin, por exemplo). */
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center disabled:cursor-not-allowed disabled:opacity-45"
    >
      <span
        aria-hidden="true"
        className={`flex h-6 w-11 items-center rounded-full p-0.5 ${checked ? 'justify-end bg-ok' : 'justify-start bg-plate'}`}
      >
        <span className="size-5 rounded-full bg-raised shadow-e1" />
      </span>
    </button>
  );
}
