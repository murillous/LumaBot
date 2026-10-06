// Configuração do PM2 para rodar o LumaBot em produção.
//
// O dashboard (dashboard/server.js) é o processo principal: ele sobe o servidor
// web e spawna o bot (index.js) como processo filho. Rodar sob PM2 permite que
// o auto-deploy (/api/deploy) reinicie o próprio dashboard ao receber um push na
// main — assim mudanças no backend E no painel são aplicadas sem tocar no servidor.
//
// Uso:
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup   (para iniciar no boot da máquina)
//   pm2 logs luma             (acompanhar logs)

module.exports = {
  apps: [
    {
      name: "luma",
      script: "dashboard/server.js",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 2000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production",
        // Marca o processo como supervisionado: no auto-deploy o server sai com
        // código 0 e o PM2 respawna com o código novo (back + painel).
        LUMA_SUPERVISED: "1",
      },
    },
    {
      // Tunnel independente — sobrevive aos restarts do dashboard, mantendo a
      // mesma URL enquanto o processo não for reiniciado manualmente.
      // Ative com: pm2 start ecosystem.config.cjs --only luma-tunnel
      // (só necessário se CLOUDFLARE_TUNNEL=true no .env)
      name: "luma-tunnel",
      script: "dashboard/tunnel.js",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
