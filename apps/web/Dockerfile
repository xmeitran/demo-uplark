FROM node:22-alpine AS app
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ui-tokens/package.json packages/ui-tokens/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm db:generate && pnpm build:frontend
EXPOSE 3000
CMD ["pnpm", "--filter", "@b2b-crm/web", "start"]
