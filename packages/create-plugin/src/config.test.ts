import { expect, it } from 'vitest';
import { detectPackageManager } from './config.ts';

it.each([
  ['pnpm/12.9.1 npm/? node/v24.1.0 win32 x64', 'pnpm'],
  ['npm/11.0.0 node/v24.1.0 linux x64 workspaces/false', 'npm'],
  ['yarn/4.5.0 npm/? node/v24.1.0 darwin arm64', 'yarn'],
  ['bun/1.2.0 npm/? node/v24.1.0 linux x64', 'bun'],
  ['deno/2.0.0', 'npm'],
  ['', 'npm'],
] as const)('%j → %s', (userAgent, expected) => {
  expect(detectPackageManager(userAgent)).toBe(expected);
});
