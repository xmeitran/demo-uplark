-- Stable, project-shared hierarchy ordering.
-- The backfill is deterministic and intentionally preserves the legacy visible
-- stage/task order before required constraints are installed.

DO $$
DECLARE
  drift_count BIGINT;
  drift_sample TEXT;
BEGIN
  SELECT count(*)
  INTO drift_count
  FROM "ProjectStage" s
  JOIN "Project" p ON p."id" = s."projectId"
  WHERE s."workspaceId" IS DISTINCT FROM p."workspaceId"
    OR s."accountId" IS DISTINCT FROM p."accountId";

  IF drift_count > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id")
    INTO drift_sample
    FROM (
      SELECT s."id"
      FROM "ProjectStage" s
      JOIN "Project" p ON p."id" = s."projectId"
      WHERE s."workspaceId" IS DISTINCT FROM p."workspaceId"
        OR s."accountId" IS DISTINCT FROM p."accountId"
      ORDER BY s."id"
      LIMIT 5
    ) x;

    RAISE EXCEPTION
      'Project hierarchy migration blocked: % ProjectStage row(s) disagree with owning Project workspace/account; sample stage IDs: %',
      drift_count,
      drift_sample;
  END IF;
END $$;

ALTER TABLE "Project"
  ADD COLUMN "hierarchyOrderVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ProjectStage"
  ADD COLUMN "milestoneId" TEXT;

ALTER TABLE "ProjectTask"
  ADD COLUMN "sortOrder" INTEGER;

CREATE TABLE "ProjectMilestone" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation',
  "accountId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

WITH normalized_stages AS (
  SELECT
    s."id",
    p."workspaceId",
    p."accountId",
    p."id" AS "projectId",
    s."phase",
    s."activity",
    s."sortOrder",
    s."createdAt",
    CASE
      WHEN regexp_replace(btrim(s."phase"), '\s+', ' ', 'g') = ''
        THEN '__blank__:' || s."id"
      ELSE lower(regexp_replace(btrim(s."phase"), '\s+', ' ', 'g'))
    END AS normalized_key
  FROM "ProjectStage" s
  JOIN "Project" p ON p."id" = s."projectId"
),
milestone_groups AS (
  SELECT
    "workspaceId",
    "accountId",
    "projectId",
    normalized_key,
    min("sortOrder") AS first_sort_order,
    min("createdAt") AS first_created_at,
    min("id") AS first_id,
    min(CASE
      WHEN regexp_replace(btrim("phase"), '\s+', ' ', 'g') = ''
        THEN "activity"
      ELSE regexp_replace(btrim("phase"), '\s+', ' ', 'g')
    END) AS milestone_name
  FROM normalized_stages
  GROUP BY "workspaceId", "accountId", "projectId", normalized_key
),
ranked_milestones AS (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY "workspaceId", "projectId"
      ORDER BY first_sort_order ASC, first_created_at ASC, first_id ASC
    ) * 10 AS dense_sort_order
  FROM milestone_groups
)
INSERT INTO "ProjectMilestone" (
  "id",
  "workspaceId",
  "accountId",
  "projectId",
  "name",
  "normalizedKey",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  'mil_' || md5("workspaceId" || ':' || "projectId" || ':' || normalized_key),
  "workspaceId",
  "accountId",
  "projectId",
  milestone_name,
  normalized_key,
  dense_sort_order::INTEGER,
  first_created_at,
  first_created_at
FROM ranked_milestones;

UPDATE "ProjectStage" s
SET "milestoneId" = m."id"
FROM "ProjectMilestone" m
WHERE m."projectId" = s."projectId"
  AND m."normalizedKey" = CASE
    WHEN regexp_replace(btrim(s."phase"), '\s+', ' ', 'g') = ''
      THEN '__blank__:' || s."id"
    ELSE lower(regexp_replace(btrim(s."phase"), '\s+', ' ', 'g'))
  END;

WITH ranked_stages AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "workspaceId", "projectId", "milestoneId"
      ORDER BY "sortOrder" ASC, "createdAt" ASC, "id" ASC
    ) * 10 AS dense_sort_order
  FROM "ProjectStage"
)
UPDATE "ProjectStage" s
SET "sortOrder" = ranked_stages.dense_sort_order::INTEGER
FROM ranked_stages
WHERE s."id" = ranked_stages."id";

