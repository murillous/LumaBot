import type { ReactNode } from 'react';

/**
 * Tabela dentro de caixa com rolagem horizontal (a página não rola de lado). Cabeçalho em 12
 * `--muted`, linhas separadas por `--line`.
 */
export function Table({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card bg-raised shadow-[var(--e1),var(--top)]">
      <table
        aria-label={label}
        className="w-full border-collapse text-left [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-3 [&_th]:text-label [&_th]:font-medium [&_th]:text-muted [&_tbody]:divide-y [&_tbody]:divide-line [&_thead]:border-b [&_thead]:border-line"
      >
        {children}
      </table>
    </div>
  );
}

/**
 * Linha que expande: a primeira célula é um `button` com `aria-expanded` e o `detail` ocupa uma
 * linha abaixo, só enquanto aberta.
 */
export function ExpandRow({
  cells,
  expanded,
  onToggle,
  detail,
}: {
  cells: readonly ReactNode[];
  expanded: boolean;
  onToggle: () => void;
  detail: ReactNode;
}) {
  const [first, ...rest] = cells;
  return (
    <>
      {/* O clique na linha toda é conveniência de mouse; o button da 1ª célula é o controle de teclado e leitor de tela. */}
      <tr
        onClick={(event) => {
          // Controle dentro da linha (link, campo) tem a ação própria; e arrastar para selecionar
          // texto não é pedido de abrir.
          if ((event.target as HTMLElement).closest('a,button,input,select,textarea')) return;
          if (window.getSelection()?.toString()) return;
          onToggle();
        }}
        className="cursor-pointer"
      >
        <td>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={(event) => {
              // O clique no button já vale; sem isto subiria ao <tr> e abriria e fecharia no mesmo toque.
              event.stopPropagation();
              onToggle();
            }}
            className="min-h-11 w-full cursor-pointer text-left"
          >
            {first}
          </button>
        </td>
        {rest.map((cell, i) => (
          // As células não mudam de ordem: o índice é a identidade delas.
          // biome-ignore lint/suspicious/noArrayIndexKey: ordem fixa da linha
          <td key={i}>{cell}</td>
        ))}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={cells.length}>{detail}</td>
        </tr>
      )}
    </>
  );
}
