#!/bin/bash
set -ex

DOMAIN_NAME="${domain_name}"
ENVIRONMENT="${environment}"

hostnamectl set-hostname "luma-bot-${environment}"
echo "127.0.0.1 luma-bot-${environment}" >> /etc/hosts

dnf install -y docker
systemctl enable --now docker
usermod -aG docker ec2-user

# docker compose v2 CLI plugin (not bundled in AL2023's docker package)
mkdir -p /usr/libexec/docker/cli-plugins
curl -sSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
  -o /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose

mkdir -p /app/auth_info /app/data
chown -R ec2-user:ec2-user /app

cat > /app/.env << ENV_EOF
AI_PROVIDER=${ai_provider}
GEMINI_API_KEY=${gemini_api_key}
OPENAI_API_KEY=${openai_api_key}
DEEPSEEK_API_KEY=${deepseek_api_key}
TAVILY_API_KEY=${tavily_api_key}
OWNER_NUMBER=${owner_number}
LOG_LEVEL=${log_level}
DASHBOARD_PORT=3000
DASHBOARD_PASSWORD=${dashboard_password}
CLOUDFLARE_TUNNEL=false
ENV_EOF

chown ec2-user:ec2-user /app/.env
chmod 600 /app/.env

cat > /usr/local/bin/cloudflare-ddns.sh << 'DDNS_SCRIPT'
#!/bin/bash
set -e

DOMAIN="$${1}"
ZONE_ID="$${2}"
API_TOKEN="$${3}"

CURRENT_IP=$(curl -s ifconfig.me)
DNS_RECORD=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$${ZONE_ID}/dns_records?type=A&name=$${DOMAIN}" \
  -H "Authorization: Bearer $${API_TOKEN}" \
  -H "Content-Type: application/json")
DNS_IP=$(echo "$${DNS_RECORD}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result'][0]['content'] if d['result'] else '')" 2>/dev/null)
RECORD_ID=$(echo "$${DNS_RECORD}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result'][0]['id'] if d['result'] else '')" 2>/dev/null)

if [ "$${CURRENT_IP}" != "$${DNS_IP}" ] && [ -n "$${RECORD_ID}" ]; then
  curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$${ZONE_ID}/dns_records/$${RECORD_ID}" \
    -H "Authorization: Bearer $${API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"A\",\"name\":\"$${DOMAIN}\",\"content\":\"$${CURRENT_IP}\",\"ttl\":120,\"proxied\":false}"
  echo "[$(date)] DDNS updated: $${DNS_IP} -> $${CURRENT_IP}" >> /var/log/cloudflare-ddns.log
else
  echo "[$(date)] DDNS no change: $${CURRENT_IP}" >> /var/log/cloudflare-ddns.log
fi
DDNS_SCRIPT

chmod +x /usr/local/bin/cloudflare-ddns.sh

CLOUDFLARE_API_TOKEN="${cloudflare_api_token}"
CLOUDFLARE_ZONE_ID="${cloudflare_zone_id}"

cat > /etc/systemd/system/cloudflare-ddns.service << SYSTEMD_SERVICE
[Unit]
Description=Cloudflare DDNS for LumaBot
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/cloudflare-ddns.sh ${domain_name} ${cloudflare_zone_id} ${cloudflare_api_token}
User=root
SYSTEMD_SERVICE

cat > /etc/systemd/system/cloudflare-ddns.timer << SYSTEMD_TIMER
[Unit]
Description=Cloudflare DDNS timer (5 min)

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=multi-user.target
SYSTEMD_TIMER

systemctl daemon-reload
systemctl enable --now cloudflare-ddns.timer

GITHUB_REPO_LOWER=$(echo "${github_repo}" | tr '[:upper:]' '[:lower:]')

cat > /app/docker-compose.yml << DOCKER_COMPOSE
services:
  nginx:
    image: nginx:1.26.0
    container_name: luma-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /app/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - /app/nginx/conf.d:/etc/nginx/conf.d:ro
      - /app/ssl:/etc/nginx/ssl:ro
    depends_on:
      - app
    networks:
      - luma-prod

  app:
    image: ghcr.io/$${GITHUB_REPO_LOWER}/luma-bot:latest
    container_name: luma-bot
    restart: unless-stopped
    expose:
      - "3000"
    volumes:
      - /app/auth_info:/app/auth_info
      - /app/data:/app/data
      - /app/.env:/app/.env:ro
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (r) => { if (r.statusCode !== 200) throw new Error(r.statusCode) })"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - luma-prod

volumes: {}
networks:
  luma-prod:
    driver: bridge
DOCKER_COMPOSE

mkdir -p /app/nginx/conf.d /app/ssl

cat > /app/nginx/nginx.conf << NGINX_CONF
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;
events { worker_connections 2048; }
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  sendfile on; tcp_nopush on; tcp_nodelay on;
  keepalive_timeout 65;
  client_max_body_size 50M;
  gzip on; gzip_vary on; gzip_min_length 1024;
  gzip_comp_level 6;
  gzip_types text/plain text/css text/xml text/javascript application/json application/javascript;
  limit_req_zone \$binary_remote_addr zone=luma_limit:10m rate=10r/s;
  include /etc/nginx/conf.d/*.conf;
}
NGINX_CONF

cat > /app/nginx/conf.d/default.conf << NGINX_SITE
upstream luma_backend {
  least_conn;
  server luma-bot:3000 max_fails=3 fail_timeout=30s;
}
server {
  listen 80;
  server_name _;
  client_max_body_size 50M;
  location /health {
    proxy_pass http://luma_backend;
  }
  location / {
    limit_req zone=luma_limit burst=20 nodelay;
    proxy_pass http://luma_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
  }
  location ~ /\.env { deny all; return 404; }
  location ~ /\.git { deny all; return 404; }
}
NGINX_SITE

chown -R ec2-user:ec2-user /app/nginx

echo "Bootstrap completo"
