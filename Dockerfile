# ULTIMATE MAHJONG — authoritative multiplayer server (item 5)
#
# Build:  docker build -t ultimate-mahjong-server .
# Run:    docker run --rm -p 8787:8787 \
#           -e UMO_DATABASE_URL=postgres://user:pass@host:5432/umo \
#           ultimate-mahjong-server
#
# - Sem UMO_DATABASE_URL as salas vivem só em memória (reiniciou, perdeu).
# - Com UMO_DATABASE_URL o servidor roda as migrações SQL versionadas
#   (server/migrations/*.sql) no boot e persiste salas/contas/estatísticas.
# - Para migrar manualmente: docker run --rm -e UMO_DATABASE_URL=... \
#     ultimate-mahjong-server npx tsx server/migrate.ts
# - O frontend é um build estático independente: `npm run build` na raiz
#   gera dist/ (hospede em qualquer CDN/static host).
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# dependências de produção (tsx + ws + pg são dependencies, não devDependencies)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# o servidor roda TypeScript direto via tsx (sem etapa de build)
COPY tsconfig.json tsconfig.server.json ./
COPY server ./server
COPY src/game-engine ./src/game-engine

ENV PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["npm", "run", "server"]
