import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ErrorNotice, Loading } from '#components/ui.tsx';
import { Link } from '#lib/router.tsx';

/** Seção da Visão geral: título (20) e, à direita, o link que leva à tela dona do assunto. */
export function Section({
  title,
  link,
  children,
}: {
  title: string;
  link?: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="font-display text-section font-semibold">{title}</h2>
        {link && <PageLink to={link.to}>{link.label}</PageLink>}
      </div>
      {children}
    </section>
  );
}

/** Link de texto com alvo de toque de 44 px. */
export function PageLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex min-h-11 items-center underline">
      {children}
    </Link>
  );
}

/** Carregando, erro (com "Tentar de novo") ou o dado: cada seção falha sozinha. */
export function Remote<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <Loading />;
  if (query.isError)
    return <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />;
  return children(query.data);
}
