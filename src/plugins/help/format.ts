// Formatação pura do menu: sem @usebridger/*, testável sozinha.

export interface HelpCommand {
  /** Título do bloco do menu onde o comando entra. */
  readonly group: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
}

export interface HelpSectionOutput {
  readonly title: string;
  readonly lines: readonly string[];
}

/** Comandos agrupados por `group` (na ordem em que chegam) e depois as seções, uma por bloco. */
export function formatMenu(input: {
  readonly title: string;
  readonly prefix: string;
  readonly commands: readonly HelpCommand[];
  readonly sections: readonly HelpSectionOutput[];
}): string {
  const groups = new Map<string, string[]>();
  for (const { group, name, aliases, description } of input.commands) {
    const alias = aliases.length
      ? ` (${aliases.map((a) => `${input.prefix}${a}`).join(', ')})`
      : '';
    const lines = groups.get(group) ?? [];
    lines.push(`• *${input.prefix}${name}*${alias} - ${description}`);
    groups.set(group, lines);
  }
  const blocks = [
    ...[...groups].map(([title, lines]) => ({ title, lines })),
    ...input.sections,
  ].map(({ title, lines }) => `*${title}*\n${lines.join('\n')}`);
  return [input.title, ...blocks].join('\n\n');
}
