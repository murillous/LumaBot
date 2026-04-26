FROM node:20-slim as dependencies

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --only=production && \
    npm cache clean --force

FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules

COPY --chown=node:node package*.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node index.js ./
COPY --chown=node:node dashboard ./dashboard
COPY --chown=node:node docker/docker-entrypoint.sh /docker-entrypoint.sh

RUN mkdir -p auth_info data && \
    chmod +x /docker-entrypoint.sh && \
    chown -R node:node auth_info data /app

ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV DASHBOARD_PORT=3000

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => { if (r.statusCode !== 200) throw new Error(r.statusCode) })"

VOLUME ["/app/auth_info", "/app/data"]

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["/docker-entrypoint.sh"]
