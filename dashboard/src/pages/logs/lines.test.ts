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

  it('nível inválido cai no padrão', () => {
    expect(filtersFromSearch(new URLSearchParams('nivel=banana')).level).toBe('info');
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
