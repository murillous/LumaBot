import { execFile } from 'node:child_process';

/**
 * Confere no `setup` que um binário do sistema roda. Sem a checagem, a falta só aparece no
 * primeiro comando que o usa, como um erro de conversão no chat.
 */
export function checkBinary(command: string, versionArgs: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, versionArgs, { timeout: 10_000 }, (err) => {
      if (err)
        reject(new Error(`\`${command}\` não roda; instale-o e deixe-o no PATH`, { cause: err }));
      else resolve();
    });
  });
}