WITH ranked_tasks AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "workspaceId", "projectId", "stageId", "parentTaskId"
      ORDER BY "dueAt" ASC NULLS LAST, "updatedAt" DESC, "createdAt" ASC, "id" ASC
    ) * 10 AS dense_sort_order
  FROM "ProjectTask"
)
UPDATE "ProjectTask" t
SET "sortOrder" = ranked_tasks.dense_sort_order::INTEGER
FROM ranked_tasks
WHERE t."id" = ranked_tasks."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ProjectStage" WHERE "milestoneId" IS NULL) THEN
    RAISE EXCEPTION 'Project hierarchy migration left ProjectStage.milestoneId null';
  END IF;
  IF EXISTS (SELECT 1 FROM "ProjectTask" WHERE "sortOrder" IS NULL) THEN
    RAISE EXCEPTION 'Project hierarchy migration left ProjectTask.sortOrder null';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ProjectMilestone" m
    JOIN "Project" p ON p."id" = m."projectId"
    WHERE m."workspaceId" IS DISTINCT FROM p."workspaceId"
      OR m."accountId" IS DISTINCT FROM p."accountId"
  ) THEN
    RAISE EXCEPTION 'Project hierarchy migration created a milestone outside its owning Project workspace/account';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ProjectStage" s
    JOIN "Project" p ON p."id" = s."projectId"
    WHERE s."workspaceId" IS DISTINCT FROM p."workspaceId"
      OR s."accountId" IS DISTINCT FROM p."accountId"
  ) THEN
    RAISE EXCEPTION 'Project hierarchy migration left a stage outside its owning Project workspace/account';
  END IF;
END $$;

ALTER TABLE "ProjectStage"
  ALTER COLUMN "milestoneId" SET NOT NULL;

ALTER TABLE "ProjectTask"
  ALTER COLUMN "sortOrder" SET NOT NULL,
  ALTER COLUMN "sortOrder" SET DEFAULT 10;

CREATE UNIQUE INDEX "ProjectMilestone_projectId_normalizedKey_key"
  ON "ProjectMilestone"("projectId", "normalizedKey");
CREATE INDEX "ProjectMilestone_workspaceId_projectId_sortOrder_idx"
  ON "ProjectMilestone"("workspaceId", "projectId", "sortOrder");
CREATE INDEX "ProjectMilestone_accountId_idx"
  ON "ProjectMilestone"("accountId");
CREATE INDEX "ProjectStage_projectId_milestoneId_sortOrder_idx"
  ON "ProjectStage"("projectId", "milestoneId", "sortOrder");
DROP INDEX IF EXISTS "ProjectStage_projectId_sortOrder_idx";
CREATE INDEX "ProjectTask_hierarchy_order_idx"
  ON "ProjectTask"("projectId", "stageId", "parentTaskId", "archivedAt", "sortOrder");

ALTER TABLE "ProjectMilestone"
  ADD CONSTRAINT "ProjectMilestone_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMilestone"
  ADD CONSTRAINT "ProjectMilestone_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMilestone"
  ADD CONSTRAINT "ProjectMilestone_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectStage"
  ADD CONSTRAINT "ProjectStage_milestoneId_fkey"
  FOREIGN KEY ("milestoneId") REFERENCES "ProjectMilestone"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep rollback to the previous application binary write-compatible while the
-- database remains forward-only. A BEFORE trigger can fill the required column
-- before PostgreSQL checks NOT NULL/FK constraints.
CREATE OR REPLACE FUNCTION public."compat_fill_project_stage_milestone"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  owning_workspace_id TEXT;
  owning_account_id TEXT;
  desired_normalized_key TEXT;
  desired_milestone_name TEXT;
  current_normalized_key TEXT;
  resolved_milestone_id TEXT;
