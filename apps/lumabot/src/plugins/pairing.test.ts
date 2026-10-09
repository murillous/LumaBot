import { createTestBot } from '@zapforge/testing';
import { expect, it } from 'vitest';
import { pairing } from './pairing.ts';

it('desenha o QR recebido do transport', async () => {
  const output: string[] = [];
  const bot = await createTestBot({ plugins: [pairing((text) => output.push(text))] });

  await bot.emit('connection.qr', { qr: '2@abc,def,ghi' });

  expect(output).toHaveLength(1);
  expect(output[0]).toContain('Conectar aparelho');
  // O QR em blocos do qrcode-terminal (modo small).
  expect(output[0]).toMatch(/[▀▄█]/);
  await bot.stop();
});

it('mostra o código de pareamento com a instrução de onde digitá-lo', async () => {
  const output: string[] = [];
  const bot = await createTestBot({ plugins: [pairing((text) => output.push(text))] });

  await bot.emit('connection.pairing-code', { code: 'ABCD1234' });

  expect(output).toEqual([expect.stringContaining('ABCD1234')]);
  expect(output[0]).toContain('Conectar com número de telefone');
  await bot.stop();
});
