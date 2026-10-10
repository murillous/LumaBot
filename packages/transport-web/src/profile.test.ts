// O perfil `web` do kit de testes promete as capabilities e os limites deste transport (ADR 0073,
// 0077). Se um dos dois mudar sem o outro, o plugin testado no perfil passa e falha no web real.

import { createLogger, type Transport } from '@zapforge/core';
import { PROFILES } from '@zapforge/testing/bot';
import { describe, expect, it } from 'vitest';
import { createVerifier } from './jwt.ts';
import { WebTransport } from './transport.ts';

describe('WebTransport: perfil web do kit', () => {
  it('declara as mesmas capabilities e limites do perfil', () => {
    const auth = { secret: 'segredo-de-teste-com-pelo-menos-32-bytes' };
    const transport: Transport = new WebTransport(
      { auth },
      createVerifier(auth),
      { basePath: '/transports/web', route: () => undefined, ws: () => undefined },
      createLogger({ level: 'silent' }),
    );
    expect([...transport.capabilities].sort()).toEqual([...PROFILES.web.capabilities].sort());
    expect(transport.limits).toEqual(PROFILES.web.limits);
  });
});
