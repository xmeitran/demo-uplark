-- "Không duyệt" mode per project. Existing projects keep the review flow.
ALTER TABLE "Project" ADD COLUMN "milestoneApprovalRequired" BOOLEAN NOT NULL DEFAULT true;
