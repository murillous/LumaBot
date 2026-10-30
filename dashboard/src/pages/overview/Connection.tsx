import { useQueryClient } from '@tanstack/react-query';
import { useLiveEvent } from '#components/context.tsx';
import { StateWord, type Tone } from '#components/StateWord.tsx';
import type { Schemas } from '#lib/api.ts';
import { useConnection } from './queries.ts';
import { Remote } from './Remote.tsx';

type Connection = Schemas['Connection'];

const KEY = ['overview', 'connection'];

const STATUS: Record<Connection['status'], { tone: Tone; word: string }> = {
  open: { tone: 'ok', word: 'conectado' },
  connecting: { tone: 'warn', word: 'conectando' },
  closed: { tone: 'danger', word: 'desconectado' },
};

function isStatusEvent(data: unknown): data is Pick<Connection, 'status' | 'reason'> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'status' in data &&
    typeof data.status === 'string' &&
    data.status in STATUS
  );
}

/** Conexão do WhatsApp numa linha; o evento `connection.status` atualiza sem esperar nova leitura. */
export function ConnectionLine() {
  const client = useQueryClient();
  const query = useConnection();

  useLiveEvent('connection.status', (data) => {
    if (!isStatusEvent(data)) return;
    // Troca já o estado e o motivo; a releitura traz conta e desde quando, que o evento não carrega.
    client.setQueryData<Connection>(KEY, (old) => {
      if (old === undefined) return old;
      const { reason: _previous, ...rest } = old;
      return { ...rest, status: data.status, ...(data.reason && { reason: data.reason }) };
    });
    void client.invalidateQueries({ queryKey: KEY });
  });

  return (
    <Remote query={query}>
      {(connection) => {
        const { tone, word } = STATUS[connection.status];
        const who = connection.account?.name ?? connection.account?.phone;
        return (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">WhatsApp</span>
            <StateWord tone={tone}>{word}</StateWord>
            {connection.status === 'open' && who && <span className="text-muted">{who}</span>}
            {connection.status !== 'open' && connection.reason && (
              <span className="font-mono text-label text-muted">{connection.reason}</span>
            )}
          </p>
        );
      }}
    </Remote>
  );
}
