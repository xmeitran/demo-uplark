# Tenant Workspace First Slice Staging Plan

Date: 2026-06-30

## Backend/Data/Deploy Slice To Stage

Use this slice when preparing the production backend/database deploy commit.

```bash
git add \
  .env.example \
  .github/workflows/app-images.yml \
  .github/workflows/ci.yml \
  .github/workflows/deploy-vps-app.yml \
  .github/workflows/deploy-vps-db.yml \
  README.md \
  apps/api \
  apps/worker \
  apps/web/Dockerfile \
  apps/web/app/api/admin/invitations/[invitationId]/approve/route.ts \
  apps/web/app/api/admin/users/[userId]/revoke-sessions/route.ts \
  apps/web/app/api/auth/demo/session/route.ts \
  apps/web/app/api/auth/invitations/activate/route.ts \
  apps/web/app/api/auth/lark/callback/route.ts \
  apps/web/app/api/auth/lark/session/route.ts \
  apps/web/app/api/auth/lark/start/route.ts \
  apps/web/app/api/auth/session/logout/route.ts \
  apps/web/app/api/delivery/overview/route.ts \
  apps/web/app/api/finance/overview/route.ts \
  apps/web/app/api/proposals/overview/route.ts \
  apps/web/app/policy/page.tsx \
  apps/web/next.config.mjs \
  apps/web/package.json \
  apps/web/src/components/crm-workspace/accounts-workbench.tsx \
  apps/web/src/components/crm-workspace/dashboard-workbench.tsx \
  apps/web/src/components/crm-workspace/delivery-create-project-modal.lazy.tsx \
  apps/web/src/components/crm-workspace/delivery-workbench.tsx \
  apps/web/src/components/crm-workspace/finance-workbench.tsx \
  apps/web/src/components/crm-workspace/panels.tsx \
  apps/web/src/components/crm-workspace/policy-access-admin.tsx \
  apps/web/src/components/crm-workspace/project-controls.tsx \
  apps/web/src/components/crm-workspace/proposal-workbench.tsx \
  apps/web/src/components/crm-workspace/resource-mgmt.tsx \
  apps/web/src/components/crm-workspace/shared.tsx \
  apps/web/src/components/crm-workspace/task-detail-workbench.tsx \
  apps/web/src/components/crm-workspace/task-display-helpers.ts \
  apps/web/src/components/crm-workspace/tasks-workbench.tsx \
  apps/web/src/components/sales-pipeline/commands.tsx \
  apps/web/src/components/sales-pipeline/index.tsx \
  apps/web/src/components/sales-pipeline/opportunity-drawers.tsx \
  apps/web/src/components/sales-pipeline/opportunity-table.tsx \
  apps/web/src/components/sales-pipeline/types.ts \
  apps/web/src/components/sales-pipeline/use-opportunity-workbench.ts \
  apps/web/src/components/sales-pipeline/utils.ts \
  apps/web/src/features/crm-tasks/task-draft-storage.spec.ts \
  apps/web/src/features/crm-tasks/task-draft-storage.ts \
  apps/web/src/lib/api.ts \
  apps/web/src/lib/crm-bff-proxy.spec.ts \
  apps/web/src/lib/crm-bff-proxy.ts \
  apps/web/tsconfig.json \
  apps/web/vitest.config.ts \
  ops/nginx \
  ops/release/2026-06-30-tenant-workspace-staging.md \
  ops/vps \
  package.json \
  packages/contracts \
  packages/ui-tokens \
  pnpm-lock.yaml \
  prisma \
  scripts \
  tsconfig.base.json
```

## Keep UI Dirty Diff Separate

These files were already dirty or UI-focused and should be reviewed in a separate UI cleanup commit/PR unless intentionally bundled:

```text
 .github/workflows/frontend-ci.yml
apps/web/app/clients/[clientId]/page.tsx
apps/web/app/clients/page.tsx
apps/web/app/knowledge/
apps/web/app/page.tsx
apps/web/app/projects/[projectId]/page.tsx
apps/web/app/projects/page.tsx
apps/web/app/users/[userId]/page.tsx
apps/web/e2e/constructor-projects.spec.ts
apps/web/src/components/constructor-x/sidebar.tsx
apps/web/src/lib/frontend-data-store.ts
```

## Verification Evidence

```text
pnpm --filter @b2b-crm/contracts build
pnpm db:generate
pnpm --filter @b2b-crm/api typecheck
pnpm --filter @b2b-crm/api test
pnpm --filter @b2b-crm/api build
APP_ENV_FILE="$PWD/.env.example" IMAGE_TAG=sha-local IMAGE_REGISTRY=ghcr.io/khanguyen09/b2b-crm-saas docker compose --project-directory . --env-file .env.example -f ops/vps/docker-compose.app.yml config
docker compose --project-directory . --env-file .env.example -f ops/vps/docker-compose.db.yml config
git diff --check
```
