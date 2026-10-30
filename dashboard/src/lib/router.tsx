import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';

// Roteamento por caminho com a history API, sem lib: o `vite dev` e o `vite preview` já devolvem
// o index.html para qualquer caminho.

// Guarda de saída: cada tela com alteração pendente registra um token com a mensagem; navegar
// para outra tela, voltar no browser, sair da sessão ou fechar a aba pedem confirmação antes de
// perder o trabalho. Token por guarda (e não só a mensagem) para duas telas com o mesmo texto não
// desligarem uma à outra no cleanup.
interface Guard {
  readonly message: string;
}
const guards: Guard[] = [];
// Última URL aceita: o `popstate` do voltar chega com `location` já trocada, então é daqui que se
// desfaz o recuo quando a pessoa recusa.
let currentUrl = '';
// Posição da entrada atual no histórico, guardada em `history.state`: com ela, recusar um voltar
// ou avançar desfaz com `history.go` em vez de empilhar uma entrada duplicada.
let index = 0;
// `navigate` avisa os assinantes com um `popstate` sintético; esse não é o voltar do browser.
let notifying = false;
// Entre recusar um voltar e o `history.go` terminar, `location` ainda aponta para a tela de
// destino; `usePath` devolve a aceita para a tela não piscar a errada.
let undoing = false;

const pathOf = (url: string): string => url.split(/[?#]/)[0] ?? url;
const here = (): string => location.pathname + location.search;
const stateIndex = (): number | null => {
  const state: unknown = history.state;
  const i = (state as { i?: unknown } | null)?.i;
  return typeof i === 'number' ? i : null;
};

/** Pergunta se pode sair da tela (usa a mensagem da guarda mais recente); sem guarda, já pode. */
export function confirmLeave(): boolean {
  const last = guards.at(-1);
  return last === undefined || window.confirm(last.message);
}

if (typeof window !== 'undefined') {
  currentUrl = here();
  // Recarregar preserva `history.state`: o índice continua valendo e o `go` não erra o salto.
  const initial = stateIndex();
  index = initial ?? 0;
  if (initial === null) history.replaceState({ i: 0 }, '');
  // Registrado antes de qualquer assinante: ao recusar, a URL já foi restaurada quando eles leem.
  window.addEventListener('popstate', (event) => {
    if (notifying) return;
    const next = here();
    if (guards.length === 0 || pathOf(next) === pathOf(currentUrl) || confirmLeave()) {
      currentUrl = next;
      index = stateIndex() ?? index;
      undoing = false;
      return;
    }
    event.stopImmediatePropagation();
    undoing = true;
    const target = stateIndex();
    // Sem índice conhecido (ou igual), o único jeito é empilhar a URL de volta.
    if (target === null || target === index) {
      history.pushState({ i: index }, '', currentUrl);
      undoing = false;
    } else history.go(index - target);
  });
}

/**
 * Enquanto `when` for verdadeiro, sair desta tela pede confirmação com `message`: link, `navigate`,
 * voltar do browser, "Sair" e `beforeunload` (fechar a aba, recarregar, link externo).
 * Mudar só a query (filtro) não conta como sair.
 */
export function useLeaveGuard(when: boolean, message: string): void {
  useEffect(() => {
    if (!when) return;
    const guard: Guard = { message };
    guards.push(guard);
    currentUrl = here();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      const at = guards.indexOf(guard);
      if (at !== -1) guards.splice(at, 1);
    };
  }, [when, message]);
}

const subscribe = (notify: () => void): (() => void) => {
  window.addEventListener('popstate', notify);
  return () => window.removeEventListener('popstate', notify);
};

/** Sem a barra final: `/ia/` e `/ia` são a mesma tela. */
const normalize = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);

export function usePath(): string {
  return normalize(
    useSyncExternalStore(subscribe, () => (undoing ? pathOf(currentUrl) : location.pathname)),
  );
}

export interface NavigateOptions {
  /** Troca a entrada atual do histórico em vez de empilhar (redirecionar, ajustar filtro). */
  replace?: boolean;
  /** Pula a confirmação da guarda de saída (a pessoa já decidiu descartar). */
  force?: boolean;
}

/** `false` só quando a guarda de saída barrou e a pessoa ficou na tela. */
export function navigate(
  to: string,
  { replace = false, force = false }: NavigateOptions = {},
): boolean {
  if (to === here()) return true;
  if (!force && pathOf(to) !== location.pathname && !confirmLeave()) return false;
  if (replace) history.replaceState({ i: index }, '', to);
  else history.pushState({ i: ++index }, '', to);
  // `pushState` e `replaceState` não disparam `popstate`; avisa quem assina.
  currentUrl = here();
  // Navegar de novo encerra qualquer recusa pendente: `location` volta a ser a verdade.
  undoing = false;
  notifying = true;
  try {
    window.dispatchEvent(new PopStateEvent('popstate'));
  } finally {
    notifying = false;
  }
  return true;
}

/** A query string da URL, para telas que guardam filtros nela. */
export function useSearch(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () =>
    undoing ? (currentUrl.split('?')[1]?.split('#')[0] ?? '') : location.search.slice(1),
  );
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
  /** Roda só se a navegação aconteceu (a guarda de saída não barrou). */
  onNavigate?: () => void;
};

/** Link interno: navega sem recarregar, mas deixa abrir em nova aba e copiar o endereço. */
export function Link({ to, onClick, onNavigate, children, ...rest }: LinkProps) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (navigate(to)) onNavigate?.();
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
