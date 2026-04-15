import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginManager } from '../../../src/plugins/PluginManager.js';

// Plugin stub para testes
class FooPlugin {
  static commands = ['!foo', '!bar'];
  onCommand = vi.fn();
  onMessage = vi.fn();
  onStart   = vi.fn();
  onStop    = vi.fn();
}

class BazPlugin {
  static commands = ['!baz'];
  onCommand = vi.fn();
}

function makeBot(overrides = {}) {
  return {
    jid: '123@s.whatsapp.net',
    body: '',
    isGroup: false,
    ...overrides,
  };
}

describe('PluginManager.register', () => {
  it('registra um plugin e indexa seus comandos', () => {
    const pm  = new PluginManager();
    const foo = new FooPlugin();
    pm.register(foo);

    expect(pm.size).toBe(1);
    expect(pm.getPluginForCommand('!foo')).toBe(foo);
    expect(pm.getPluginForCommand('!bar')).toBe(foo);
  });

  it('retorna this para encadeamento fluente', () => {
    const pm = new PluginManager();
    expect(pm.register(new FooPlugin())).toBe(pm);
  });

  it('registra múltiplos plugins sem conflito', () => {
    const pm  = new PluginManager();
    const foo = new FooPlugin();
    const baz = new BazPlugin();
    pm.register(foo).register(baz);

    expect(pm.size).toBe(2);
    expect(pm.getPluginForCommand('!baz')).toBe(baz);
  });

  it('retorna null para comando não registrado', () => {
    const pm = new PluginManager();
    expect(pm.getPluginForCommand('!unknown')).toBeNull();
  });
});

describe('PluginManager.dispatch — com comando', () => {
  it('chama onCommand do plugin dono do comando e retorna true', async () => {
    const pm  = new PluginManager();
    const foo = new FooPlugin();
    pm.register(foo);

    const bot     = makeBot();
    const handled = await pm.dispatch('!foo', bot);

    expect(handled).toBe(true);
    expect(foo.onCommand).toHaveBeenCalledWith('!foo', bot);
    expect(foo.onMessage).not.toHaveBeenCalled();
  });

  it('não chama onMessage quando há comando', async () => {
    const pm  = new PluginManager();
    const foo = new FooPlugin();
    pm.register(foo);

    await pm.dispatch('!foo', makeBot());
    expect(foo.onMessage).not.toHaveBeenCalled();
  });

  it('retorna false para comando sem plugin dono', async () => {
    const pm      = new PluginManager();
    pm.register(new FooPlugin());
    const handled = await pm.dispatch('!naoexiste', makeBot());
    expect(handled).toBe(false);
  });
});

describe('PluginManager.dispatch — sem comando (onMessage)', () => {
  it('chama onMessage em todos os plugins quando não há comando', async () => {
    const pm  = new PluginManager();
    const foo = new FooPlugin();
    const baz = new BazPlugin();
    baz.onMessage = vi.fn();
    pm.register(foo).register(baz);

    const bot = makeBot();
    await pm.dispatch(null, bot);

    expect(foo.onMessage).toHaveBeenCalledWith(bot);
    expect(baz.onMessage).toHaveBeenCalledWith(bot);
  });

  it('ignora plugins sem onMessage sem lançar erro', async () => {
    const pm     = new PluginManager();
    const simple = { constructor: { commands: ['!x'] }, onCommand: vi.fn() };
    pm.register(simple);
    await expect(pm.dispatch(null, makeBot())).resolves.not.toThrow();
  });

  it('retorna false quando não há comando', async () => {
    const pm  = new PluginManager();
    pm.register(new FooPlugin());
    const handled = await pm.dispatch(null, makeBot());
    expect(handled).toBe(false);
  });
});

describe('PluginManager.startAll / stopAll', () => {
  it('chama onStart em todos os plugins com o hook', async () => {
    const pm  = new PluginManager();
    const foo = new FooPlugin();
    pm.register(foo);

    await pm.startAll();
    expect(foo.onStart).toHaveBeenCalledOnce();
  });

  it('chama onStop em todos os plugins com o hook', async () => {
    const pm  = new PluginManager();
    const foo = new FooPlugin();
    pm.register(foo);

    await pm.stopAll();
    expect(foo.onStop).toHaveBeenCalledOnce();
  });

  it('ignora plugins sem onStart/onStop sem lançar erro', async () => {
    const pm     = new PluginManager();
    const simple = { constructor: { commands: [] } };
    pm.register(simple);
    await expect(pm.startAll()).resolves.not.toThrow();
    await expect(pm.stopAll()).resolves.not.toThrow();
  });
});
