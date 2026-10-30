import { StateWord, type Tone } from '#components/StateWord.tsx';
import { ExpandRow, Table } from '#components/Table.tsx';
import { Button } from '#components/ui.tsx';
import { eventOf, formatTime, type Level, type LogLine, lineKey, pluginOf } from './lines.ts';

const TONES: Partial<Record<Level, Tone>> = {
  info: 'info',
  warn: 'warn',
  error: 'danger',
  fatal: 'danger',
};

/** Nível em palavra colorida; `debug` e `trace` são ruído de fundo e ficam em `--muted`. */
function LevelWord({ level }: { level: Level }) {
  const tone = TONES[level];
  if (tone === undefined) return <span className="text-muted">{level}</span>;
  return <StateWord tone={tone}>{level}</StateWord>;
}

function Detail({ line, onSameEvent }: { line: LogLine; onSameEvent: (event: string) => void }) {
  const event = eventOf(line);
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3 pl-2">
      <pre className="m-0 min-w-0 flex-[1_1_320px] whitespace-pre-wrap break-words font-mono text-label text-ink2">
        {JSON.stringify(line.fields, null, 2)}
      </pre>
      {event !== undefined && <Button onClick={() => onSameEvent(event)}>Só este evento</Button>}
    </div>
  );
}

export function LogTable({
  lines,
  expanded,
  onToggle,
  onSameEvent,
}: {
  lines: readonly LogLine[];
  expanded: string | null;
  onToggle: (key: string) => void;
  onSameEvent: (event: string) => void;
}) {
  return (
    <Table label="Linhas de log">
      <thead>
        <tr>
          <th scope="col">Hora</th>
          <th scope="col">Nível</th>
          <th scope="col">Plugin</th>
          <th scope="col">Evento</th>
          <th scope="col">Mensagem</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const key = lineKey(line);
          const event = eventOf(line);
          return (
            <ExpandRow
              key={key}
              expanded={expanded === key}
              onToggle={() => onToggle(key)}
              detail={<Detail line={line} onSameEvent={onSameEvent} />}
              cells={[
                <span key="t" className="font-mono text-label text-muted">
                  {formatTime(line.time)}
                </span>,
                <LevelWord key="l" level={line.level} />,
                <span key="p" className="font-mono text-label">
                  {pluginOf(line) ?? <span className="text-muted">—</span>}
                </span>,
                event === undefined ? (
                  <span key="e" className="text-muted">
                    texto livre
                  </span>
                ) : (
                  <span key="e" className="font-mono text-label">
                    {event}
                  </span>
                ),
                <span key="m">{line.message}</span>,
              ]}
            />
          );
        })}
      </tbody>
    </Table>
  );
}
