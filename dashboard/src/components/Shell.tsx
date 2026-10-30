import { useEffect, useRef, useState } from 'react';
import { type LiveStatus, useLive, useSession } from '#components/context.tsx';
import { ErrorBoundary } from '#components/ErrorBoundary.tsx';
import { PageTitle } from '#components/PageTitle.tsx';
import { Button, Forbidden } from '#components/ui.tsx';
import { confirmLeave, Link, matchPath, usePath } from '#lib/router.tsx';
import { applyTheme, loadTheme, saveTheme, THEMES, type Theme } from '#lib/theme.ts';
import { ENTRIES, GROUPS, isExternal, resolveRoute } from '#routes.ts';

const THEME_LABEL: Record<Theme, string> = { auto: 'Sistema', light: 'Claro', dark: 'Escuro' };

const LIVE_LABEL: Record<Exclude<LiveStatus, 'off'>, { text: string; tone: string }> = {
  connecting: { text: 'conectando', tone: 'text-muted' },
  live: { text: 'ao vivo', tone: 'text-ok' },
  reconnecting: { text: 'reconectando', tone: 'text-warn' },
};

/** "Ao vivo" só quando o `EventSource` está conectado; some sem `connection.read`. */
function LiveIndicator() {
  const { status } = useLive();
  if (status === 'off') return null;
  const { text, tone } = LIVE_LABEL[status];
  return (
    <p role="status" aria-label="Conexão em tempo real" className={`px-3 text-help ${tone}`}>
      {text}
    </p>
  );
}

/** Alterna Sistema, Claro e Escuro; `auto` devolve a decisão ao `prefers-color-scheme`. */
function ThemeButton() {
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? 'auto';
  return (
    <Button
      onClick={() => {
        applyTheme(next);
        saveTheme(next);
        setTheme(next);
      }}
    >
      Tema: {THEME_LABEL[theme]}
    </Button>
  );
}

const itemClass =
  'flex min-h-11 items-center rounded-field px-3 font-medium text-muted hover:bg-plate hover:text-ink aria-[current=page]:bg-raised aria-[current=page]:text-ink aria-[current=page]:shadow-e1';

