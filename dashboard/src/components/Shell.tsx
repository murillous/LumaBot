import { useEffect, useRef, useState } from 'react';
import { type LiveStatus, useLive, useSession } from '#components/context.tsx';
import { Button, Forbidden } from '#components/ui.tsx';
import { Link, matchPath, usePath } from '#lib/router.tsx';
import { applyTheme, loadTheme, saveTheme, THEMES, type Theme } from '#lib/theme.ts';
import { ENTRIES, GROUPS, isExternal, type Screen } from '#routes.ts';

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
    <p role="status" aria-label="Conexão em tempo real" className={`text-help ${tone}`}>
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
  'flex min-h-11 items-center rounded-field px-3 text-ink aria-[current=page]:bg-raised aria-[current=page]:font-medium aria-[current=page]:shadow-e1';

function Menu({ path }: { path: string }) {
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
  for (const entry of ENTRIES) {
    if (isExternal(entry)) continue;
    for (const pattern of entry.paths) {
      const params = matchPath(pattern, path);
      if (params === null) continue;
      if (!can(entry.permission)) return <Forbidden />;
      const Page: Screen['page'] = entry.page;
      return <Page params={params} />;
    }
  }
  return (
    <section className="flex flex-col gap-2">
      <h1 className="font-display text-title font-semibold">Tela não encontrada</h1>
      <p>
        <Link to="/" className="underline">
          Voltar à Visão geral
        </Link>
      </p>
    </section>
  );
}

/** Sidebar de 248 px; abaixo de 768 px vira gaveta aberta pelo botão Menu. */
export function Shell() {
  const { me, logout } = useSession();
  const path = usePath();
  // A gaveta guarda o caminho em que abriu: navegar (inclusive voltar) a fecha sem efeito extra.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenAt(null);
      trigger.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <header className="flex min-h-14 items-center gap-3 px-4 md:hidden">
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
          className="fixed inset-0 z-20 bg-ink/40 md:hidden"
          onClick={() => setOpenAt(null)}
        />
      )}
      <aside
        id="menu-lateral"
        className={`${open ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-30 w-[248px] flex-col gap-6 overflow-y-auto bg-sunken p-4 md:static md:z-auto md:flex md:min-h-dvh`}
      >
        <p className="px-3 font-display text-section font-semibold">Luma</p>
        <Menu path={path} />
        <div className="mt-auto flex flex-col gap-3 px-3">
          <LiveIndicator />
          <p className="text-help text-muted">{me.name}</p>
          <ThemeButton />
          <Button onClick={logout}>Sair</Button>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8">
        <Content path={path} />
      </main>
    </div>
  );
}
