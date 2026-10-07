import { describe, expect, it } from 'vitest';
import { createRoleRegistry, RoleConflictError } from './roles.ts';

const yes = () => true;

describe('createRoleRegistry', () => {
  it('registra e acha o papel com o plugin dono', () => {
    const roles = createRoleRegistry();
    roles.define('moderacao', 'moderador', yes);
    expect(roles.find('moderador')).toEqual({ plugin: 'moderacao', name: 'moderador', check: yes });
    expect(roles.find('outro')).toBeUndefined();
  });

  it.each(['owner', 'group-admin', 'everyone'])('recusa o nome reservado %s', (name) => {
    const roles = createRoleRegistry();
    expect(() => roles.define('p', name, yes)).toThrow(TypeError);
    expect(roles.find(name)).toBeUndefined();
  });

  it.each(['', 'a b'])('recusa nome inválido %j', (name) => {
    expect(() => createRoleRegistry().define('p', name, yes)).toThrow(TypeError);
  });

  it('conflito cita os dois plugins e mantém o primeiro', () => {
    const roles = createRoleRegistry();
    roles.define('moderacao', 'moderador', yes);
    const define = () => roles.define('rival', 'moderador', () => false);
    expect(define).toThrow(RoleConflictError);
    expect(define).toThrow(/"rival".*"moderacao".*dependsOn/);
    expect(roles.find('moderador')?.plugin).toBe('moderacao');
    // O mesmo plugin, duas vezes, também é conflito.
    expect(() => roles.define('moderacao', 'moderador', yes)).toThrow(RoleConflictError);
  });

  it('removePlugin tira só os papéis do plugin', () => {
    const roles = createRoleRegistry();
    roles.define('a', 'x', yes);
    roles.define('a', 'y', yes);
    roles.define('b', 'z', yes);

    roles.removePlugin('a');

    expect(roles.find('x')).toBeUndefined();
    expect(roles.find('y')).toBeUndefined();
    expect(roles.find('z')?.plugin).toBe('b');
    expect(() => roles.define('a', 'x', yes)).not.toThrow();
  });
});
