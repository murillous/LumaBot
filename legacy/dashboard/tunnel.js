import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

dotenv.config({ path: resolve(ROOT, '.env') });

const PORT     = process.env.DASHBOARD_PORT || '3000';
const URL_FILE = resolve(ROOT, 'data', 'tunnel-url.txt');

try { mkdirSync(resolve(ROOT, 'data'), { recursive: true }); } catch {}

const child = spawn(
  'cloudflared',
  ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

function onData(buf) {
  const text = buf.toString();
  process.stdout.write(text);
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match) {
    try { writeFileSync(URL_FILE, match[0], 'utf-8'); } catch {}
    console.log(`\n🌐 Acesso externo: ${match[0]}\n`);
  }
}

child.stdout.on('data', onData);
child.stderr.on('data', onData);

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error(err.message.includes('ENOENT')
    ? '❌ cloudflared não encontrado no PATH.'
    : `Erro no tunnel: ${err.message}`);
  process.exit(1);
});

process.on('SIGTERM', () => { try { child.kill('SIGTERM'); } catch {} });
process.on('SIGINT',  () => { try { child.kill('SIGINT');  } catch {} });
