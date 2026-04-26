# LumaBot — Guia de Produção

## Visão Geral

Este guia cobre o deploy seguro e eficiente do LumaBot em produção usando Docker, Docker Compose e Nginx.

## Pré-requisitos

- Docker 20.10+
- Docker Compose 2.0+
- Um domínio com DNS configurado (opcional, para HTTPS)
- Acesso SSH ao servidor

## Estrutura de Arquivos

```
.
├── Dockerfile              # Imagem de produção (multi-stage otimizada)
├── Dockerfile.dev          # Imagem de desenvolvimento com live-reload
├── docker/
│   ├── docker-entrypoint.sh # Script de entrada seguro
│   ├── compose.prod.yml     # Orquestração de produção (Nginx + Bot)
│   ├── compose.dev.yml      # Orquestração de desenvolvimento
│   ├── nginx/
│   │   ├── nginx.conf       # Configuração principal do Nginx
│   │   └── conf.d/
│   │       └── default.conf # Virtual host do LumaBot
│   └── ssl/                 # Certificados SSL (opcional)
├── .env.production.example  # Template de variáveis para produção
└── docs/07-Producao.md      # Este arquivo
```

## Setup de Produção

### 1. Preparar o Servidor

```bash
ssh user@seu-servidor.com
cd /opt/lumabot

git clone https://github.com/murillous/LumaBot.git .
```

### 2. Configurar Variáveis de Ambiente

```bash
cp .env.example .env
nano .env
```

Preencha as chaves obrigatórias:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=seu_api_key_aqui
OWNER_NUMBER=5511999999999
DASHBOARD_PASSWORD=senha_segura_aqui
LOG_LEVEL=info
```

### 3. Iniciar em Produção

#### Sem HTTPS (apenas HTTP interno)

```bash
docker-compose -f docker/compose.prod.yml up -d
docker-compose -f docker/compose.prod.yml logs -f app
```

#### Com HTTPS (recomendado)

Se você tem um domínio e quer HTTPS:

```bash
mkdir -p docker/ssl

# Gere certificados SSL (Let's Encrypt com Certbot)
certbot certonly --standalone -d seu-dominio.com

