import { expect, it } from 'vitest';
import { checkBinary } from './binary.ts';

it('resolve quando o binário roda', async () => {
  await expect(checkBinary('node', ['--version'])).resolves.toBeUndefined();
});

it('rejeita com o nome do binário quando ele não existe', async () => {
  await expect(checkBinary('lumabot-binario-inexistente', ['--version'])).rejects.toThrow(
    '`lumabot-binario-inexistente` não roda; instale-o e deixe-o no PATH',
  );
});
