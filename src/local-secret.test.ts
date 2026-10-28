import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localSecret } from './local-secret.ts';

const tempDir = () => mkdtemp(join(tmpdir(), 'lumabot-secret-'));

describe('localSecret', () => {
  it('sem arquivo, gera os bytes em base64 e grava 0600, criando o diretório', async () => {
    const path = join(await tempDir(), 'data', 'secret.key');
    const secret = await localSecret(path, 32);
    expect(secret.created).toBe(true);
    expect(Buffer.from(secret.value, 'base64')).toHaveLength(32);
    expect((await readFile(path, 'utf8')).trim()).toBe(secret.value);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('com arquivo, devolve o valor salvo sem gerar outro', async () => {
    const path = join(await tempDir(), 'secret.key');
    const first = await localSecret(path, 32);
    expect(await localSecret(path, 32)).toEqual({ value: first.value, created: false });
  });

  it('ignora espaço e quebra de linha em volta do valor salvo à mão', async () => {
    const path = join(await tempDir(), 'token');
    await writeFile(path, '  meu-token\n');
    expect((await localSecret(path, 24)).value).toBe('meu-token');
  });

  it('erro de leitura que não é arquivo ausente é relançado, sem gerar valor novo', async () => {
    const path = join(await tempDir(), 'secret.key');
    await mkdir(path);
    await expect(localSecret(path, 32)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
