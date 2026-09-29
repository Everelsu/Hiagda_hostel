# Сборка фронтенда — отдельной стадией, чтобы vite и прочие dev-зависимости
# не попали в итоговый образ.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
# pg_dump/pg_restore для автобэкапов. Мажорная версия должна быть не ниже версии
# сервера из docker-compose.yml (postgres:17).
RUN apk add --no-cache postgresql17-client tar
WORKDIR /app
ENV NODE_ENV=production
# Версия (git describe) и время сборки — их показывает админка и проверяет scripts/update.sh
ARG APP_VERSION=dev
ARG APP_BUILT_AT=
ENV APP_VERSION=$APP_VERSION APP_BUILT_AT=$APP_BUILT_AT
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY scripts ./scripts
COPY public ./public
COPY --from=build /app/dist ./dist
EXPOSE 3000
# Базовые справочники (статусы, классы, удобства) — идемпотентно, демо-данные не создаются.
CMD ["sh", "-c", "node server/seed.js --base && exec node server/index.js"]
