import { Table } from '#components/Table.tsx';
import type { PluginEvents } from './lines.ts';

/**
 * Os eventos que cada plugin emitiu nas linhas carregadas. Não há lista de eventos aqui: a tabela
 * se preenche conforme os plugins passam a logar por `log.event`.
 */
export function EventsByPlugin({ rows }: { rows: readonly PluginEvents[] }) {
  return (
    <section aria-labelledby="eventos-por-plugin" className="flex flex-col gap-2">
      <h2 id="eventos-por-plugin" className="font-display text-sub font-semibold">
        Eventos por plugin
      </h2>
      <p className="text-help text-muted">
        Plugin sem eventos ainda loga em texto livre, sem filtro por ação.
      </p>
      {rows.length === 0 ? (
        <p className="text-muted">Nenhum plugin nas linhas carregadas.</p>
      ) : (
        <Table label="Eventos por plugin">
          <thead>
            <tr>
              <th scope="col">Plugin</th>
              <th scope="col">Eventos nas linhas carregadas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ plugin, events }) => (
              <tr key={plugin} className="align-top">
                <td className="font-mono text-label">{plugin}</td>
                <td>
                  {events.length === 0 ? (
                    <span className="text-muted">só texto livre</span>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {events.map(({ event, count }) => (
                        <li key={event} className="flex gap-3 font-mono text-label">
                          <span>{event}</span>
                          <span className="text-muted">{count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
