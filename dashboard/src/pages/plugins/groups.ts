import type { Schemas } from '#lib/api.ts';

type Plugin = Schemas['Plugin'];

export const GROUP_ORDER = ['Conversa', 'Mídia', 'Utilidades', 'Sistema'] as const;
export type PluginGroup = (typeof GROUP_ORDER)[number];

// O agrupamento é só da tela: a API não tem esse conceito. Plugin fora do mapa cai em Sistema.
const GROUP_OF: Readonly<Record<string, PluginGroup>> = {
  luma: 'Conversa',
  ai: 'Conversa',
  resumo: 'Conversa',
  spontaneous: 'Conversa',
  download: 'Mídia',
  pdf: 'Mídia',
  sticker: 'Mídia',
  'sticker-convert': 'Mídia',
  'sticker-text': 'Mídia',
  transcribe: 'Mídia',
  help: 'Utilidades',
  ping: 'Utilidades',
  rank: 'Utilidades',
  reminders: 'Utilidades',
  'user-names': 'Utilidades',
  utils: 'Utilidades',
  'web-search': 'Utilidades',
};

export const groupOf = (name: string): PluginGroup => GROUP_OF[name] ?? 'Sistema';

/** Grupos na ordem do guia, só os que têm plugin; plugins por nome dentro de cada um. */
export function groupPlugins(
  plugins: readonly Plugin[],
): { name: PluginGroup; plugins: Plugin[] }[] {
  return GROUP_ORDER.map((name) => ({
    name,
    plugins: plugins
      .filter((p) => groupOf(p.name) === name)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.plugins.length > 0);
}

export interface PluginState {
  on: boolean;
  /** Só o estado fora do normal aparece em texto. */
  word?: { tone: 'warn' | 'danger'; text: string };
  detail?: string;
  /** Observação neutra (sem cor de estado), como "desligado: depende de X". */
  note?: string;
}

export function stateOf(plugin: Plugin): PluginState {
  if (plugin.status === 'loaded') {
    const warned = (plugin.unregistered ?? []).length > 0;
    return warned ? { on: true, word: { tone: 'warn', text: 'com avisos' } } : { on: true };
  }
  if (plugin.reason?.kind === 'disabled') return { on: false };
  // Pulado porque uma dependência está desligada: efeito do desligamento, não falha deste plugin.
  if (plugin.reason?.kind === 'dependency-skipped') {
    return { on: false, note: `desligado: ${plugin.reason.message}` };
  }
  return {
    on: false,
    word: { tone: 'danger', text: 'falhou no boot' },
    ...(plugin.reason !== undefined && { detail: plugin.reason.message }),
  };
}
