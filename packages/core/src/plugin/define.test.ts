import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assertPluginDefinition,
  definePlugin,
  manifestIssues,
  PluginManifestError,
} from './define.ts';

const valid = {
  name: 'sticker',
  version: '1.2.0',
  engine: '^1.0.0',
  setup: () => undefined,
};

describe('definePlugin', () => {
  it('devolve a própria definição quando o manifesto é válido', () => {
    const definition = {
      ...valid,
      requires: ['media.download', 'send.sticker'] as const,
      transports: ['baileys'],
      dependsOn: { 'user-names': '^1.0.0' },
      after: ['logger-extra'],
      priority: 10,
      config: z.object({ quality: z.number().default(80) }),
      messages: { needMedia: 'Mande uma imagem' },
      teardown: () => undefined,
    };
    expect(definePlugin(definition)).toBe(definition);
  });

  it('lança PluginManifestError listando todos os problemas', () => {
    const error = (() => {
      try {
        definePlugin({
          name: 'Sticker Bot',
          version: '1.2',
          engine: 'latest',
          setup: () => undefined,
        });
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(PluginManifestError);
    const manifestError = error as PluginManifestError;
    expect(manifestError.plugin).toBe('Sticker Bot');
    expect(manifestError.issues).toHaveLength(3);
    expect(manifestError.message).toMatch(/name deve ser kebab-case/);
    expect(manifestError.message).toMatch(/version deve ser semver/);
    expect(manifestError.message).toMatch(/engine é obrigatório/);
  });
});

describe('manifestIssues', () => {
  it.each([
    ['nome com maiúscula', { name: 'Sticker' }, /name deve ser kebab-case/],
    ['nome com underscore', { name: 'user_names' }, /name deve ser kebab-case/],
    ['nome começando com número', { name: '1plugin' }, /name deve ser kebab-case/],
    ['nome longo demais', { name: `a${'-b'.repeat(40)}` }, /passa de 64/],
    ['sem engine', { engine: undefined }, /engine é obrigatório/],
    [
      'capability desconhecida',
      { requires: ['send.hologram'] },
      /capability desconhecida "send.hologram"/,
    ],
    ['requires que não é lista', { requires: 'groups' }, /requires deve ser uma lista/],
    ['transports vazio', { transports: [] }, /transports, se presente/],
    ['dependsOn com faixa inválida', { dependsOn: { ai: 'qualquer' } }, /dependsOn\["ai"\]/],
    ['dependsOn com nome inválido', { dependsOn: { AI: '^1.0.0' } }, /dependsOn: nome/],
    ['dependsOn em si mesmo', { dependsOn: { sticker: '^1.0.0' } }, /próprio plugin/],
    ['after em si mesmo', { after: ['sticker'] }, /after não pode citar o próprio/],
    ['priority infinita', { priority: Number.POSITIVE_INFINITY }, /priority/],
    ['config que não é Zod', { config: { quality: 80 } }, /schema Zod/],
    ['messages com valor não texto', { messages: { a: 1 } }, /messages/],
    ['sem setup', { setup: undefined }, /setup deve ser uma função/],
    ['teardown não função', { teardown: 'x' }, /teardown/],
  ])('%s', (_, patch, pattern) => {
    const issues = manifestIssues({ ...valid, ...patch });
    expect(issues.join('\n')).toMatch(pattern);
  });

  it('recusa quem não é objeto', () => {
    expect(manifestIssues(null)).toEqual(['o plugin deve ser um objeto (use definePlugin)']);
  });

  it('não acusa nada num manifesto mínimo válido', () => {
    expect(manifestIssues(valid)).toEqual([]);
  });
});

describe('assertPluginDefinition', () => {
  it('inclui a origem na mensagem', () => {
    expect(() =>
      assertPluginDefinition({ ...valid, version: 'x' }, '/app/plugins/sticker.ts'),
    ).toThrow(/plugin "sticker" \(\/app\/plugins\/sticker\.ts\)/);
  });
});
