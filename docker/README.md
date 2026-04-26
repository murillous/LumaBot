# Docker Configuration

This folder contains all Docker-related files for LumaBot development and production.

## Files

### Docker Images

- **Dockerfile** — Production image (multi-stage optimized, ~500MB)
- **Dockerfile.dev** — Development image (with live-reload via Nodemon)

### Docker Compose

- **compose.prod.yml** — Production setup (Nginx + Bot with health checks)
- **compose.dev.yml** — Development setup (local mounts, hot-reload)

### Entrypoint & Nginx

- **docker-entrypoint.sh** — Startup script for production
- **nginx/nginx.conf** — Nginx main configuration
- **nginx/conf.d/default.conf** — LumaBot virtual host

### SSL/TLS

- **ssl/** — Directory for SSL certificates (create manually or with Certbot)

## Quick Start

### Development

```bash
docker-compose -f docker/compose.dev.yml up
```

### Production

```bash
docker-compose -f docker/compose.prod.yml up -d
```

## Full Documentation

- See `docs/DOCKER.md` for basic Docker setup
- See `docs/07-Producao.md` for production deployment guide
