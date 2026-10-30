// @vitest-environment node
import { CORE_PERMISSIONS } from '@usebridger/core';
import { expect, it } from 'vitest';
import { OWNER } from './test-support.tsx';

// O fixture é escrito à mão (o core puxa o servidor, que não cabe no bundle): este teste o
// mantém igual ao que o core concede ao owner.
it('OWNER tem todas as CORE_PERMISSIONS', () => {
  expect([...OWNER.permissions].sort()).toEqual([...CORE_PERMISSIONS].sort());
});
