import { describe, expect, it } from 'vitest';
import { cooldownRefetch } from './ai-state.ts';

describe('cooldownRefetch', () => {
  it('relê a cada 5 s com algum modelo em cooldown', () => {
    const models = [
      { model: 'a', state: 'ready' as const },
      { model: 'b', state: 'cooldown' as const },
    ];
    expect(cooldownRefetch({ models })).toBe(5000);
  });

  it('não relê com todos prontos', () => {
    expect(cooldownRefetch({ models: [{ model: 'a', state: 'ready' }] })).toBe(false);
  });

  it('não relê sem dado', () => {
    expect(cooldownRefetch()).toBe(false);
  });
});
