import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '../../../src/infra/Container.js';

describe('Container — register', () => {
  it('registra um token com uma factory', () => {
    const c = new Container();
    c.register('svc', () => ({ value: 42 }));
    expect(c.has('svc')).toBe(true);
  });

  it('retorna this para encadeamento fluente', () => {
    const c = new Container();
    const result = c.register('a', () => 1);
    expect(result).toBe(c);
  });

  it('permite encadear múltiplos registers', () => {
    const c = new Container();
    c.register('a', () => 1).register('b', () => 2).register('c', () => 3);
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(true);
    expect(c.has('c')).toBe(true);
  });

  it('lança TypeError se factory não for função', () => {
    const c = new Container();
    expect(() => c.register('token', 'não é função')).toThrow(TypeError);
    expect(() => c.register('token', 'não é função')).toThrow('"token"');
  });

  it('sobrescreve registro anterior do mesmo token', () => {
    const c = new Container();
    c.register('svc', () => 'primeira');
    c.register('svc', () => 'segunda');
    expect(c.get('svc')).toBe('segunda');
  });
});

describe('Container — resolve / get', () => {
  it('resolve e retorna a instância criada pela factory', () => {
    const c = new Container();
    c.register('num', () => 99);
    expect(c.get('num')).toBe(99);
    expect(c.resolve('num')).toBe(99);
  });

  it('lança Error para token não registrado', () => {
    const c = new Container();
    expect(() => c.get('desconhecido')).toThrow('[Container] Token não registrado: "desconhecido"');
  });

  it('passa o container como argumento para a factory', () => {
    const c = new Container();
    c.register('dep', () => 'dependência');
    c.register('svc', (container) => ({ dep: container.get('dep') }));

    const svc = c.get('svc');
    expect(svc.dep).toBe('dependência');
  });
});

describe('Container — singleton (padrão)', () => {
  it('chama a factory apenas uma vez para singletons', () => {
    const c = new Container();
    const factory = vi.fn(() => ({ id: Math.random() }));
    c.register('svc', factory);

    const first  = c.get('svc');
    const second = c.get('svc');

    expect(factory).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('cria instância nova a cada resolve quando singleton=false', () => {
    const c = new Container();
    const factory = vi.fn(() => ({ id: Math.random() }));
    c.register('svc', factory, { singleton: false });

    const first  = c.get('svc');
    const second = c.get('svc');

    expect(factory).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
  });
});

describe('Container — clearSingletons', () => {
  it('força nova criação na próxima resolução', () => {
    const c = new Container();
    let count = 0;
    c.register('svc', () => ({ n: ++count }));

    const first = c.get('svc');
    expect(first.n).toBe(1);

    c.clearSingletons();
    const second = c.get('svc');
    expect(second.n).toBe(2);
    expect(first).not.toBe(second);
  });

  it('não remove o registro — apenas o cache singleton', () => {
    const c = new Container();
    c.register('svc', () => 'ok');
    c.get('svc');
    c.clearSingletons();

    expect(c.has('svc')).toBe(true);
    expect(() => c.get('svc')).not.toThrow();
  });
});

describe('Container — has', () => {
  it('retorna false para token não registrado', () => {
    const c = new Container();
    expect(c.has('qualquer')).toBe(false);
  });

  it('retorna true após registro', () => {
    const c = new Container();
    c.register('token', () => null);
    expect(c.has('token')).toBe(true);
  });

  it('não resolve a factory ao verificar', () => {
    const c = new Container();
    const factory = vi.fn(() => 'valor');
    c.register('svc', factory);
    c.has('svc');
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('Container — registeredTokens', () => {
  it('retorna lista vazia quando nada registrado', () => {
    const c = new Container();
    expect(c.registeredTokens()).toEqual([]);
  });

  it('retorna todos os tokens registrados', () => {
    const c = new Container();
    c.register('a', () => 1).register('b', () => 2);
    expect(c.registeredTokens()).toContain('a');
    expect(c.registeredTokens()).toContain('b');
  });
});

describe('Container — resolução de grafo de dependências', () => {
  it('resolve grafo com múltiplas camadas', () => {
    const c = new Container();
    c.register('config',  ()  => ({ key: 'valor' }));
    c.register('repo',    (c) => ({ config: c.get('config') }));
    c.register('service', (c) => ({ repo: c.get('repo') }));

    const svc = c.get('service');
    expect(svc.repo.config.key).toBe('valor');
  });

  it('singletons em grafo — mesma instância de dep compartilhada', () => {
    const c = new Container();
    c.register('shared', () => ({ id: 1 }));
    c.register('svc1', (c) => ({ shared: c.get('shared') }));
    c.register('svc2', (c) => ({ shared: c.get('shared') }));

    expect(c.get('svc1').shared).toBe(c.get('svc2').shared);
  });
});
