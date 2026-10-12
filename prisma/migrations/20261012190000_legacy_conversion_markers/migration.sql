-- Rules section 9.2: marker columns only. The conversion itself is scripts/operations/convert-legacy-data.ts
-- (idempotent, has --dry-run); this migration changes no existing row.
ALTER TABLE "ProjectStage" ADD COLUMN IF NOT EXISTS "legacyConvertedAt" TIMESTAMP(3);
ALTER TABLE "ProjectTask" ADD COLUMN IF NOT EXISTS "legacyConvertedAt" TIMESTAMP(3);
ALTER TABLE "TaskTimeEntry" ADD COLUMN IF NOT EXISTS "legacyConvertedAt" TIMESTAMP(3);
ALTER TABLE "TaskTimeEntry" ADD COLUMN IF NOT EXISTS "legacyPendingReason" TEXT;
ALTER TABLE "TaskTimeEntry" ADD COLUMN IF NOT EXISTS "beforeEightHourRule" BOOLEAN NOT NULL DEFAULT false;
