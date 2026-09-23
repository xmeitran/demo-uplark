ALTER TABLE "TaskTimeEntry" ALTER COLUMN "approvalStatus" SET DEFAULT 'approved';

UPDATE "TaskTimeEntry"
SET "approvalStatus" = 'approved'
WHERE "approvalStatus" = 'submitted';
