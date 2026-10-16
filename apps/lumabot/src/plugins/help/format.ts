// Formatação pura do menu: sem @usebridger/*, testável sozinha.

export interface HelpCommand {
  readonly plugin: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
}

export interface HelpSectionOutput {
  readonly title: string;
  readonly lines: readonly string[];
}

/** Comandos agrupados por plugin (ordem de registro) e depois as seções, uma por bloco. */
export function formatMenu(input: {
  readonly title: string;
  readonly prefix: string;
  readonly commands: readonly HelpCommand[];
  readonly sections: readonly HelpSectionOutput[];
}): string {
  const groups = new Map<string, string[]>();
  for (const { plugin, name, aliases, description } of input.commands) {
    const names = [name, ...aliases].map((n) => `${input.prefix}${n}`).join(', ');
    const lines = groups.get(plugin) ?? [];
    lines.push(`${names}: ${description}`);
    groups.set(plugin, lines);
  }
  const blocks = [
    ...[...groups].map(([plugin, lines]) => ({ title: plugin, lines })),
    ...input.sections,
  ].map(({ title, lines }) => `*${title}*\n${lines.join('\n')}`);
  return [input.title, ...blocks].join('\n\n');
}
