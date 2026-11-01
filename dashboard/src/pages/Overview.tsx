import { useSession } from '#components/context.tsx';
import { PageTitle } from '#components/PageTitle.tsx';
import { Attention } from '#pages/overview/Attention.tsx';
import { ChainSummary } from '#pages/overview/Chain.tsx';
import { ConnectionLine } from '#pages/overview/Connection.tsx';
import { RecentChanges } from '#pages/overview/Recent.tsx';
import { Today } from '#pages/overview/Today.tsx';

/**
 * "O bot está bem? O que precisa de mim?" A tela não tem permissão própria: cada seção aparece só
 * para quem pode ler a API dela, e uma que falha mostra o próprio erro sem derrubar as outras.
 */
export function Overview() {
  const { can } = useSession();
  return (
    <section className="flex flex-col gap-6">
      <PageTitle>Visão geral</PageTitle>
      {can('connection.read') && <ConnectionLine />}
      <Attention />
      {can('metrics.read') && <Today />}
      {can('config.read') && <ChainSummary />}
      {can('audit.read') && <RecentChanges />}
    </section>
  );
}
