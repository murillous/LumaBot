import type { Schemas } from '#lib/api.ts';

export type LogLine = Schemas['LogLine'];
export type Level = LogLine['level'];

/** Do menos ao mais grave: a posição é o que `nível mínimo` compara. */
export const LEVELS: readonly Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

/** Níveis oferecidos no segmentado; `trace` quase nunca chega ao buffer e `fatal` conta em `error`. */
export const LEVEL_OPTIONS: readonly Level[] = ['debug', 'info', 'warn', 'error'];

export const DEFAULT_LEVEL: Level = 'info';

/** O buffer de linhas do core (docs/api.md, "Logs": as últimas 1000 por bot). */
export const BUFFER_LINES = 1000;

const rank = (level: Level): number => LEVELS.indexOf(level);

export const atLeast = (line: LogLine, level: Level): boolean => rank(line.level) >= rank(level);

const isLevel = (value: string | null): value is Level =>
  value !== null && (LEVELS as readonly string[]).includes(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

export const pluginOf = (line: LogLine): string | undefined => text(line.fields['plugin']);
export const eventOf = (line: LogLine): string | undefined => text(line.fields['event']);

export interface Filters {
  level: Level;
  plugins: readonly string[];
  /** Busca por trecho do evento ou da mensagem. */
  query: string;
  /** Evento exato ("Só este evento"). */
  event: string;
}

/** Filtros da query string; valor ausente ou inválido cai no padrão. */
export function filtersFromSearch(params: URLSearchParams): Filters {
  const level = params.get('nivel');
  return {
    level: isLevel(level) ? level : DEFAULT_LEVEL,
    plugins: (params.get('plugins') ?? '').split(',').filter((name) => name !== ''),
    query: params.get('q') ?? '',
    event: params.get('evento') ?? '',
  };
}

/** Só grava o que difere do padrão, para a URL limpa continuar sendo a tela sem filtro. */
export function filtersToSearch(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.level !== DEFAULT_LEVEL) params.set('nivel', filters.level);
  if (filters.plugins.length > 0) params.set('plugins', filters.plugins.join(','));
  if (filters.query !== '') params.set('q', filters.query);
  if (filters.event !== '') params.set('evento', filters.event);
  return params;
}

export function matches(line: LogLine, filters: Filters): boolean {
  if (!atLeast(line, filters.level)) return false;
  if (filters.plugins.length > 0 && !filters.plugins.includes(pluginOf(line) ?? '')) return false;
  if (filters.event !== '' && eventOf(line) !== filters.event) return false;
  const query = filters.query.trim().toLowerCase();
  if (query === '') return true;
  return `${eventOf(line) ?? ''} ${line.message}`.toLowerCase().includes(query);
}

/** Identidade de uma linha: o log não tem id, e o stream pode repetir o que o histórico trouxe. */
export const lineKey = (line: LogLine): string =>
  `${line.time}|${line.level}|${line.message}|${JSON.stringify(line.fields)}`;

/** Une as listas sem repetir linha, da mais nova para a mais antiga. */
export function mergeLines(...lists: readonly (readonly LogLine[])[]): LogLine[] {
  const seen = new Set<string>();
  const merged: LogLine[] = [];
  for (const list of lists) {
    for (const line of list) {
      const key = lineKey(line);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(line);
    }
  }
  return merged.sort((a, b) => b.time - a.time);
}

/** Quantas linhas há de cada nível para cima: "warn 12" inclui `error` e `fatal`. */
export function countByLevel(lines: readonly LogLine[]): Record<Level, number> {
  const counts = Object.fromEntries(LEVELS.map((level) => [level, 0])) as Record<Level, number>;
  for (const line of lines) {
    for (const level of LEVELS) if (atLeast(line, level)) counts[level] += 1;
  }
  return counts;
}

/** Plugins que aparecem nas linhas, em ordem alfabética. */
export function pluginsIn(lines: readonly LogLine[]): string[] {
  const names = new Set<string>();
  for (const line of lines) {
    const name = pluginOf(line);
    if (name !== undefined) names.add(name);
  }
  return [...names].sort();
}

export interface PluginEvents {
  plugin: string;
  events: { event: string; count: number }[];
}

/**
 * Os eventos de cada plugin nas linhas e a contagem. Sai só do que as linhas trazem: o plugin que
 * ainda loga em texto livre fica com a lista vazia.
 */
export function eventsByPlugin(lines: readonly LogLine[]): PluginEvents[] {
  const byPlugin = new Map<string, Map<string, number>>();
  for (const name of pluginsIn(lines)) byPlugin.set(name, new Map());
  for (const line of lines) {
    const plugin = pluginOf(line);
    const event = eventOf(line);
    if (plugin === undefined || event === undefined) continue;
    const counts = byPlugin.get(plugin);
    counts?.set(event, (counts.get(event) ?? 0) + 1);
  }
  return [...byPlugin.entries()].map(([plugin, counts]) => ({
    plugin,
    events: [...counts.entries()]
      .map(([event, count]) => ({ event, count }))
      .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event)),
  }));
}

/** O que o stream manda no evento `log`; qualquer outra coisa é descartada. */
export function asLogLine(data: unknown): LogLine | null {
  if (typeof data !== 'object' || data === null) return null;
  const { level, time, message, fields } = data as Record<string, unknown>;
  if (typeof level !== 'string' || !isLevel(level)) return null;
  if (typeof time !== 'number' || typeof message !== 'string') return null;
  if (typeof fields !== 'object' || fields === null) return null;
  return { level, time, message, fields: fields as LogLine['fields'] };
}

export const formatTime = (time: number): string =>
  new Date(time).toLocaleTimeString('pt-BR', { hour12: false });
