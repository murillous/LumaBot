import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

/**
 * Supervisor mínimo do dashboard.
 *
 * Mantém `npm run dashboard` como único comando: este launcher sobe o
 * dashboard/server.js e o reinicia automaticamente quando ele sai. Assim o
 * auto-deploy pode aplicar mudanças no próprio server.js (e servir o dist
 * recém-buildado) saindo com código 0 — o launcher respawna com o código novo.
 *
 * - Saída com código 0  → reinício solicitado (deploy): respawn imediato.
 * - Saída com erro      → respawn com backoff exponencial.
 * - SIGTERM / SIGINT    → encerra o launcher e o filho (parada manual).
 *
 * Para persistência no boot da máquina, rode sob pm2/systemd (opcional).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "server.js");
const ROOT = path.join(__dirname, "..");

let child = null;
let failures = 0;
let stopping = false;

function run() {
  child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    stdio: "inherit",
    // Sinaliza ao server que ele roda sob supervisor — pode se reiniciar no deploy.
    env: { ...process.env, LUMA_SUPERVISED: "1" },
  });

  child.on("exit", (code, signal) => {
    child = null;
    // Parada por sinal — operador ou launcher encerrando. No Windows isso chega
    // como código >= 128 (128 + nº do sinal) em vez de `signal`. Não respawna.
    const killedBySignal = stopping || !!signal || (typeof code === "number" && code >= 128);
    if (killedBySignal) {
      process.exit(0);
    }
    if (code === 0) {
      failures = 0;
      console.log("[launch] Reinício solicitado pelo deploy — subindo a nova versão...");
      setTimeout(run, 600);
    } else {
      const delay = Math.min(2000 * ++failures, 30000);
      console.error(`[launch] Dashboard saiu (código ${code}). Reiniciando em ${delay / 1000}s...`);
      setTimeout(run, delay);
    }
  });
}

function shutdown() {
  stopping = true;
  if (child) {
    try { child.kill("SIGTERM"); } catch { /* já encerrado */ }
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

run();
