FROM node:22-alpine AS app
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY pnpm-lock.yaml ./
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm db:generate && pnpm --filter @b2b-crm/worker build
CMD ["pnpm", "--filter", "@b2b-crm/worker", "start"]
