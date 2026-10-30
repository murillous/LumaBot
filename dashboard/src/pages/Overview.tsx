import { useSession } from '#components/context.tsx';
import { PageTitle } from '#components/PageTitle.tsx';
import { Attention } from '#pages/overview/Attention.tsx';
import { ConnectionLine } from '#pages/overview/Connection.tsx';
import { ChainSummary, RecentAudit } from '#pages/overview/Summary.tsx';
import { Today } from '#pages/overview/Today.tsx';

/**
 * "O bot está bem? O que precisa de mim?" A tela não tem permissão própria: cada seção aparece só
 * para quem pode ler a API dela, e uma que falha mostra o próprio erro sem derrubar as outras.
 */
export function Overview() {
  const { can } = useSession();
  const canAi = can('config.read');
  const canAudit = can('audit.read');
  return (
    <section className="flex flex-col gap-6">
      <PageTitle>Visão geral</PageTitle>
      {can('connection.read') && <ConnectionLine />}
      <Attention />
      {can('metrics.read') && <Today />}
      {(canAi || canAudit) && (
        <div className="grid gap-6 md:grid-cols-2">
          {canAi && <ChainSummary />}
          {canAudit && <RecentAudit />}
        </div>
      )}
    </section>
  );
}
