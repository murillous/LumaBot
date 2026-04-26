# Rodando LumaBot em Docker

## Pré-requisitos

- Docker e Docker Compose instalados
- Arquivo `.env` configurado na raiz do projeto (copie do `.env.example`)

## Setup Rápido

### 1. Crie o arquivo `.env`

```bash
cp .env.example .env
```

Edite `.env` e configure as variáveis obrigatórias:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=sua_chave_aqui
DASHBOARD_PASSWORD=suasenha
```

### 2. Build e start

```bash
docker-compose -f docker/compose.dev.yml up
```

Ou em background:

```bash
docker-compose -f docker/compose.dev.yml up -d
```

### 3. Acesse o dashboard

Abra `http://localhost:3000` no browser e escaneie o QR Code.

## Comandos úteis

Ligar o container:
```bash
docker-compose -f docker/compose.dev.yml up -d
```

Ver logs em tempo real:
```bash
docker-compose -f docker/compose.dev.yml logs -f dev
```

Parar o container:
```bash
docker-compose -f docker/compose.dev.yml stop
```

Remover container e volumes:
```bash
docker-compose -f docker/compose.dev.yml down -v
```

Reconstruir a imagem (após mudanças no código):
```bash
docker-compose -f docker/compose.dev.yml build --no-cache
docker-compose -f docker/compose.dev.yml up -d
```

## Dados Persistentes

Os volumes Docker nomeados persistem os dados do bot:

- `auth_data` → `/app/auth_info` (credenciais do WhatsApp)
- `bot_data` → `/app/data` (banco de dados SQLite com histórico e estatísticas)

Mesmo se o container cair, os dados persistem em volumes Docker.

## Variáveis de Ambiente

Todas as variáveis do `.env.example` funcionam. As mais importantes:

```env
AI_PROVIDER=gemini              # Provider de IA (gemini, openai, deepseek)
GEMINI_API_KEY=                 # Obrigatório se AI_PROVIDER=gemini
TAVILY_API_KEY=                 # Opcional — busca na web
OWNER_NUMBER=5511999999999      # Opcional — número do dono
DASHBOARD_PORT=3000             # Porta do dashboard
DASHBOARD_PASSWORD=             # Senha de acesso (opcional)
CLOUDFLARE_TUNNEL=false         # Se estiver atrás de tunnel
```

## Troubleshooting

**Bot não conecta ao WhatsApp**

```bash
rm -rf auth_info/
docker-compose -f docker/compose.dev.yml restart dev
```

Depois escaneie o QR novamente.

**Sticker não converte**

FFmpeg está incluído na imagem. Se falhar, tente:

```bash
docker-compose -f docker/compose.dev.yml logs dev | grep -i ffmpeg
```

**Dashboard não abre**

Confirme que a porta 3000 está livre:

```bash
lsof -i :3000
```

Se ocupada, mude em `docker/compose.dev.yml`:

```yaml
ports:
  - "3001:3000"  # Acesse em http://localhost:3001
```

## Build Manual (sem docker-compose)

```bash
docker build -t luma-bot -f Dockerfile.dev .
docker run -d \
  --name dev \
  -p 3000:3000 \
  -v auth_data:/app/auth_info \
  -v bot_data:/app/data \
  --env-file .env \
  luma-bot
```