BEGIN
  SELECT p."workspaceId", p."accountId"
  INTO owning_workspace_id, owning_account_id
  FROM public."Project" p
  WHERE p."id" = NEW."projectId";

  IF owning_workspace_id IS NULL
    OR NEW."workspaceId" IS DISTINCT FROM owning_workspace_id
    OR NEW."accountId" IS DISTINCT FROM owning_account_id
  THEN
    RAISE EXCEPTION 'ProjectStage tenant/account does not match owning Project';
  END IF;

  -- The previous application binary updates Project then ProjectStage during an
  -- account reassignment and does not know ProjectMilestone exists. Reconcile
  -- the aggregate before resolving the stable target.
  UPDATE public."ProjectMilestone" m
  SET "accountId" = owning_account_id
  WHERE m."projectId" = NEW."projectId"
    AND m."workspaceId" = owning_workspace_id
    AND m."accountId" IS DISTINCT FROM owning_account_id;

  -- New application inserts and explicit reparent operations own their supplied
  -- stable milestone identity after its aggregate ownership is validated.
  IF TG_OP = 'INSERT' AND NEW."milestoneId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public."ProjectMilestone" m
      WHERE m."id" = NEW."milestoneId"
        AND m."projectId" = NEW."projectId"
        AND m."workspaceId" = owning_workspace_id
        AND m."accountId" = owning_account_id
    ) THEN
      RAISE EXCEPTION 'ProjectStage milestone does not belong to owning Project';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW."milestoneId" IS DISTINCT FROM OLD."milestoneId"
    AND NEW."milestoneId" IS NOT NULL
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public."ProjectMilestone" m
      WHERE m."id" = NEW."milestoneId"
        AND m."projectId" = NEW."projectId"
        AND m."workspaceId" = owning_workspace_id
        AND m."accountId" = owning_account_id
    ) THEN
      RAISE EXCEPTION 'ProjectStage milestone does not belong to owning Project';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW."milestoneId" IS NOT NULL
    AND NEW."phase" IS NOT DISTINCT FROM OLD."phase"
    AND NEW."projectId" IS NOT DISTINCT FROM OLD."projectId"
    AND NEW."workspaceId" IS NOT DISTINCT FROM OLD."workspaceId"
    AND NEW."accountId" IS NOT DISTINCT FROM OLD."accountId"
  THEN
    RETURN NEW;
  END IF;

  desired_normalized_key := CASE
    WHEN regexp_replace(btrim(NEW."phase"), '\s+', ' ', 'g') = ''
      THEN '__blank__:' || NEW."id"
    ELSE lower(regexp_replace(btrim(NEW."phase"), '\s+', ' ', 'g'))
  END;
  desired_milestone_name := CASE
    WHEN regexp_replace(btrim(NEW."phase"), '\s+', ' ', 'g') = ''
      THEN NEW."activity"
    ELSE regexp_replace(btrim(NEW."phase"), '\s+', ' ', 'g')
  END;

  -- A milestone-scope rename updates ProjectMilestone first and then projects
  -- the new phase to its stages. Preserve that stable target.
  IF NEW."milestoneId" IS NOT NULL THEN
    SELECT m."normalizedKey"
    INTO current_normalized_key
    FROM public."ProjectMilestone" m
    WHERE m."id" = NEW."milestoneId"
      AND m."projectId" = NEW."projectId"
      AND m."workspaceId" = owning_workspace_id
      AND m."accountId" = owning_account_id;

    IF current_normalized_key = desired_normalized_key THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public."ProjectMilestone" (
    "id",
    "workspaceId",
    "accountId",
    "projectId",
    "name",
    "normalizedKey",
    "sortOrder"
  )
  SELECT
    'mil_' || md5(owning_workspace_id || ':' || NEW."projectId" || ':' || desired_normalized_key),
    owning_workspace_id,
    owning_account_id,
    NEW."projectId",
    desired_milestone_name,
    desired_normalized_key,
    COALESCE((
      SELECT max(m."sortOrder") + 10
      FROM public."ProjectMilestone" m
      WHERE m."projectId" = NEW."projectId"
    ), 10)
  ON CONFLICT ("projectId", "normalizedKey") DO NOTHING;

  SELECT m."id"
  INTO resolved_milestone_id
  FROM public."ProjectMilestone" m
  WHERE m."projectId" = NEW."projectId"
    AND m."workspaceId" = owning_workspace_id
    AND m."accountId" = owning_account_id
    AND m."normalizedKey" = desired_normalized_key;

  IF resolved_milestone_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve compatibility milestone for ProjectStage';
  END IF;

  NEW."milestoneId" := resolved_milestone_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectStage_compat_fill_milestone"
BEFORE INSERT OR UPDATE OF "phase", "projectId", "workspaceId", "accountId", "milestoneId"
ON public."ProjectStage"
FOR EACH ROW
EXECUTE FUNCTION public."compat_fill_project_stage_milestone"();

REVOKE EXECUTE ON FUNCTION public."compat_fill_project_stage_milestone"() FROM PUBLIC;
