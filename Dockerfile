# syntax=docker/dockerfile:1
#
# Imagem do Baja Telemetria: o servidor da equipe (Fastify + SQLite) servindo o app web.
#
#   docker build -t baja-telemetria .
#   docker run -d --init -p 8080:8080 -v ./data:/data baja-telemetria
#
# Três estágios (docs/IMPLANTACAO.md):
#   build    compila o app web (Vite) e o servidor (tsup). Roda na plataforma de quem constrói,
#            porque a saída é JavaScript puro: a imagem arm64 não precisa compilar tudo emulada.
#   deps     só as dependências de produção do servidor, instaladas no mesmo SO e na mesma
#            plataforma da imagem final (better-sqlite3 é nativo).
#   runtime  node + node_modules de produção + apps/server/dist + apps/web/dist. Nada de
#            código-fonte, testes, legacy/ ou samples/.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /app
ENV CI=true

# primeiro só os package.json: o npm ci fica em cache enquanto as dependências não mudarem
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci --no-audit --no-fund

COPY packages/core packages/core
COPY apps/web apps/web
COPY apps/server apps/server
# web em / (o servidor serve o app na raiz) e servidor num arquivo só com o @baja/core embutido
RUN npm run build

# ---------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV CI=true

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
# só o workspace do servidor, sem devDependencies. O @baja/core já está dentro do dist,
# então o link do workspace (node_modules/@baja) sai. better-sqlite3 traz os binários
# prontos (linux-x64 / linux-arm64, glibc); se uma versão futura precisar compilar,
# instale aqui python3, make e g++ antes do npm ci.
RUN npm ci --omit=dev --workspace=@baja/server --no-audit --no-fund \
 && rm -rf node_modules/@baja \
 && mkdir -p apps/server/node_modules \
 && npm cache clean --force \
 && cd apps/server \
 && node -e "require('better-sqlite3')(':memory:').close(); console.log('better-sqlite3 ok')"

# ---------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    DATA_DIR=/data \
    WEB_DIST=/app/apps/web/dist \
    PORT=8080

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
# o package.json do servidor diz "type": "module" para o dist/index.js (ESM)
COPY apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

# Entrada: o servidor sempre roda como o usuário "node" (uid 1000, não-root).
# Se o contêiner começar como root (padrão), o script só acerta o dono da pasta de dados
# — volumes do Fly.io e do Railway e pastas criadas pelo Docker no Linux chegam como root —
# e troca para "node" com setpriv antes de iniciar. Rodando já como node
# (docker run --user node), só inicia.
COPY --chmod=755 <<'EOF' /usr/local/bin/baja-entrypoint
#!/bin/sh
set -e
DATA_DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  if [ "$(stat -c %u "$DATA_DIR")" != "$(id -u node)" ]; then
    chown -R node:node "$DATA_DIR"
  fi
  exec setpriv --reuid=node --regid=node --init-groups -- env HOME=/home/node "$@"
fi
exec "$@"
EOF

RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/baja-entrypoint"]
CMD ["node", "--enable-source-maps", "apps/server/dist/index.js"]
