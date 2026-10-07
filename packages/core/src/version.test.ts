import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { CORE_VERSION } from './version.ts';

it('CORE_VERSION acompanha a versão do package.json', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  expect(CORE_VERSION).toBe(manifest.version);
});
