// Segredos que o app gera sozinho no primeiro boot (token do primeiro acesso, chave mestra), para o
// LumaBot subir com o .env vazio e o resto da config vir pelo dashboard (ADR 0006).

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface LocalSecret {
  readonly value: string;
  /** `true` quando o arquivo acabou de ser criado: o chamador mostra o valor uma única vez. */
  readonly created: boolean;
}

/**
 * Lê o segredo de `path` ou, se o arquivo não existe, gera `bytes` aleatórios em base64 e grava
 * com permissão 0600. Outro erro de leitura (permissão, diretório no lugar do arquivo) é relançado:
 * gerar outro valor por cima perderia os segredos cifrados com o antigo.
 */
export async function localSecret(path: string, bytes: number): Promise<LocalSecret> {
  try {
    return { value: (await readFile(path, 'utf8')).trim(), created: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const value = randomBytes(bytes).toString('base64');
  await mkdir(dirname(path), { recursive: true });
  // `wx`: se outro processo criou o arquivo entre a leitura e aqui, falha em vez de sobrescrever.
  await writeFile(path, `${value}\n`, { mode: 0o600, flag: 'wx' });
  return { value, created: true };
}
