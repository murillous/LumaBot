// O perfil `whatsapp` do kit de testes promete as capabilities e os limites do Baileys (ADR 0073).
// Se um dos dois mudar sem o outro, o plugin testado no perfil passa e falha no transport real.

import { createLogger, createMemoryStorage, type Transport } from '@zapforge/core';
import { PROFILES } from '@zapforge/testing/bot';
import { describe, expect, it } from 'vitest';
import { FakeDriver } from './fake-socket.test-support.ts';
import { BaileysTransport } from './transport.ts';

describe('BaileysTransport: perfil whatsapp do kit', () => {
  it('declara as mesmas capabilities e limites do perfil', () => {
    // Pelo contrato: o Baileys não declara `limits`, e o perfil também não pode ter.
    const transport: Transport = new BaileysTransport(
      { pairing: 'qr', driver: new FakeDriver() },
      {
        session: 'default',
        auth: createMemoryStorage().authState('default'),
        log: createLogger({ level: 'silent' }),
      },
    );
    expect([...transport.capabilities].sort()).toEqual([...PROFILES.whatsapp.capabilities].sort());
    expect(transport.limits).toEqual(PROFILES.whatsapp.limits);
  });
});
