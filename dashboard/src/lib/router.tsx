import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useMemo,
  useSyncExternalStore,
} from 'react';

// Roteamento por caminho com a history API, sem lib: o `vite dev` e o `vite preview` já devolvem
// o index.html para qualquer caminho.

const subscribe = (notify: () => void): (() => void) => {
  window.addEventListener('popstate', notify);
  return () => window.removeEventListener('popstate', notify);
};

/** Sem a barra final: `/ia/` e `/ia` são a mesma tela. */
const normalize = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);

export function usePath(): string {
  return normalize(useSyncExternalStore(subscribe, () => location.pathname));
}

export interface NavigateOptions {
  /** Troca a entrada atual do histórico em vez de empilhar (redirecionar, ajustar filtro). */
  replace?: boolean;
}

export function navigate(to: string, { replace = false }: NavigateOptions = {}): void {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  // `pushState` e `replaceState` não disparam `popstate`; avisa quem assina.
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** A query string da URL, para telas que guardam filtros nela. */
export function useSearch(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => location.search);
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** Troca a query string mantendo o caminho. Filtro que muda a cada tecla usa `replace`. */
export function setSearch(params: URLSearchParams, options: NavigateOptions = {}): void {
  const query = params.toString();
  navigate(location.pathname + (query === '' ? '' : `?${query}`), options);
}

/** `%` solto na URL lança em `decodeURIComponent`: caminho assim simplesmente não casa. */
function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** `/plugins/:nome` casa `/plugins/ai` com `{ nome: 'ai' }`; sem casar, `null`. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/');
  const got = path.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of want.entries()) {
    const value = got[i] ?? '';
    if (part.startsWith(':')) {
      const decoded = decode(value);
      if (decoded === null) return null;
      params[part.slice(1)] = decoded;
    } else if (part !== value) return null;
  }
  return params;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string;
  children: ReactNode;
};

/** Link interno: navega sem recarregar, mas deixa abrir em nova aba e copiar o endereço. */
export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a {...rest} href={to} onClick={click}>
      {children}
    </a>
  );
}

/** O que cada tela recebe: os parâmetros do caminho (`/plugins/:nome` dá `{ nome }`). */
export interface PageProps {
  params: Record<string, string>;
}