# Copie os certificados
cp /etc/letsencrypt/live/seu-dominio.com/fullchain.pem docker/ssl/
cp /etc/letsencrypt/live/seu-dominio.com/privkey.pem docker/ssl/
chmod 644 docker/ssl/*.pem

# Atualize docker/nginx/conf.d/default.conf com HTTPS (veja seção abaixo)
```

### 4. Verificar Status

```bash
docker-compose -f docker/compose.prod.yml ps

docker-compose -f docker/compose.prod.yml exec app curl http://localhost:3000/health

docker-compose -f docker/compose.prod.yml logs --follow
```

## Configuração HTTPS

Atualize `docker/nginx/conf.d/default.conf` com redirecionamento SSL:

```nginx
server {
  listen 80;
  server_name seu-dominio.com;

  location /.well-known/acme-challenge {
    root /var/www/certbot;
  }

  location / {
    return 301 https://$server_name$request_uri;
  }
}

server {
  listen 443 ssl http2;
  server_name seu-dominio.com;

  ssl_certificate /etc/nginx/ssl/fullchain.pem;
  ssl_certificate_key /etc/nginx/ssl/privkey.pem;

  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;
  ssl_prefer_server_ciphers on;

  client_max_body_size 50M;

  location / {
    proxy_pass http://app:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    proxy_buffering off;
    proxy_request_buffering off;
  }
}
```

## Gerenciamento de Volumes e Dados

### Volumes Persistentes

Os dados são armazenados em volumes Docker nomeados:

- `auth_data` → `/app/auth_info` (credenciais WhatsApp)
- `bot_data` → `/app/data` (banco de dados SQLite)

Nunca delete esses volumes em produção!

```bash
# Listar volumes
docker volume ls

# Inspecionar um volume
docker volume inspect luma-bot_auth_data

# Backup de dados
docker run --rm -v luma-bot_bot_data:/data -v $(pwd)/backups:/backup \
  busybox tar czf /backup/bot-data-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
```

## Monitoramento e Manutenção

### Health Checks

Nginx verifica se o bot está saudável a cada 30 segundos:

```bash
curl http://localhost/health
```

Resposta esperada:

```json
{
  "status": "running",
  "timestamp": 1704067200000,
  "uptime": 3600000
}
```

Se retornar `503`, o bot não está respondendo — verifique os logs:

```bash
docker-compose -f docker/compose.prod.yml logs app | tail -50
```

### Logs

Os logs são armazenados em JSON:

```bash
# Últimas 100 linhas
docker-compose -f docker/compose.prod.yml logs --tail 100 app

# Seguir logs em tempo real
docker-compose -f docker/compose.prod.yml logs -f app

# Logs do Nginx
docker-compose -f docker/compose.prod.yml logs -f nginx
```

### Reiniciar o Bot

```bash
docker-compose -f docker/compose.prod.yml restart app
```

### Atualizar Código

```bash
git pull origin main
docker-compose -f docker/compose.prod.yml build --no-cache
docker-compose -f docker/compose.prod.yml up -d app
```

## Troubleshooting

### Bot não conecta ao WhatsApp

```bash
# Remover credenciais e escaneei QR novamente
docker volume rm luma-bot_auth_data
docker-compose -f docker/compose.prod.yml restart app

# Verificar se WhatsApp bloqueou a sessão
docker-compose -f docker/compose.prod.yml logs app | grep -i "blocked\|logout\|auth"
```

### Dashboard não abre

1. Verificar se Nginx está rodando: `docker-compose -f docker/compose.prod.yml ps`
2. Verificar health do bot: `curl http://localhost/health`
3. Ver logs: `docker-compose -f docker/compose.prod.yml logs nginx`

### Memória insuficiente

Aumente os limites no `docker/compose.prod.yml`:

```yaml
app:
  deploy:
    resources:
      limits:
        memory: 1G
```

## Backup e Restore

### Criar Backup

```bash
docker-compose -f docker/compose.prod.yml exec app tar czf - /app/data /app/auth_info > backup-$(date +%Y%m%d).tar.gz
```

### Restaurar Backup

```bash
tar xzf backup-20240101.tar.gz -C /

docker-compose -f docker/compose.prod.yml restart app
```

## Segurança

✅ **Implementado:**
- Usuário não-root (node)
- Health checks
- HTTPS (com certificados válidos)
- Rate limiting (Nginx)
- Gzip compression
- Cache de assets
- Logs estruturados
- Senha no dashboard

⚠️ **Recomendações Adicionais:**
- Usar fail2ban para proteção contra brute force
- Configurar firewall (iptables/ufw)
- Monitorar uso de recursos (Prometheus/Grafana)
- Fazer backup regular dos volumes
- Manter Docker e dependências atualizadas

## Performance

### Otimizações Implementadas

- **Multi-stage build** → Imagem final ~500MB
- **Node.js production mode** → Melhor performance
- **Gzip compression** → 60-80% redução de bandwidth
- **Cache de assets** → 30 dias
- **Connection pooling** → Menos overhead de conexão
- **Dumb-init** → Melhor shutdown gracioso

### Benchmarks

- **Startup:** ~5s
- **Memoria:** ~180MB (idle), ~300MB (sob carga)
- **CPU:** <5% (idle), ~20% (processando)
- **Latência HTTP:** <50ms

## Checklist de Deploy

- [ ] `.env` configurado com chaves válidas
- [ ] `DASHBOARD_PASSWORD` definida (não usar padrão)
- [ ] Certificados SSL copiados para `docker/ssl/` (se usando HTTPS)
- [ ] Volumes Docker criados: `docker volume ls`
- [ ] Containers rodando: `docker-compose -f docker/compose.prod.yml ps`
- [ ] Health check OK: `curl http://localhost/health`
- [ ] Logs sem erros: `docker-compose -f docker/compose.prod.yml logs`
- [ ] Dashboard acessível: `http://seu-dominio.com`
- [ ] Backup de dados feito
- [ ] Firewall configurado
- [ ] Autoscaling/load balancer (se necessário)

## Suporte

Para problemas, consulte:

- `docs/06-Docker.md` — Setup com Docker (desenvolvimento)
- `docs/` — Documentação técnica do LumaBot
- GitHub Issues → https://github.com/murillous/LumaBot/issues
