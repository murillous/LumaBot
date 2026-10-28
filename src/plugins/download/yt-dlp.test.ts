import { execFile } from 'node:child_process';
import { beforeEach, expect, it, vi } from 'vitest';
import { compactVideo, downloadAudio, downloadVideo, TooLargeError } from './yt-dlp.ts';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

type Callback = (err: Error | null, stdout: string, stderr: string) => void;
const signal = new AbortController().signal;

/** Cada chamada ao `execFile` responde com o próximo resultado da lista. */
function processes(...results: { stdout?: string; stderr?: string; fail?: boolean }[]) {
  for (const { stdout = '', stderr = '', fail = false } of results) {
    vi.mocked(execFile).mockImplementationOnce(((...args: unknown[]) => {
      const callback = args.at(-1) as Callback;
      callback(fail ? new Error('exit 1') : null, stdout, stderr);
    }) as unknown as typeof execFile);
  }
}

function argsOf(call: number): string[] {
  return vi.mocked(execFile).mock.calls[call]?.[1] as string[];
}

beforeEach(() => {
  vi.mocked(execFile).mockReset();
});

it('baixa só de site conhecido, com teto de tamanho, e devolve o caminho impresso', async () => {
  processes({ stdout: '/tmp/x/media.mp4\r\n' });

  const file = await downloadVideo('https://x.com/a', '/tmp/x', { signal });

  expect(file).toBe('/tmp/x/media.mp4');
  const args = argsOf(0);
  expect(vi.mocked(execFile).mock.calls[0]?.[0]).toBe('yt-dlp');
  expect(args.join(' ')).toContain('--use-extractors default,-generic');
  expect(args.join(' ')).toContain('--max-filesize 100M');
  // O link vem depois do `--`: um "link" começando com `-` não vira opção do yt-dlp.
  expect(args.slice(-2)).toEqual(['--', 'https://x.com/a']);
  expect(args).not.toContain('--cookies');
});

it('repassa o arquivo de cookies', async () => {
  processes({ stdout: '/tmp/x/a.mp3\n' });

  await downloadAudio('https://youtu.be/a', '/tmp/x', { cookies: '/srv/c.txt', signal });

  expect(argsOf(0).join(' ')).toContain('--cookies /srv/c.txt');
});

it('saída limpa sem caminho é arquivo acima do teto', async () => {
  processes({ stdout: '' });

  await expect(downloadVideo('https://x.com/a', '/tmp/x', { signal })).rejects.toBeInstanceOf(
    TooLargeError,
  );
});

it('erro do yt-dlp traz o stderr', async () => {
  processes({ fail: true, stderr: 'ERROR: Private video' });

  await expect(downloadVideo('https://x.com/a', '/tmp/x', { signal })).rejects.toThrow(
    'yt-dlp falhou: ERROR: Private video',
  );
});

it('sem libx264, a recodificação cai na cópia do codec', async () => {
  processes({ fail: true, stderr: 'Unknown encoder libx264' }, {});

  await compactVideo('/tmp/x/in.webm', '/tmp/x', signal);

  expect(argsOf(0)).toContain('libx264');
  expect(argsOf(1).join(' ')).toContain('-c:v copy');
});
