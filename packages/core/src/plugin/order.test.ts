import { describe, expect, it } from 'vitest';
import { type OrderableManifest, PluginCycleError, sortPlugins } from './order.ts';

const names = (plugins: readonly OrderableManifest[]): string[] =>
  sortPlugins(plugins).map((p) => p.name);

describe('sortPlugins', () => {
  it('sem arestas nem prioridade, mantém a ordem de declaração', () => {
    expect(names([{ name: 'c' }, { name: 'a' }, { name: 'b' }])).toEqual(['c', 'a', 'b']);
  });

  it('priority maior carrega antes; empate fica na ordem de declaração', () => {
    expect(
      names([
        { name: 'a' },
        { name: 'b', priority: 5 },
        { name: 'c', priority: -1 },
        { name: 'd', priority: 5 },
      ]),
    ).toEqual(['b', 'd', 'a', 'c']);
  });

  it('dependsOn vence priority: a dependência carrega antes', () => {
    expect(
      names([{ name: 'resumo', priority: 100, dependsOn: { ai: '^1.0.0' } }, { name: 'ai' }]),
    ).toEqual(['ai', 'resumo']);
  });

  it('after ordena sem exigir que o outro exista', () => {
    expect(names([{ name: 'b', after: ['a', 'fantasma'] }, { name: 'a' }])).toEqual(['a', 'b']);
  });

  it('dependência ausente não cria aresta', () => {
    expect(names([{ name: 'resumo', dependsOn: { ai: '^1.0.0' } }])).toEqual(['resumo']);
  });

  it('entre os prontos, prioridade decide mesmo depois de liberar dependentes', () => {
    // c depende de a; quando a sai, c (priority 1) passa na frente de b (priority 0).
    expect(
      names([
        { name: 'a', priority: 10 },
        { name: 'b' },
        { name: 'c', priority: 1, dependsOn: { a: '*' } },
      ]),
    ).toEqual(['a', 'c', 'b']);
  });

  it('cadeia longa respeita todas as arestas', () => {
    expect(
      names([
        { name: 'd', dependsOn: { c: '*' } },
        { name: 'c', after: ['b'] },
        { name: 'b', dependsOn: { a: '*' } },
        { name: 'a' },
      ]),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ciclo lança PluginCycleError com o caminho', () => {
    const plugins: OrderableManifest[] = [
      { name: 'ok' },
      { name: 'a', dependsOn: { b: '*' } },
      { name: 'b', after: ['c'] },
      { name: 'c', dependsOn: { a: '*' } },
    ];
    expect(() => sortPlugins(plugins)).toThrow(PluginCycleError);
    try {
      sortPlugins(plugins);
    } catch (error) {
      expect((error as PluginCycleError).cycle).toEqual(['a', 'b', 'c', 'a']);
      expect((error as Error).message).toContain('a → b → c → a');
    }
  });

  it('ciclo de dois via after também é erro', () => {
    expect(() =>
      sortPlugins([
        { name: 'x', after: ['y'] },
        { name: 'y', after: ['x'] },
      ]),
    ).toThrow(/x → y → x/);
  });
});