function Menu({ path, onNavigate }: { path: string; onNavigate: () => void }) {
  const { can } = useSession();
  return (
    <nav aria-label="Principal" className="flex flex-col gap-4">
      {GROUPS.map((group) => {
        const items = ENTRIES.filter((e) => e.group === group && can(e.permission));
        if (items.length === 0) return null;
        return (
          <div key={group} className="flex flex-col gap-1">
            <h2 className="px-3 text-label text-muted">{group}</h2>
            <ul className="flex flex-col gap-1">
              {items.map((entry) => (
                <li key={entry.label}>
                  {isExternal(entry) ? (
                    // Painel genérico do Bridger: outra página, então link comum e não do SPA.
                    <a href={entry.href} className={itemClass}>
                      {entry.label}
                    </a>
                  ) : (
                    <Link
                      to={entry.paths[0]}
                      className={itemClass}
                      onClick={onNavigate}
                      aria-current={
                        entry.paths.some((p) => matchPath(p, path)) ? 'page' : undefined
                      }
                    >
                      {entry.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** A tela do caminho: a página, ou "sem permissão", ou "não encontrada". */
function Content({ path }: { path: string }) {
  const { can } = useSession();
  const found = resolveRoute(path);
  if (found === null) {
    return (
      <section className="flex flex-col gap-2">
        <PageTitle>Tela não encontrada</PageTitle>
        <p>
          <Link to="/" className="underline">
            Voltar à Visão geral
          </Link>
        </p>
      </section>
    );
  }
  if (!can(found.entry.permission)) return <Forbidden />;
  const Page = found.entry.page;
  return <Page params={found.params} />;
}

/** Sidebar de 248 px; abaixo de 768 px vira gaveta aberta pelo botão Menu. */
export function Shell() {
  const { me, logout } = useSession();
  const path = usePath();
  // A gaveta guarda o caminho em que abriu: navegar (inclusive voltar) a fecha sem efeito extra.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  // Sobe a cada clique no menu: clicar na tela em que já está também fecha a gaveta e leva o foco.
  const [clicks, setClicks] = useState(0);
  // Sobe quando o Esc fecha a gaveta: o botão Menu só aceita foco depois que o header deixa de ser
  // inerte, ou seja, depois do render.
  const [escapes, setEscapes] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const aside = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);
  const screen = resolveRoute(path)?.entry ?? null;
  // A tela é a entrada da rota, não o caminho: `/plugins/a` -> `/plugins/b` é a mesma tela.
  const shownScreen = useRef<typeof screen>(undefined);

  const screenTitle = screen?.label ?? 'Tela não encontrada';
  const focusScreen = () => {
    const target = main.current?.querySelector<HTMLElement>('h1') ?? main.current;
    // `PageTitle` e o `main` têm tabIndex -1: focáveis por código, fora da ordem do Tab.
    target?.focus();
  };

  // Troca de tela: título da aba e, se foi navegação (não o 1º render), foco no título da tela
  // para o leitor de tela anunciar a mudança. Só o parâmetro mudar não refoca nem mexe no título.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusScreen só lê refs
  useEffect(() => {
    const first = shownScreen.current === undefined;
    shownScreen.current = screen;
    document.title = `${screenTitle} · Luma`;
    if (!first) focusScreen();
  }, [screen, screenTitle]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focusScreen só lê refs
  useEffect(() => {
    if (clicks > 0) focusScreen();
  }, [clicks]);

  useEffect(() => {
    if (escapes > 0) trigger.current?.focus();
  }, [escapes]);

  // Passou de 768 px com a gaveta aberta: o menu vira sidebar fixa, então a gaveta fecha (senão
  // main e header ficariam inertes no desktop).
  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(min-width: 768px)');
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpenAt(null);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [open]);

  // Gaveta aberta: foco no primeiro link; Esc fecha e devolve o foco ao botão Menu.
  useEffect(() => {
    if (!open) return;
    aside.current?.querySelector<HTMLElement>('a')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenAt(null);
      setEscapes((n) => n + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <header inert={open} className="flex min-h-14 items-center gap-3 px-4 md:hidden">
        <Button
          ref={trigger}
          aria-expanded={open}
          aria-controls="menu-lateral"
          onClick={() => setOpenAt(open ? null : path)}
        >
          Menu
        </Button>
        <span className="font-display text-sub font-semibold">Luma</span>
      </header>
      {open && (
        <button
          type="button"
          aria-label="Fechar o menu"
          tabIndex={-1}
          className="fixed inset-0 z-20 bg-ink/40 md:hidden"
          onClick={() => setOpenAt(null)}
        />
      )}
      <aside
        id="menu-lateral"
        ref={aside}
        className={`${open ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-30 w-[248px] flex-col gap-4 overflow-y-auto bg-bg p-4 shadow-e3 md:static md:z-auto md:flex md:min-h-dvh md:shadow-[inset_-1px_0_0_var(--line)]`}
      >
        <p className="px-3 font-display text-section font-semibold">Luma</p>
        <LiveIndicator />
        <Menu
          path={path}
          onNavigate={() => {
            setOpenAt(null);
            setClicks((n) => n + 1);
          }}
        />
        <div className="mt-auto flex flex-col gap-3 px-3">
          <p className="text-help text-muted">{me.name}</p>
          <ThemeButton />
          <Button onClick={() => confirmLeave() && logout()}>Sair</Button>
        </div>
      </aside>
      <main
        ref={main}
        tabIndex={-1}
        inert={open}
        className="mx-auto w-full min-w-0 max-w-[1100px] px-4 py-6 focus:outline-none md:px-8 md:py-8"
      >
        <ErrorBoundary key={screenTitle} resetKey={path}>
          <Content path={path} />
        </ErrorBoundary>
      </main>
    </div>
  );
}
