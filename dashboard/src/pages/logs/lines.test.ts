import { describe, expect, it } from 'vitest';
import {
  asLogLine,
  countByLevel,
  eventsByPlugin,
  filtersFromSearch,
  filtersToSearch,
  type LogLine,
  matches,
  mergeLines,
  pluginsIn,
  type Stream,
  streamReducer,
} from './lines.ts';

const line = (
  time: number,
  level: LogLine['level'],
  message: string,
  fields: LogLine['fields'] = {},
): LogLine => ({ time, level, message, fields });

const SAMPLE = [
  line(5, 'error', 'falhou', { plugin: 'download', event: 'download.media.failed' }),
  line(4, 'warn', 'cota', { plugin: 'web-search' }),
  line(3, 'info', 'ok', { plugin: 'download', event: 'download.media.done' }),
  line(2, 'info', 'ok de novo', { plugin: 'download', event: 'download.media.done' }),
  line(1, 'debug', 'ruído', { plugin: 'luma' }),
];

describe('filtros na URL', () => {
  it('ida e volta, e a URL limpa é a tela sem filtro', () => {
    const filters = {
      level: 'warn',
      plugins: ['ai', 'luma'],
      query: 'x y',
      event: 'a.b.c',
    } as const;
    expect(filtersFromSearch(filtersToSearch(filters))).toEqual(filters);
    expect(filtersToSearch(filtersFromSearch(new URLSearchParams())).toString()).toBe('');
  });

  it('nível inválido ou fora do segmentado cai no padrão', () => {
    expect(filtersFromSearch(new URLSearchParams('nivel=banana')).level).toBe('info');
    expect(filtersFromSearch(new URLSearchParams('nivel=fatal')).level).toBe('info');
    expect(filtersFromSearch(new URLSearchParams('nivel=trace')).level).toBe('info');
  });
});

describe('matches', () => {
  const base = { level: 'info', plugins: [], query: '', event: '' } as const;

  it('nível mínimo, plugin, evento exato e busca por evento ou texto', () => {
    const times = (f: Partial<Record<keyof typeof base, unknown>>) =>
      SAMPLE.filter((l) => matches(l, { ...base, ...f } as typeof base)).map((l) => l.time);
    expect(times({})).toEqual([5, 4, 3, 2]);
    expect(times({ level: 'error' })).toEqual([5]);
    expect(times({ plugins: ['web-search', 'luma'], level: 'debug' })).toEqual([4, 1]);
    expect(times({ event: 'download.media.done' })).toEqual([3, 2]);
    expect(times({ query: 'MEDIA.FAILED' })).toEqual([5]);
    expect(times({ query: 'novo' })).toEqual([2]);
  });
});

describe('mergeLines', () => {
  it('junta sem repetir e ordena da mais nova para a mais antiga', () => {
    const [a, , c, , e] = SAMPLE as [LogLine, LogLine, LogLine, LogLine, LogLine];
    expect(mergeLines([a, c], [c, e]).map((l) => l.time)).toEqual([5, 3, 1]);
  });
});

describe('teto do buffer', () => {
  it('mergeLines não passa de 1.000 linhas e guarda as mais novas', () => {
    const many = Array.from({ length: 1200 }, (_, i) => line(i, 'info', `m${i}`));
    const merged = mergeLines(many);
    expect(merged).toHaveLength(1000);
    expect(merged[0]?.time).toBe(1199);
  });
});

describe('contagens', () => {
  it('conta cada nível para cima', () => {
    const counts = countByLevel(SAMPLE);
    expect(counts.debug).toBe(5);
    expect(counts.info).toBe(4);
    expect(counts.warn).toBe(2);
    expect(counts.error).toBe(1);
  });

  it('plugins em ordem e eventos por plugin, com o texto livre vazio', () => {
    expect(pluginsIn(SAMPLE)).toEqual(['download', 'luma', 'web-search']);
    expect(eventsByPlugin(SAMPLE)).toEqual([
      {
        plugin: 'download',
        events: [
          { event: 'download.media.done', count: 2 },
          { event: 'download.media.failed', count: 1 },
        ],
      },
      { plugin: 'luma', events: [] },
      { plugin: 'web-search', events: [] },
    ]);
  });
});

describe('asLogLine', () => {
  it('aceita o formato do stream e descarta o resto', () => {
    expect(asLogLine({ level: 'info', time: 1, message: 'a', fields: {} })).not.toBeNull();
    expect(asLogLine({ level: 'ruim', time: 1, message: 'a', fields: {} })).toBeNull();
    expect(asLogLine({ level: 'info', time: '1', message: 'a', fields: {} })).toBeNull();
    expect(asLogLine('texto')).toBeNull();
    expect(asLogLine(null)).toBeNull();
  });
});

describe('streamReducer', () => {
  const empty: Stream = { live: [], pending: [], paused: false };
  const feed = (state: Stream, count: number, from = 0): Stream => {
    let current = state;
    for (let n = 0; n < count; n++) {
      current = streamReducer(current, {
        type: 'line',
        line: line(from + n, 'info', `m${from + n}`),
      });
    }
    return current;
  };

  it('ao vivo, 1.005 linhas deixam 1.000 e a mais nova primeiro', () => {
    const state = feed(empty, 1005);
    expect(state.live).toHaveLength(1000);
    expect(state.live[0]?.time).toBe(1004);
    expect(state.pending).toHaveLength(0);
  });

  it('pausado, o que chega vai para pending (teto de 1.000) e live não muda', () => {
    const paused = streamReducer(feed(empty, 3), { type: 'toggle' });
    const state = feed(paused, 1005, 100);
    expect(state.live).toHaveLength(3);
    expect(state.pending).toHaveLength(1000);
  });

  it('retomar junta pending e live respeitando o teto', () => {
    const paused = streamReducer(feed(empty, 500), { type: 'toggle' });
    const resumed = streamReducer(feed(paused, 800, 1000), { type: 'toggle' });
    expect(resumed.paused).toBe(false);
    expect(resumed.pending).toHaveLength(0);
    expect(resumed.live).toHaveLength(1000);
    expect(resumed.live[0]?.time).toBe(1799);
  });
});
