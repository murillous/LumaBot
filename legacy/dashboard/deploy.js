import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { pushLog } from './logger.js';
import { botManager } from './botManager.js';

/**
 * Auto-deploy disparado por webhook do GitHub: git pull, instala dependências
 * se necessário, builda o dashboard e reinicia.
 */

const DEPLOY_DEBOUNCE_MS = 5000;
let deployDebounceTimer = null;

/** Verifica a assinatura HMAC do webhook (usa req.rawBody). */
export function verifyGitHubSignature(req) {
  const signature = req.headers['x-hub-signature-256'] || '';
  const expected  = 'sha256=' + crypto
    .createHmac('sha256', config.DEPLOY_SECRET)
    .update(req.rawBody)
    .digest('hex');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  try {
    return crypto.timingSafeEqual(expBuf, sigBuf);
  } catch {
    return false;
  }
}

function runDeploy() {
  pushLog('🚀 Deploy iniciado (push na main)...', 'info');
  try {
    pushLog('📥 Executando git pull...', 'info');
    execSync('git pull origin main', { cwd: config.ROOT_DIR, timeout: 60000 });

    // Arquivos alterados pelo pull (HEAD@{1} = estado anterior). Em caso de
    // falha (reflog ausente), assume que tudo mudou para não pular nenhum build.
    let changed = '';
    try {
      changed = execSync('git diff --name-only HEAD@{1} HEAD', { cwd: config.ROOT_DIR }).toString();
    } catch {
      changed = 'package.json dashboard/web/package.json';
    }

    if (/(^|\/)package(-lock)?\.json/m.test(changed)) {
      pushLog('📦 Instalando dependências do bot...', 'info');
      execSync('npm install --omit=dev --no-audit', { cwd: config.ROOT_DIR, timeout: 180000 });
    }

    // Dashboard React (Vite): instala devDeps (necessárias ao build) e regenera
    // o dist. O dist não é versionado, então precisa ser buildado no servidor.
    if (fs.existsSync(path.join(config.WEB_DIR, 'package.json'))) {
      const webDepsChanged = /dashboard\/web\/package(-lock)?\.json/.test(changed);
      const needsInstall = webDepsChanged || !fs.existsSync(path.join(config.WEB_DIR, 'node_modules'));
      if (needsInstall) {
        pushLog('📦 Instalando dependências do dashboard...', 'info');
        execSync('npm ci --no-audit', { cwd: config.WEB_DIR, timeout: 300000 });
      }
      pushLog('🏗️ Buildando o dashboard...', 'info');
      execSync('npm run build', { cwd: config.WEB_DIR, timeout: 300000 });
    }

    pushLog('✅ Deploy concluído.', 'success');

    if (config.IS_SUPERVISED) {
      // Reinicia o processo inteiro: carrega o novo server.js, serve o dist
      // recém-buildado e o backend sobe com o código novo. O supervisor respawna.
      pushLog('🔄 Reiniciando o dashboard para aplicar as mudanças...', 'warn');
      setTimeout(() => process.exit(0), 1500);
    } else {
      // Sem supervisor não podemos reiniciar a nós mesmos com segurança.
      // O backend é reiniciado; o painel exige restart manual do processo.
      botManager.restart();
      pushLog('⚠️ Backend reiniciado. Rode o dashboard sob pm2/systemd para que o painel também atualize sozinho (veja ecosystem.config.cjs).', 'warn');
    }
  } catch (error) {
    pushLog(`❌ Deploy falhou: ${error.message}`, 'error');
  }
}

/** Agenda o deploy com debounce — pushes em rajada disparam um único deploy. */
export function scheduleDeploy() {
  clearTimeout(deployDebounceTimer);
  deployDebounceTimer = setTimeout(runDeploy, DEPLOY_DEBOUNCE_MS);
}
