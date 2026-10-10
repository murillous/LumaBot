// Manifesto com `commands` e `on` (ADR 0079). Quem escreve em JS não tem o compilador: a
// validação do `definePlugin` e do boot é o que aponta o erro.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { requiredCapabilities } from './declared.ts';
import { manifestIssues } from './define.ts';
import { discoverPlugins } from './sources.ts';
import type { PluginDefinition } from './types.ts';

const base = { name: 'p', version: '1.0.0', engine: '*' };
const run = (): number => 1;

describe('manifestIssues: commands e on', () => {
  it.each([
    ['só commands, sem setup', { commands: { ping: { run: () => 'pong' } } }],
    ['só on, sem setup', { on: { message: () => undefined } }],
    ['evento de tipo de mensagem', { on: { 'message:image': () => undefined } }],
    ['tudo junto', { commands: {}, on: {}, setup: () => undefined }],
  ])('aceita %s', (_, patch) => {
    expect(manifestIssues({ ...base, ...patch })).toEqual([]);
  });

  it.each([
    ['nada declarado', {}, /setup deve ser uma função/],
    ['commands que não é objeto', { commands: [] }, /commands deve ser um objeto/],
    ['comando sem run', { commands: { ping: {} } }, /commands\["ping"\]\.run deve ser/],
    ['comando que não é objeto', { commands: { ping: 'pong' } }, /commands\["ping"\] deve ser/],
    ['comando com name', { commands: { ping: { name: 'pong', run } } }, /o nome vem da chave/],
    ['nome com espaço', { commands: { 'p q': { run } } }, /commands\["p q"\]: Nome/],
    [
      'aliases que não é lista',
      { commands: { ping: { aliases: 'p', run } } },
      /aliases deve ser uma lista/,
    ],
    ['prazo inválido', { commands: { ping: { timeoutMs: 0, run } } }, /commands\["ping"\]: Prazo/],
    ['onReject que não é função', { commands: { ping: { onReject: 'não', run } } }, /onReject/],
    ['on que não é objeto', { on: () => undefined }, /on deve ser um objeto/],
    [
      'evento com erro de digitação',
      { on: { mesage: () => undefined } },
      /evento desconhecido "mesage"/,
    ],
    [
      'interaction não é evento de plugin',
      { on: { interaction: () => undefined } },
      /desconhecido/,
    ],
    ['listener que não é função', { on: { message: 'oi' } }, /on\["message"\] deve ser/],
    ['setup que não é função', { commands: {}, setup: 'x' }, /setup deve ser uma função/],
  ])('recusa %s', (_, patch, pattern) => {
    expect(manifestIssues({ ...base, ...patch }).join('\n')).toMatch(pattern);
  });
});

describe('requiredCapabilities', () => {
  const plugin = (patch: Partial<PluginDefinition>): PluginDefinition => ({
    ...base,
    setup: () => undefined,
    ...patch,
  });

  it('acrescenta send.text a quem declara comandos, sem repetir', () => {
    expect(requiredCapabilities(plugin({ commands: { a: { run: () => 'a' } } }))).toEqual([
      'send.text',
    ]);
    expect(
      requiredCapabilities(plugin({ requires: ['groups'], commands: { a: { run: () => 'a' } } })),
    ).toEqual(['groups', 'send.text']);
    expect(
      requiredCapabilities(
        plugin({ requires: ['send.text'], commands: { a: { run: () => 'a' } } }),
      ),
    ).toEqual(['send.text']);
  });

  it('não deduz nada sem comandos declarados', () => {
    expect(requiredCapabilities(plugin({ commands: {} }))).toEqual([]);
    expect(requiredCapabilities(plugin({ requires: ['groups'] }))).toEqual(['groups']);
  });
});

describe('discoverPlugins: plugin em JS só declarativo', () => {
  it('acha o objeto puro com commands, sem setup e sem importar o core', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zapforge-declared-'));
    try {
      mkdirSync(join(root, 'plugins'));
      writeFileSync(
        join(root, 'plugins', 'ping.mjs'),
        "export const ping = { name: 'ping', version: '1.0.0', engine: '*', commands: { ping: { run: () => 'pong' } } };\n" +
          "export const eco = { name: 'eco', version: '1.0.0', engine: '*', on: { message: () => {} } };\n",
      );
      const found = await discoverPlugins(join(root, 'plugins'));
      expect(found.map((entry) => entry.definition.name).sort()).toEqual(['eco', 'ping']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
