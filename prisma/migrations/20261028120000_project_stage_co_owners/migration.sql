-- A milestone or stage can have several PICs; ownerUserId stays the primary one.
ALTER TABLE "ProjectStage" ADD COLUMN "coOwnerUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
