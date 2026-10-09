import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import * as bot from './bot.ts';
import * as main from './index.ts';

const run = promisify(execFile);

describe('entry /bot', () => {
  it('exporta o mesmo que o entry principal', () => {
    expect(Object.keys(bot).sort()).toEqual(Object.keys(main).sort());
  });

  it('não carrega o vitest', async () => {
    // Processo próprio: aqui o vitest já está carregado. O hook falha a resolução de qualquer
    // import do vitest no grafo do entry.
    const entry = fileURLToPath(new URL('./bot.ts', import.meta.url));
    const script = `
      import { registerHooks } from 'node:module';
      import { pathToFileURL } from 'node:url';
      registerHooks({
        resolve(specifier, context, next) {
          if (specifier === 'vitest' || specifier.startsWith('vitest/')) {
            throw new Error('o entry carregou o vitest via ' + context.parentURL);
          }
          return next(specifier, context);
        },
      });
      const { createTestBot } = await import(pathToFileURL(${JSON.stringify(entry)}).href);
      const bot = await createTestBot();
      await bot.stop();
    `;
    const args = ['--conditions=@zapforge/source', '--input-type=module', '-e', script];
    await expect(run(process.execPath, args)).resolves.toBeDefined();
  });
});
