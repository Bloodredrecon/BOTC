# BOTC Companion — production image (Fastify + Socket.IO + built Vite UI).
# Listen: 0.0.0.0:3847 (override with BOTC_PORT / PORT).
# Health: GET /api/health

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY config ./config
COPY data ./data
COPY server ./server
COPY web ./web
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    BOTC_HOST=0.0.0.0 \
    BOTC_PORT=3847 \
    BOTC_HTTPS=0

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY config ./config
COPY data ./data

RUN mkdir -p data/logs data/player-photos data/audio config/tls \
  && chown -R node:node /app

USER node
EXPOSE 3847
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BOTC_PORT||process.env.PORT||3847)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
