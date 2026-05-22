# syntax=docker/dockerfile:1
# Development Dockerfile. For production use docker/Dockerfile.prod
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=development
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.1.3 --activate
RUN apk add --no-cache wget

COPY package.json pnpm-lock.yaml ./
# Dev: includes devDependencies for debugging tools
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY --from=builder /app/dist ./dist
COPY migrations ./migrations

EXPOSE 3000 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
