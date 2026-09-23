FROM node:22-alpine AS app
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ui-tokens/package.json packages/ui-tokens/package.json
COPY prisma prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm db:generate && pnpm --filter @b2b-crm/contracts build && pnpm --filter @b2b-crm/api build
EXPOSE 4000
CMD ["pnpm", "--filter", "@b2b-crm/api", "start"]
