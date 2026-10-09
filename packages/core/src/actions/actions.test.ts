import { describe, expect, it } from 'vitest';
import { bold, fmt, plainText } from '#text/format.ts';
import {
  ACTION_TTL_MS,
  ActionRegistry,
  type ActionTarget,
  MAX_STORED_ACTIONS,
  numberedMenu,
  pickChoice,
} from './actions.ts';

const target: ActionTarget = { kind: 'command', label: 'Notas', command: 'notas', args: [] };

describe('ActionRegistry', () => {
  it('devolve IDs aleatórios de 16 caracteres base64url, que cabem no callback_data', () => {
    const registry = new ActionRegistry();
    const ids = new Set(Array.from({ length: 50 }, () => registry.register('c', target)));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it('resolve o alvo só no chat em que o botão foi enviado', () => {
    const registry = new ActionRegistry();
    const id = registry.register('chat-a', target);
    expect(registry.resolve(id, 'chat-a')).toBe(target);
    expect(registry.resolve(id, 'chat-b')).toBeUndefined();
    expect(registry.resolve('forjado', 'chat-a')).toBeUndefined();
  });

  it('o botão vale 24 horas e pode ser clicado mais de uma vez', () => {
    let now = 1_000;
    const registry = new ActionRegistry(() => now);
    const id = registry.register('c', target);
    now += ACTION_TTL_MS - 1;
    expect(registry.resolve(id, 'c')).toBe(target);
    expect(registry.resolve(id, 'c')).toBe(target);
    now += 1;
    expect(registry.resolve(id, 'c')).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it('descarta os vencidos quando entram IDs novos, sem timer', () => {
    let now = 0;
    const registry = new ActionRegistry(() => now);
    registry.register('c', target);
    registry.register('c', target);
    now = ACTION_TTL_MS;
    registry.register('c', target);
    expect(registry.size).toBe(1);
  });

  it('guarda no máximo MAX_STORED_ACTIONS, descartando os mais antigos', () => {
    const registry = new ActionRegistry(() => 0);
    const first = registry.register('c', target);
    const second = registry.register('c', target);
    for (let i = 2; i < MAX_STORED_ACTIONS; i++) registry.register('c', target);
    expect(registry.size).toBe(MAX_STORED_ACTIONS);
    registry.register('c', target);
    expect(registry.size).toBe(MAX_STORED_ACTIONS);
    expect(registry.resolve(first, 'c')).toBeUndefined();
    expect(registry.resolve(second, 'c')).toBe(target);
  });

  it('clear descarta tudo', () => {
    const registry = new ActionRegistry();
    const id = registry.register('c', target);
    registry.clear();
    expect(registry.resolve(id, 'c')).toBeUndefined();
  });
});

describe('numberedMenu', () => {
  it('acrescenta a lista numerada ao texto cru', () => {
    expect(numberedMenu('Escolha:', ['Notas', 'Faltas'])).toBe('Escolha:\n\n1. Notas\n2. Faltas');
  });

  it('na árvore, mantém a marcação e trata o rótulo como texto literal', () => {
    const menu = numberedMenu(fmt`Aluno ${bold('Maria')}`, ['*Notas*']);
    expect(typeof menu).not.toBe('string');
    expect(plainText(menu)).toBe('Aluno Maria\n\n1. *Notas*');
  });
});

describe('pickChoice', () => {
  it('aceita só um número da lista, com espaços em volta', () => {
    expect(pickChoice('1', 2)).toBe(0);
    expect(pickChoice(' 2 \n', 2)).toBe(1);
    expect(pickChoice('3', 2)).toBeNull();
    expect(pickChoice('0', 2)).toBeNull();
    expect(pickChoice('1.', 2)).toBeNull();
    expect(pickChoice('um', 2)).toBeNull();
    expect(pickChoice('', 2)).toBeNull();
    expect(pickChoice(null, 2)).toBeNull();
  });
});
